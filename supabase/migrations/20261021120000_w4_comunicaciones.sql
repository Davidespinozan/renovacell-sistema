-- W4-05/06 · COMUNICACIÓN TRANSACCIONAL AL CLIENTE — buzón de salida durable.
--
-- Hoy el cliente no recibe NADA cuando su pedido se registra, se paga, sale o se
-- entrega: no existe proveedor de correo ni lugar donde quede asentado qué había que
-- decirle. Este archivo crea ese lugar. NO envía nada por sí mismo: el envío lo hace
-- una función de servidor que solo trabaja si hay un proveedor configurado.
--
-- Cuatro reglas que el esquema impone, no la buena voluntad del código:
--
--   1. IDENTIDAD POR EVENTO. Cada mensaje nace de un hecho canónico del negocio y su
--      llave es ese hecho (`pago_recibido:<id del cobro>`). El mismo hecho no puede
--      encolarse dos veces: un reintento, un doble clic o una reejecución no duplican.
--
--   2. NO EXISTE "ENVIADO" SIN CONFIRMACIÓN. `ck_comm_enviado` exige el identificador
--      que devolvió el proveedor. No hay forma de marcar enviado "por si acaso".
--
--   3. DESCONOCIDO ≠ FALLIDO. Un corte de red deja el mensaje en `incierto`. Se puede
--      reintentar solo dentro de la ventana en que el proveedor garantiza no duplicar;
--      pasada esa ventana hace falta una persona que acepte el riesgo.
--
--   4. COMUNICAR JAMÁS TUMBA UNA OPERACIÓN. Si encolar falla, el pedido, el cobro o la
--      entrega que lo originó se confirman igual.

-- ---------------------------------------------------------------------------
-- 0) CONSTANTES. Centralizadas: nada de números mágicos regados.
-- ---------------------------------------------------------------------------
-- El proveedor conserva una llave de idempotencia 24 h; se deja margen de 4 h.
create function public._comm_ventana_idempotencia() returns interval
  language sql immutable set search_path = public as $$ select interval '20 hours' $$;
create function public._comm_max_intentos() returns int
  language sql immutable set search_path = public as $$ select 5 $$;
-- Un reclamo sin resolver tras este tiempo se da por huérfano (el despachador murió).
create function public._comm_reclamo_caduco() returns interval
  language sql immutable set search_path = public as $$ select interval '10 minutes' $$;

-- ---------------------------------------------------------------------------
-- 1) BUZÓN DE SALIDA.
-- ---------------------------------------------------------------------------
create table public.comm_outbox (
  id                  uuid primary key default gen_random_uuid(),
  event_key           text not null,
  plantilla           text not null,
  canal               text not null default 'email',
  order_id            uuid references public.orders(id) on delete restrict,
  customer_id         uuid,
  profile_id          uuid,
  -- Foto del destinatario al momento del hecho: si el cliente cambia de correo
  -- después, el mensaje de ESTE pedido sigue apuntando a donde debía.
  to_address          text,
  to_name             text,
  payload             jsonb not null default '{}'::jsonb,
  status              text not null default 'pendiente',
  attempts            int  not null default 0,
  -- Sube solo cuando una PERSONA decide reintentar fuera de la ventana segura: cambia
  -- la llave que ve el proveedor, y por eso es una decisión humana y no automática.
  generacion          int  not null default 1,
  claim_token         uuid,
  claimed_at          timestamptz,
  first_attempt_at    timestamptz,
  provider            text,
  provider_message_id text,
  last_error          text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_comm_event unique (event_key),
  constraint ck_comm_plantilla check (plantilla in (
    'pedido_recibido','pago_recibido','pedido_enviado','pedido_entregado',
    'pedido_cancelado','reembolso_realizado')),
  constraint ck_comm_canal check (canal in ('email')),
  constraint ck_comm_status check (status in (
    'pendiente','enviando','enviado','fallido','incierto','sin_destinatario')),
  -- Regla 2: enviado ⇔ el proveedor confirmó.
  constraint ck_comm_enviado check (
    (status = 'enviado') = (provider_message_id is not null and sent_at is not null)),
  -- "Sin destinatario" es un estado durable y accionable, no un mensaje perdido.
  constraint ck_comm_destinatario check ((status = 'sin_destinatario') = (to_address is null)),
  constraint ck_comm_reclamo check ((status = 'enviando') = (claim_token is not null)),
  constraint ck_comm_intentos check (attempts >= 0 and generacion >= 1)
);
create index idx_comm_outbox_cola on public.comm_outbox (status, created_at)
  where status in ('pendiente','enviando','incierto','fallido','sin_destinatario');
create index idx_comm_outbox_order on public.comm_outbox (order_id);
comment on table public.comm_outbox is
  'Buzón de salida de comunicación transaccional al cliente. Una fila por hecho canónico del negocio. "enviado" solo existe con confirmación del proveedor.';

create function public.comm_outbox_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;
  if coalesce(current_setting('app.trusted', true), '') <> 'on' then
    raise exception 'COMM_SOLO_POR_COMANDO: el buzón de mensajes al cliente solo cambia por sus comandos.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'COMM_NO_SE_BORRA: un mensaje al cliente es evidencia; no se elimina.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    -- La identidad y el contenido del mensaje son inmutables: solo avanza su estado.
    if new.event_key is distinct from old.event_key or new.plantilla is distinct from old.plantilla
       or new.payload is distinct from old.payload or new.order_id is distinct from old.order_id then
      raise exception 'COMM_IDENTIDAD_INMUTABLE: el evento, la plantilla y el contenido de un mensaje no cambian.'
        using errcode = 'check_violation';
    end if;
    -- Un mensaje ya confirmado por el proveedor es definitivo.
    if old.status = 'enviado' then
      raise exception 'COMM_YA_ENVIADO: un mensaje confirmado por el proveedor no se modifica.'
        using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger trg_comm_outbox_guard before insert or update or delete on public.comm_outbox
  for each row execute function public.comm_outbox_guard();

-- ---------------------------------------------------------------------------
-- 2) ENCOLADO. Lo hacen los hechos canónicos, no el navegador.
-- ---------------------------------------------------------------------------
create function public._comm_encolar(p_event_key text, p_plantilla text, p_order uuid, p_payload jsonb)
returns void
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_cust uuid; v_doc uuid; v_email text; v_name text; v_folio text;
begin
  select o.customer_id, o.doctor_id, o.external_ref into v_cust, v_doc, v_folio
    from public.orders o where o.id = p_order;
  -- Venta de mostrador anónima: no hay a quién escribirle. No es un pendiente.
  if v_cust is null and v_doc is null then return; end if;

  if v_cust is not null then
    select c.email, c.full_name into v_email, v_name from public.customers c where c.id = v_cust;
  end if;
  if nullif(btrim(coalesce(v_email, '')), '') is null and v_doc is not null then
    select p.email, coalesce(v_name, p.full_name) into v_email, v_name from public.profiles p where p.id = v_doc;
  end if;
  v_email := nullif(lower(btrim(coalesce(v_email, ''))), '');

  perform set_config('app.trusted', 'on', true);
  insert into public.comm_outbox (event_key, plantilla, order_id, customer_id, profile_id,
                                  to_address, to_name, payload, status)
  values (p_event_key, p_plantilla, p_order, v_cust, v_doc, v_email, v_name,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('folio', v_folio),
          case when v_email is null then 'sin_destinatario' else 'pendiente' end)
  on conflict (event_key) do nothing;   -- Regla 1: el mismo hecho no se encola dos veces.
  perform set_config('app.trusted', v_trusted, true);
exception when others then
  -- Regla 4: la comunicación JAMÁS tumba la operación que la originó.
  perform set_config('app.trusted', v_trusted, true);
  raise warning 'COMM_ENCOLAR_FALLO: % (%)', sqlerrm, p_event_key;
end;
$$;

create function public._comm_tr_orders() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    -- Solo el pedido que queda esperando pago. La venta de mostrador nace pagada y
    -- entregada: su comprobante es el recibo, no un correo de "recibimos tu pedido".
    if new.status = 'pending_payment' then
      perform public._comm_encolar('pedido_recibido:' || new.id, 'pedido_recibido', new.id,
        jsonb_build_object('total', new.total));
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'shipped' then
      perform public._comm_encolar('pedido_enviado:' || new.id, 'pedido_enviado', new.id,
        jsonb_build_object(
          'paqueteria', new.shipping_meta ->> 'carrier',
          'rastreo',    new.shipping_meta ->> 'tracking',
          'metodo',     new.shipping_meta ->> 'method'));
    elsif new.status = 'delivered' and old.status = 'shipped' then
      perform public._comm_encolar('pedido_entregado:' || new.id, 'pedido_entregado', new.id, '{}'::jsonb);
    elsif new.status = 'cancelled' then
      perform public._comm_encolar('pedido_cancelado:' || new.id, 'pedido_cancelado', new.id, '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_comm_orders_ins after insert on public.orders
  for each row execute function public._comm_tr_orders();
create trigger trg_comm_orders_upd after update of status on public.orders
  for each row execute function public._comm_tr_orders();

create function public._comm_tr_payment_entries() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  -- Una reversa corrige el libro; no es un hecho que se le anuncie al cliente.
  if new.reversal_of is not null or new.order_id is null then return new; end if;
  if new.direction = 'in' then
    perform public._comm_encolar('pago_recibido:' || new.id, 'pago_recibido', new.order_id,
      jsonb_build_object('monto', new.amount, 'metodo', new.method));
  elsif new.direction = 'out' then
    perform public._comm_encolar('reembolso_realizado:' || new.id, 'reembolso_realizado', new.order_id,
      jsonb_build_object('monto', new.amount, 'metodo', new.method));
  end if;
  return new;
end;
$$;
create trigger trg_comm_payment_entries after insert on public.payment_entries
  for each row execute function public._comm_tr_payment_entries();

-- ---------------------------------------------------------------------------
-- 3) DESPACHO. Reclamar → enviar (fuera de la base) → resolver.
-- ---------------------------------------------------------------------------
create function public._comm_autorizar() returns text
  language plpgsql stable security definer set search_path = public as
$$
declare r text := coalesce(public.auth_role(), '');
begin
  if r = 'admin' then return r; end if;
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then
    return 'service_role';
  end if;
  raise exception 'NO_AUTORIZADO: solo Dirección administra los mensajes al cliente';
end;
$$;

-- Reclama un lote. El reclamo es exclusivo (SKIP LOCKED): dos despachadores a la vez
-- nunca toman el mismo mensaje.
create function public.comm_reclamar(p_limite int default 20)
returns table (id uuid, claim_token uuid, idempotency_key text, plantilla text,
               to_address text, to_name text, payload jsonb)
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_token uuid := gen_random_uuid();
begin
  perform public._comm_autorizar();
  perform set_config('app.trusted', 'on', true);
  return query
  with elegidos as (
    select c.id from public.comm_outbox c
     where c.status = 'pendiente'
        -- Regla 3: lo incierto (o un reclamo huérfano) se reintenta SOLO dentro de la
        -- ventana en que el proveedor garantiza no duplicar, y con tope de intentos.
        or ( (c.status = 'incierto'
              or (c.status = 'enviando' and c.claimed_at < now() - public._comm_reclamo_caduco()))
             and c.attempts < public._comm_max_intentos()
             and c.first_attempt_at > now() - public._comm_ventana_idempotencia() )
     order by c.created_at
     limit greatest(1, least(coalesce(p_limite, 20), 100))
     for update skip locked
  )
  update public.comm_outbox c
     set status = 'enviando', claim_token = v_token, claimed_at = now(),
         attempts = c.attempts + 1,
         first_attempt_at = coalesce(c.first_attempt_at, now())
    from elegidos e where c.id = e.id
  returning c.id, c.claim_token, c.event_key || ':' || c.generacion, c.plantilla,
            c.to_address, c.to_name, c.payload;
  perform set_config('app.trusted', v_trusted, true);
end;
$$;
comment on function public.comm_reclamar(int) is
  'Reclama mensajes para enviarlos. Devuelve la llave de idempotencia que debe viajar al proveedor: es estable entre reintentos del mismo mensaje.';

create function public.comm_resolver(p_id uuid, p_claim uuid, p_resultado text,
  p_provider text default null, p_message_id text default null, p_error text default null)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  c public.comm_outbox;
begin
  perform public._comm_autorizar();
  select * into c from public.comm_outbox where id = p_id for update;
  if not found then raise exception 'COMM_INEXISTENTE: ese mensaje no existe'; end if;
  -- Solo quien lo reclamó puede resolverlo: un despachador tardío no pisa a otro.
  if c.status <> 'enviando' or c.claim_token is distinct from p_claim then
    raise exception 'COMM_RECLAMO_INVALIDO: ese mensaje ya no está reclamado por esta operación';
  end if;
  if p_resultado not in ('enviado','fallido','incierto') then
    raise exception 'COMM_RESULTADO_INVALIDO: el resultado debe ser enviado, fallido o incierto';
  end if;
  if p_resultado = 'enviado' and nullif(btrim(coalesce(p_message_id, '')), '') is null then
    raise exception 'COMM_SIN_CONFIRMACION: no se puede marcar enviado sin el identificador que devolvió el proveedor';
  end if;

  perform set_config('app.trusted', 'on', true);
  update public.comm_outbox set
    status = p_resultado, claim_token = null,
    provider = coalesce(nullif(btrim(coalesce(p_provider, '')), ''), provider),
    provider_message_id = case when p_resultado = 'enviado' then btrim(p_message_id) else null end,
    sent_at = case when p_resultado = 'enviado' then now() else null end,
    last_error = case when p_resultado = 'enviado' then null else left(coalesce(p_error, ''), 300) end
   where id = p_id;
  perform set_config('app.trusted', v_trusted, true);
  return jsonb_build_object('status', p_resultado, 'id', p_id);
end;
$$;

-- Decisión HUMANA sobre un mensaje que no salió. Es la única vía para:
--   · volver a intentar uno fallido;
--   · reintentar uno incierto fuera de la ventana segura (puede duplicar: hay que aceptarlo);
--   · volver a buscar el correo de un cliente que no lo tenía.
create function public.comm_reintentar(p_id uuid, p_acepto_posible_duplicado boolean default false)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  c public.comm_outbox; v_email text; v_name text; v_fuera boolean;
begin
  perform public._comm_autorizar();
  select * into c from public.comm_outbox where id = p_id for update;
  if not found then raise exception 'COMM_INEXISTENTE: ese mensaje no existe'; end if;
  if c.status = 'enviado' then raise exception 'COMM_YA_ENVIADO: ese mensaje ya fue confirmado por el proveedor'; end if;
  if c.status in ('pendiente','enviando') then
    raise exception 'COMM_EN_CURSO: ese mensaje ya está en la cola de envío';
  end if;

  perform set_config('app.trusted', 'on', true);
  if c.status = 'sin_destinatario' then
    if c.customer_id is not null then
      select cu.email, cu.full_name into v_email, v_name from public.customers cu where cu.id = c.customer_id;
    end if;
    if nullif(btrim(coalesce(v_email, '')), '') is null and c.profile_id is not null then
      select p.email, coalesce(v_name, p.full_name) into v_email, v_name from public.profiles p where p.id = c.profile_id;
    end if;
    v_email := nullif(lower(btrim(coalesce(v_email, ''))), '');
    if v_email is null then
      perform set_config('app.trusted', v_trusted, true);
      raise exception 'COMM_SIGUE_SIN_CORREO: el cliente todavía no tiene un correo registrado';
    end if;
    update public.comm_outbox set status = 'pendiente', to_address = v_email,
           to_name = coalesce(v_name, to_name), last_error = null where id = p_id;
  else
    -- incierto: pudo haber llegado. Fuera de la ventana el proveedor ya no deduplica.
    v_fuera := c.status = 'incierto'
               and (c.first_attempt_at is null or c.first_attempt_at <= now() - public._comm_ventana_idempotencia());
    if v_fuera and not coalesce(p_acepto_posible_duplicado, false) then
      perform set_config('app.trusted', v_trusted, true);
      raise exception 'COMM_POSIBLE_DUPLICADO: no se sabe si este mensaje llegó; reenviarlo puede duplicarlo. Confírmalo para continuar.';
    end if;
    update public.comm_outbox set status = 'pendiente', attempts = 0, first_attempt_at = null,
           generacion = case when c.status = 'fallido' or v_fuera then generacion + 1 else generacion end,
           last_error = null where id = p_id;
  end if;
  perform set_config('app.trusted', v_trusted, true);
  return jsonb_build_object('status', 'pendiente', 'id', p_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) AUTORIDAD. El buzón guarda correos de clientes: solo Dirección lo lee.
-- ---------------------------------------------------------------------------
alter table public.comm_outbox enable row level security;
revoke all on public.comm_outbox from anon, authenticated;
grant select on public.comm_outbox to authenticated;
create policy comm_outbox_select on public.comm_outbox
  for select to authenticated using (public.auth_role() = 'admin');

revoke all on function
  public._comm_ventana_idempotencia(), public._comm_max_intentos(), public._comm_reclamo_caduco(),
  public._comm_encolar(text, text, uuid, jsonb), public._comm_tr_orders(), public._comm_tr_payment_entries(),
  public._comm_autorizar(), public.comm_outbox_guard()
  from public, anon, authenticated;
revoke all on function public.comm_reclamar(int) from public, anon;
revoke all on function public.comm_resolver(uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.comm_reintentar(uuid, boolean) from public, anon;
grant execute on function public.comm_reclamar(int) to authenticated, service_role;
grant execute on function public.comm_resolver(uuid, uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.comm_reintentar(uuid, boolean) to authenticated, service_role;
