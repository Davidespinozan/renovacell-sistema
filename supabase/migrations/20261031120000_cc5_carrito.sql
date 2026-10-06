-- ============================================================================
-- CC-5 · CARRITO CANÓNICO SERVER-SIDE = INTENCIÓN DE COMPRA DURABLE.
--
-- CART = PRODUCT + QUANTITY + OWNER + CONTEXT. Nada más es autoridad aquí:
--   · el precio es una PROYECCIÓN calculada en lectura con la MISMA autoridad de CC-4/W2
--     (cc_ia_precio → precio_de con la lista del perfil y la cantidad); nunca se persiste;
--   · la disponibilidad es una PROYECCIÓN (cc_ia_disponibilidad → v_stock_disponible agregada);
--     agregar NO reserva;
--   · el carrito NO crea pedidos, NO toca dinero, inventario ni CFDI; `preparar_checkout` es
--     solo lectura/validación; la conversión futura mapeará items → crear_pedido (W1), no aquí.
--
-- Identidad: dueño = visitante (posesión del token CC-1) o perfil (JWT). Conocer cart_id no da
-- acceso. Un carrito ACTIVE por visitante no adoptado y uno por perfil. La adopción (CC-1) se
-- extiende aquí (misma transacción): si el perfil ya tenía carrito activo, el del visitante se
-- FUSIONA (cantidades se suman, acotadas) y queda 'merged'; si no, el del visitante conserva su
-- id y gana profile_id. Idempotencia por (cart, operation_id) con hash del payload; eventos
-- append-only; vendedor asignado por CC-2 solo lee; oferta de asesor con política en el servidor
-- (una por carrito, cooldown 7 días tras rechazo) y redacción en la IA.
--
-- Rollback: supabase/rollback/cc5/99_down.sql.
-- ============================================================================

do $pre$
begin
  if to_regclass('public.cc_visitors') is null or to_regclass('public.cc_conversations') is null then raise exception 'CC5: faltan CC-1/CC-2'; end if;
  if to_regprocedure('public._cc_producto_visible(uuid,text)') is null then raise exception 'CC5: falta CC-3'; end if;
  if to_regprocedure('public.cc_ia_precio(uuid,uuid,int)') is null or to_regprocedure('public.cc_ia_contexto_actor(uuid)') is null then raise exception 'CC5: falta CC-4'; end if;
  if to_regprocedure('public.cc_visitante_adoptar(text,uuid)') is null or pg_get_functiondef('public.cc_visitante_adoptar(text,uuid)'::regprocedure) not like '%_cc_adoptar_conversaciones%' then raise exception 'CC5: cc_visitante_adoptar no es la versión CC-2'; end if;
  if to_regclass('public.cc_carts') is not null then raise exception 'CC5: ya aplicada'; end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1) TABLAS
-- ---------------------------------------------------------------------------
create table public.cc_carts (
  id                    uuid primary key default gen_random_uuid(),
  estado                text not null default 'active',
  visitor_id            uuid references public.cc_visitors(id) on delete restrict,
  profile_id            uuid references public.profiles(id) on delete set null,
  conversation_id       uuid references public.cc_conversations(id) on delete set null,
  rev                   int  not null default 1,
  merged_into_cart_id   uuid references public.cc_carts(id) on delete set null,
  converted_order_id    uuid references public.orders(id) on delete set null,
  oferta_estado         text,
  oferta_at             timestamptz,
  oferta_respondida_at  timestamptz,
  oferta_siguiente_at   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  last_activity_at      timestamptz not null default now(),
  closed_at             timestamptz,
  constraint ck_ccart_estado check (estado in ('active', 'merged', 'closed', 'converted')),
  constraint ck_ccart_dueno check (visitor_id is not null or profile_id is not null),
  constraint ck_ccart_oferta check (oferta_estado is null or oferta_estado in ('ofrecida', 'aceptada', 'rechazada')),
  constraint ck_ccart_cerrado check ((estado = 'active') = (closed_at is null)),
  constraint ck_ccart_convertido check ((estado = 'converted') = (converted_order_id is not null))
);
create unique index uq_ccart_visitor_activo on public.cc_carts (visitor_id) where estado = 'active' and visitor_id is not null and profile_id is null;
create unique index uq_ccart_profile_activo on public.cc_carts (profile_id) where estado = 'active' and profile_id is not null;
create index idx_ccart_conv on public.cc_carts (conversation_id);
comment on table public.cc_carts is 'CC-5 · Intención de compra durable. Sin precio, stock, costo ni fiscal persistidos: todo se proyecta en lectura desde su autoridad.';

create table public.cc_cart_items (
  cart_id     uuid not null references public.cc_carts(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete restrict,
  quantity    int  not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (cart_id, product_id),
  constraint ck_ccitem_qty check (quantity between 1 and 999)
);

create table public.cc_cart_operations (
  cart_id       uuid not null references public.cc_carts(id) on delete cascade,
  operation_id  text not null,
  payload_hash  text not null,
  resultado     jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (cart_id, operation_id),
  constraint ck_ccop_id check (length(operation_id) between 1 and 120)
);

create table public.cc_cart_events (
  id                bigint generated always as identity primary key,
  cart_id           uuid not null references public.cc_carts(id) on delete cascade,
  tipo              text not null,
  actor_type        text not null,
  actor_profile_id  uuid,
  actor_visitor_id  uuid,
  product_id        uuid,
  qty_antes         int,
  qty_despues       int,
  detalle           jsonb,
  created_at        timestamptz not null default now(),
  constraint ck_ccev_tipo check (tipo in ('opened', 'item_added', 'first_item_added', 'item_quantity_changed', 'item_removed', 'emptied', 'merged', 'adopted', 'closed', 'converted', 'conversation_linked', 'seller_offer_triggered', 'seller_offer_accepted', 'seller_offer_dismissed', 'checkout_prepared')),
  constraint ck_ccev_actor check (actor_type in ('visitor', 'doctor', 'seller', 'admin', 'ai', 'system')),
  constraint ck_ccev_detalle check (detalle is null or length(detalle::text) <= 1000)
);
create index idx_ccev_cart on public.cc_cart_events (cart_id, created_at);
create trigger trg_ccev_append_only before update or delete on public.cc_cart_events for each row execute function public._cc_append_only();

alter table public.cc_carts enable row level security;
alter table public.cc_cart_items enable row level security;
alter table public.cc_cart_operations enable row level security;
alter table public.cc_cart_events enable row level security;
revoke all on public.cc_carts, public.cc_cart_items, public.cc_cart_operations, public.cc_cart_events from public, anon, authenticated;
grant select on public.cc_cart_events to authenticated;
create policy ccev_select_admin on public.cc_cart_events for select to authenticated using (public.auth_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 2) HELPERS
-- ---------------------------------------------------------------------------
create or replace function public._cc_cart_evento(p_cart uuid, p_tipo text, p_actor_type text, p_profile uuid, p_visitor uuid, p_product uuid default null, p_antes int default null, p_despues int default null, p_detalle jsonb default null) returns void
  language sql set search_path = public as
$$ insert into public.cc_cart_events (cart_id, tipo, actor_type, actor_profile_id, actor_visitor_id, product_id, qty_antes, qty_despues, detalle) values (p_cart, p_tipo, p_actor_type, p_profile, p_visitor, p_product, p_antes, p_despues, p_detalle) $$;

-- Autoridad sobre un carrito: dueño (visitante por posesión / perfil), asesor ASIGNADO por CC-2 a una
-- conversación del dueño (solo lectura), Dirección (supervisor, solo lectura). Lo demás: NO_AUTORIZADO.
create or replace function public._cc_cart_autoridad(p_cart uuid, p_actor_type text, p_visitor uuid, p_profile uuid) returns text
  language plpgsql stable set search_path = public as
$$
declare c record; v_rol text;
begin
  select * into c from public.cc_carts where id = p_cart;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_actor_type = 'visitor' then
    if p_visitor is not null and c.visitor_id = p_visitor and c.profile_id is null then return 'dueno'; end if;
  elsif p_actor_type in ('doctor', 'ai') then
    if p_profile is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
    if public._cc_perfil_activo(p_profile) is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
    if c.profile_id = p_profile then return 'dueno'; end if;
  elsif p_actor_type = 'seller' then
    if public._cc_perfil_activo(p_profile) is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
    if public._cc_puede_atender(p_profile) and exists (
         select 1 from public.cc_conversations cv where cv.seller_profile_id = p_profile and cv.estado = 'abierta' and cv.modo in ('human_assigned', 'human_active')
            and ((c.profile_id is not null and cv.profile_id = c.profile_id) or (c.profile_id is null and cv.visitor_id = c.visitor_id))) then
      return 'asesor';
    end if;
  elsif p_actor_type = 'admin' then
    v_rol := public._cc_perfil_activo(p_profile);
    if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
    if v_rol = 'admin' then return 'supervisor'; end if;
  end if;
  raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
end;
$$;

-- Carrito ACTIVE del dueño (lo crea si no existe). Dueño = visitante (si no hay perfil) o perfil.
create or replace function public._cc_cart_activo(p_actor_type text, p_visitor uuid, p_profile uuid, p_conv uuid) returns uuid
  language plpgsql set search_path = public as
$$
declare v_id uuid; v_nuevo boolean := false;
begin
  if p_actor_type = 'visitor' then
    if p_visitor is null then raise exception 'SESION_INVALIDA'; end if;
    perform 1 from public.cc_visitors where id = p_visitor for key share;   -- mismo orden de locks que la adopción
    select id into v_id from public.cc_carts where visitor_id = p_visitor and profile_id is null and estado = 'active' for update;
    if v_id is null then
      -- carrera de aperturas: el índice único parcial decide; el perdedor relee (ON CONFLICT espera al ganador)
      insert into public.cc_carts (visitor_id, conversation_id) values (p_visitor, p_conv)
        on conflict (visitor_id) where estado = 'active' and visitor_id is not null and profile_id is null do nothing returning id into v_id;
      if v_id is not null then v_nuevo := true; else select id into v_id from public.cc_carts where visitor_id = p_visitor and profile_id is null and estado = 'active' for update; end if;
    end if;
  else
    if p_profile is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
    if public._cc_perfil_activo(p_profile) is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
    select id into v_id from public.cc_carts where profile_id = p_profile and estado = 'active' for update;
    if v_id is null then
      insert into public.cc_carts (profile_id, conversation_id) values (p_profile, p_conv)
        on conflict (profile_id) where estado = 'active' and profile_id is not null do nothing returning id into v_id;
      if v_id is not null then v_nuevo := true; else select id into v_id from public.cc_carts where profile_id = p_profile and estado = 'active' for update; end if;
    end if;
  end if;
  if v_nuevo then perform public._cc_cart_evento(v_id, 'opened', p_actor_type, p_profile, p_visitor, null, null, null, case when p_conv is not null then jsonb_build_object('conversation_id', p_conv) end); end if;
  if p_conv is not null then
    update public.cc_carts set conversation_id = p_conv, updated_at = now() where id = v_id and conversation_id is distinct from p_conv;
    if found and not v_nuevo then perform public._cc_cart_evento(v_id, 'conversation_linked', p_actor_type, p_profile, p_visitor, null, null, null, jsonb_build_object('conversation_id', p_conv)); end if;
  end if;
  return v_id;
end;
$$;

-- Idempotencia: misma operación + mismo payload → mismo resultado; mismo id + payload distinto → conflicto.
create or replace function public._cc_cart_operacion(p_cart uuid, p_op text, p_payload jsonb) returns jsonb
  language plpgsql set search_path = public as
$$
declare e record; h text := md5(coalesce(p_payload::text, ''));
begin
  if p_op is null then return null; end if;
  select * into e from public.cc_cart_operations where cart_id = p_cart and operation_id = p_op;
  if found then
    if e.payload_hash <> h then raise exception 'IDEMPOTENCIA_CONFLICTO' using errcode = 'unique_violation'; end if;
    return e.resultado || jsonb_build_object('idempotente', true);
  end if;
  return null;
end;
$$;
create or replace function public._cc_cart_registrar_op(p_cart uuid, p_op text, p_payload jsonb, p_resultado jsonb) returns void
  language sql set search_path = public as
$$ insert into public.cc_cart_operations (cart_id, operation_id, payload_hash, resultado) select p_cart, p_op, md5(coalesce(p_payload::text, '')), p_resultado where p_op is not null $$;

-- Resolver actor → (visitor_id, profile) y audiencia. `ai` actúa EN NOMBRE del dueño (visitante o doctor).
create or replace function public._cc_cart_actor(p_actor_type text, p_visitor_hash text, p_profile uuid) returns record
  language plpgsql stable set search_path = public as
$$
declare v_visitor uuid; r record;
begin
  if p_actor_type not in ('visitor', 'doctor', 'seller', 'admin') then raise exception 'ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
  if p_actor_type = 'visitor' then
    v_visitor := public._cc_visitor_por_hash(p_visitor_hash);
    if v_visitor is null then raise exception 'SESION_INVALIDA'; end if;
  end if;
  select v_visitor as visitor, case when p_actor_type = 'visitor' then null else p_profile end as profile into r;
  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) PROYECCIÓN (lectura): identidad + cantidad + precio/disponibilidad CALCULADOS con la autoridad del lector.
-- ---------------------------------------------------------------------------
create or replace function public.cc_carrito_proyeccion(p_cart uuid, p_lector uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare c record; ctx jsonb; aud text; it record; items jsonb := '[]'::jsonb; pr jsonb; disp jsonb; total numeric := 0; completo boolean := true; n int := 0; q int := 0; visible boolean; precio jsonb;
begin
  select * into c from public.cc_carts where id = p_cart;
  if not found then return null; end if;
  ctx := public.cc_ia_contexto_actor(p_lector);
  aud := ctx ->> 'audiencia';
  for it in select i.product_id, i.quantity, p.name, p.odoo_reference, p.image_url, p.active, p.sellable, p.show_landing, p.show_portal
              from public.cc_cart_items i join public.products p on p.id = i.product_id where i.cart_id = p_cart order by i.created_at loop
    n := n + 1; q := q + it.quantity;
    visible := it.active and (case when aud = 'public' then it.show_landing else (it.show_portal or it.show_landing) end);
    if (ctx ->> 'puede_precio')::boolean then
      pr := public.cc_ia_precio(p_lector, it.product_id, it.quantity);
      if (pr ->> 'autorizado')::boolean then
        precio := jsonb_build_object('estado', 'autorizado', 'unitario', (pr ->> 'precio_unitario')::numeric, 'subtotal', (pr ->> 'total')::numeric, 'por_volumen', (pr ->> 'por_volumen')::boolean, 'moneda', 'MXN');
        total := total + (pr ->> 'total')::numeric;
      else
        precio := jsonb_build_object('estado', 'sin_precio', 'motivo', pr ->> 'motivo'); completo := false;
      end if;
    else
      precio := jsonb_build_object('estado', 'requiere_verificacion'); completo := false;
    end if;
    if (ctx ->> 'puede_stock')::boolean then
      disp := public.cc_ia_disponibilidad(p_lector, it.product_id);
    else
      disp := jsonb_build_object('estado', 'requiere_verificacion');
    end if;
    items := items || jsonb_build_object('product_id', it.product_id, 'nombre', it.name, 'presentacion', it.odoo_reference, 'imagen_url', it.image_url, 'cantidad', it.quantity,
                                         'vendible', it.active and it.sellable, 'visible', visible,
                                         'disponibilidad', case when not (it.active and it.sellable) then 'no_vendible' else coalesce(disp ->> 'estado', disp ->> 'motivo', 'desconocida') end,
                                         'precio', precio);
  end loop;
  return jsonb_build_object('cart_id', c.id, 'estado', c.estado, 'rev', c.rev, 'dueno', case when c.profile_id is not null then 'profile' else 'visitor' end,
    'audiencia', aud, 'puede_precio', (ctx ->> 'puede_precio')::boolean, 'conversation_id', c.conversation_id,
    'items', items, 'n_items', n, 'cantidad_total', q,
    'total', case when n = 0 then jsonb_build_object('estado', 'vacio') when not (ctx ->> 'puede_precio')::boolean then jsonb_build_object('estado', 'requiere_verificacion')
                  when completo then jsonb_build_object('estado', 'completo', 'monto', round(total, 2), 'moneda', 'MXN') else jsonb_build_object('estado', 'parcial', 'moneda', 'MXN') end,
    'oferta_asesor', jsonb_build_object('estado', c.oferta_estado, 'siguiente_at', c.oferta_siguiente_at),
    'last_activity_at', c.last_activity_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) COMANDOS (service_role; la Edge `cart` y las herramientas de CC-4 los llaman)
-- ---------------------------------------------------------------------------
create or replace function public.cc_carrito_abrir(p_actor_type text, p_visitor_hash text, p_profile uuid, p_conv uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a record; v_cart uuid;
begin
  if p_actor_type not in ('visitor', 'doctor') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  a := public._cc_cart_actor(p_actor_type, p_visitor_hash, p_profile);
  if p_conv is not null then perform public._cc_autoridad(p_conv, p_actor_type, a.visitor, a.profile); end if;   -- solo liga conversaciones propias
  v_cart := public._cc_cart_activo(p_actor_type, a.visitor, a.profile, p_conv);
  return public.cc_carrito_proyeccion(v_cart, a.profile);
end;
$$;

-- Ver: dueño, asesor asignado (precio solo si SU rol lo tiene) o Dirección.
create or replace function public.cc_carrito_ver(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a record; v_rol text;
begin
  a := public._cc_cart_actor(p_actor_type, p_visitor_hash, p_profile);
  v_rol := public._cc_cart_autoridad(p_cart, p_actor_type, a.visitor, a.profile);
  return public.cc_carrito_proyeccion(p_cart, a.profile) || jsonb_build_object('rol', v_rol);
end;
$$;

-- Mutación común: valida autoridad de DUEÑO, estado active, producto (para agregar), idempotencia, eventos, rev.
create or replace function public._cc_cart_mutar(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_accion text, p_product uuid, p_qty int, p_op text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a record; c record; v_rol text; prev jsonb; payload jsonb; antes int; despues int; n_antes int; n_despues int; ctx jsonb; aud text; prod record; res jsonb; primera boolean := false; v_actor text := p_actor_type;
begin
  if p_actor_type not in ('visitor', 'doctor', 'ai') then raise exception 'NO_AUTORIZADO: solo el dueño modifica su carrito' using errcode = 'insufficient_privilege'; end if;
  -- `ai` actúa en nombre del dueño: con hash = visitante; con perfil = doctor.
  if p_actor_type = 'ai' then v_actor := case when p_visitor_hash is not null then 'visitor' else 'doctor' end; end if;
  a := public._cc_cart_actor(v_actor, p_visitor_hash, p_profile);
  v_rol := public._cc_cart_autoridad(p_cart, v_actor, a.visitor, a.profile);
  if v_rol <> 'dueno' then raise exception 'NO_AUTORIZADO: solo el dueño modifica su carrito' using errcode = 'insufficient_privilege'; end if;
  if a.visitor is not null then perform 1 from public.cc_visitors where id = a.visitor for key share; end if;
  select * into c from public.cc_carts where id = p_cart for update;
  if c.estado <> 'active' then raise exception 'CARRITO_CERRADO: %', c.estado using errcode = 'check_violation'; end if;
  payload := jsonb_build_object('accion', p_accion, 'product_id', p_product, 'qty', p_qty);
  prev := public._cc_cart_operacion(p_cart, p_op, payload);
  if prev is not null then return prev; end if;

  if p_accion in ('agregar', 'actualizar') then
    if p_qty is null or p_qty < 0 or p_qty > 999 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'check_violation'; end if;
    if p_accion = 'agregar' and p_qty = 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'check_violation'; end if;
  end if;
  select count(*) into n_antes from public.cc_cart_items where cart_id = p_cart;
  select quantity into antes from public.cc_cart_items where cart_id = p_cart and product_id = p_product;

  if p_accion = 'agregar' or (p_accion = 'actualizar' and p_qty > 0) then
    ctx := public.cc_ia_contexto_actor(a.profile); aud := ctx ->> 'audiencia';
    select p.id, p.active, p.sellable, p.name into prod from public.products p where p.id = p_product;
    if prod.id is null or not prod.active or not public._cc_producto_visible(p_product, aud) then raise exception 'PRODUCTO_NO_DISPONIBLE' using errcode = 'check_violation'; end if;
    if not prod.sellable then raise exception 'PRODUCTO_NO_VENDIBLE' using errcode = 'check_violation'; end if;
    despues := case when p_accion = 'agregar' then least(coalesce(antes, 0) + p_qty, 999) else p_qty end;
    insert into public.cc_cart_items (cart_id, product_id, quantity) values (p_cart, p_product, despues)
      on conflict (cart_id, product_id) do update set quantity = excluded.quantity, updated_at = now();
    if antes is null then
      perform public._cc_cart_evento(p_cart, 'item_added', p_actor_type, a.profile, a.visitor, p_product, 0, despues);
      if n_antes = 0 then primera := true; perform public._cc_cart_evento(p_cart, 'first_item_added', p_actor_type, a.profile, a.visitor, p_product, 0, despues); end if;
    elsif antes <> despues then
      perform public._cc_cart_evento(p_cart, 'item_quantity_changed', p_actor_type, a.profile, a.visitor, p_product, antes, despues);
    end if;
  elsif p_accion in ('quitar', 'actualizar') then    -- actualizar con 0 = quitar (documentado)
    delete from public.cc_cart_items where cart_id = p_cart and product_id = p_product;
    if found then perform public._cc_cart_evento(p_cart, 'item_removed', p_actor_type, a.profile, a.visitor, p_product, antes, 0); end if;
    despues := 0;
  elsif p_accion = 'vaciar' then
    delete from public.cc_cart_items where cart_id = p_cart;
    if n_antes > 0 then perform public._cc_cart_evento(p_cart, 'emptied', p_actor_type, a.profile, a.visitor, null, n_antes, 0); end if;
  else
    raise exception 'ACCION_INVALIDA' using errcode = 'check_violation';
  end if;

  select count(*) into n_despues from public.cc_cart_items where cart_id = p_cart;
  update public.cc_carts set rev = rev + 1, updated_at = now(), last_activity_at = now() where id = p_cart;
  res := jsonb_build_object('cart_id', p_cart, 'accion', p_accion, 'product_id', p_product, 'qty_antes', coalesce(antes, 0), 'qty_despues', coalesce(despues, 0), 'n_items', n_despues, 'rev', c.rev + 1, 'idempotente', false,
    -- Elegibilidad de oferta de asesor: la decide el SERVIDOR. Primera vez que el carrito deja de estar vacío
    -- y sin oferta previa (o cooldown vencido tras un rechazo).
    'oferta_elegible', primera and (c.oferta_estado is null or (c.oferta_estado = 'rechazada' and c.oferta_siguiente_at <= now())));
  perform public._cc_cart_registrar_op(p_cart, p_op, payload, res);
  return res;
end;
$$;

create or replace function public.cc_carrito_agregar(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_product uuid, p_qty int, p_op text default null) returns jsonb
  language sql security definer set search_path = public as
$$ select public._cc_cart_mutar(p_cart, p_actor_type, p_visitor_hash, p_profile, 'agregar', p_product, p_qty, p_op) $$;
create or replace function public.cc_carrito_actualizar(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_product uuid, p_qty int, p_op text default null) returns jsonb
  language sql security definer set search_path = public as
$$ select public._cc_cart_mutar(p_cart, p_actor_type, p_visitor_hash, p_profile, 'actualizar', p_product, p_qty, p_op) $$;
create or replace function public.cc_carrito_quitar(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_product uuid, p_op text default null) returns jsonb
  language sql security definer set search_path = public as
$$ select public._cc_cart_mutar(p_cart, p_actor_type, p_visitor_hash, p_profile, 'quitar', p_product, null, p_op) $$;
create or replace function public.cc_carrito_vaciar(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_op text default null) returns jsonb
  language sql security definer set search_path = public as
$$ select public._cc_cart_mutar(p_cart, p_actor_type, p_visitor_hash, p_profile, 'vaciar', null, null, p_op) $$;

-- Oferta de asesor: el servidor registra ofrecer/aceptar/rechazar; la ELEGIBILIDAD la calculó la mutación.
-- Cooldown tras rechazo: 7 días (D-CC5-05). Una oferta por carrito (D-CC5-04).
create or replace function public.cc_carrito_oferta(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_accion text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a record; c record; v_actor text := p_actor_type;
begin
  if p_actor_type = 'ai' then v_actor := case when p_visitor_hash is not null then 'visitor' else 'doctor' end; end if;
  a := public._cc_cart_actor(v_actor, p_visitor_hash, p_profile);
  if public._cc_cart_autoridad(p_cart, v_actor, a.visitor, a.profile) <> 'dueno' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_carts where id = p_cart for update;
  if p_accion = 'ofrecer' then
    if c.oferta_estado is not null and not (c.oferta_estado = 'rechazada' and c.oferta_siguiente_at <= now()) then
      return jsonb_build_object('oferta_estado', c.oferta_estado, 'registrada', false, 'motivo', 'no_elegible');
    end if;
    update public.cc_carts set oferta_estado = 'ofrecida', oferta_at = now(), oferta_respondida_at = null, oferta_siguiente_at = null, updated_at = now() where id = p_cart;
    perform public._cc_cart_evento(p_cart, 'seller_offer_triggered', p_actor_type, a.profile, a.visitor);
    return jsonb_build_object('oferta_estado', 'ofrecida', 'registrada', true);
  elsif p_accion = 'aceptar' then
    if c.oferta_estado = 'aceptada' then return jsonb_build_object('oferta_estado', 'aceptada', 'registrada', false, 'idempotente', true); end if;
    update public.cc_carts set oferta_estado = 'aceptada', oferta_respondida_at = now(), oferta_siguiente_at = null, updated_at = now() where id = p_cart;
    perform public._cc_cart_evento(p_cart, 'seller_offer_accepted', p_actor_type, a.profile, a.visitor);
    return jsonb_build_object('oferta_estado', 'aceptada', 'registrada', true);
  elsif p_accion = 'rechazar' then
    if c.oferta_estado = 'rechazada' then return jsonb_build_object('oferta_estado', 'rechazada', 'registrada', false, 'idempotente', true, 'siguiente_at', c.oferta_siguiente_at); end if;
    update public.cc_carts set oferta_estado = 'rechazada', oferta_respondida_at = now(), oferta_siguiente_at = now() + interval '7 days', updated_at = now() where id = p_cart;
    perform public._cc_cart_evento(p_cart, 'seller_offer_dismissed', p_actor_type, a.profile, a.visitor);
    return jsonb_build_object('oferta_estado', 'rechazada', 'registrada', true, 'siguiente_at', now() + interval '7 days');
  end if;
  raise exception 'ACCION_INVALIDA' using errcode = 'check_violation';
end;
$$;

-- PREPARAR CHECKOUT: solo lectura/validación. No crea pedido, no cobra, no reserva.
create or replace function public.cc_carrito_preparar_checkout(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare a record; c record; ctx jsonb; proy jsonb; problemas jsonb := '[]'::jsonb; it jsonb; v_rol text;
begin
  a := public._cc_cart_actor(case when p_actor_type = 'ai' then 'doctor' else p_actor_type end, p_visitor_hash, p_profile);
  v_rol := public._cc_cart_autoridad(p_cart, case when p_actor_type = 'ai' then 'doctor' else p_actor_type end, a.visitor, a.profile);
  if v_rol <> 'dueno' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_carts where id = p_cart;
  ctx := public.cc_ia_contexto_actor(a.profile);
  if a.profile is null then problemas := problemas || '"REQUIERE_CUENTA"'::jsonb;
  elsif not (ctx ->> 'puede_precio')::boolean then problemas := problemas || '"REQUIERE_VERIFICACION"'::jsonb; end if;
  if c.estado <> 'active' then problemas := problemas || '"CARRITO_CERRADO"'::jsonb; end if;
  proy := public.cc_carrito_proyeccion(p_cart, a.profile);
  if (proy ->> 'n_items')::int = 0 then problemas := problemas || '"CARRITO_VACIO"'::jsonb; end if;
  for it in select * from jsonb_array_elements(proy -> 'items') loop
    if not (it ->> 'vendible')::boolean or not (it ->> 'visible')::boolean then problemas := problemas || jsonb_build_object('product_id', it ->> 'product_id', 'problema', 'NO_VENDIBLE'); end if;
    if it -> 'precio' ->> 'estado' = 'sin_precio' then problemas := problemas || jsonb_build_object('product_id', it ->> 'product_id', 'problema', 'SIN_PRECIO'); end if;
    if it ->> 'disponibilidad' in ('no_disponible') then problemas := problemas || jsonb_build_object('product_id', it ->> 'product_id', 'problema', 'SIN_DISPONIBILIDAD'); end if;
  end loop;
  perform public._cc_cart_evento(p_cart, 'checkout_prepared', p_actor_type, a.profile, a.visitor, null, null, null, jsonb_build_object('listo', jsonb_array_length(problemas) = 0, 'problemas', jsonb_array_length(problemas)));
  return jsonb_build_object('cart_id', p_cart, 'listo', jsonb_array_length(problemas) = 0, 'problemas', problemas, 'proyeccion', proy,
    -- Contrato para el checkout futuro (W1 crear_pedido): p_lines = [{product_id, qty}]; el precio lo pone el servidor.
    'lineas_crear_pedido', (select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.quantity) order by i.created_at), '[]'::jsonb) from public.cc_cart_items i where i.cart_id = p_cart));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) ADOPCIÓN (CC-1) extendida: fusión determinista de carritos en la MISMA transacción.
-- ---------------------------------------------------------------------------
create or replace function public._cc_adoptar_carritos(p_visitor uuid, p_profile uuid) returns int
  language plpgsql set search_path = public as
$$
declare vc record; pc uuid; it record; antes int; n int := 0;
begin
  select id into pc from public.cc_carts where profile_id = p_profile and estado = 'active' for update;
  for vc in select * from public.cc_carts where visitor_id = p_visitor and profile_id is null and estado = 'active' order by created_at for update loop
    if pc is null then
      -- el perfil no tenía carrito: el del visitante conserva su id y gana dueño
      update public.cc_carts set profile_id = p_profile, rev = rev + 1, updated_at = now() where id = vc.id;
      perform public._cc_cart_evento(vc.id, 'adopted', 'system', p_profile, p_visitor);
      pc := vc.id;
    else
      -- fusión: cantidades del mismo producto se SUMAN (acotadas a 999); nada se pierde ni se duplica
      for it in select product_id, quantity from public.cc_cart_items where cart_id = vc.id loop
        select quantity into antes from public.cc_cart_items where cart_id = pc and product_id = it.product_id;
        insert into public.cc_cart_items (cart_id, product_id, quantity) values (pc, it.product_id, least(coalesce(antes, 0) + it.quantity, 999))
          on conflict (cart_id, product_id) do update set quantity = excluded.quantity, updated_at = now();
        perform public._cc_cart_evento(pc, case when antes is null then 'item_added' else 'item_quantity_changed' end, 'system', p_profile, p_visitor, it.product_id, coalesce(antes, 0), least(coalesce(antes, 0) + it.quantity, 999), jsonb_build_object('origen', 'merge', 'desde', vc.id));
      end loop;
      update public.cc_carts set profile_id = p_profile, estado = 'merged', merged_into_cart_id = pc, closed_at = now(), updated_at = now() where id = vc.id;
      update public.cc_carts set rev = rev + 1, updated_at = now(), last_activity_at = now() where id = pc;
      perform public._cc_cart_evento(vc.id, 'merged', 'system', p_profile, p_visitor, null, null, null, jsonb_build_object('en', pc));
      perform public._cc_cart_evento(pc, 'merged', 'system', p_profile, p_visitor, null, null, null, jsonb_build_object('desde', vc.id));
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- cc_visitante_adoptar: texto CC-2 + gancho de carritos (misma transacción, después de las conversaciones).
create or replace function public.cc_visitante_adoptar(p_hash text, p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  prof record; v public.cc_visitors%rowtype; n int := 0; r record; convs int := 0; carts int := 0;
begin
  if p_profile is null then raise exception 'CC1_ARGUMENTOS: perfil requerido' using errcode = 'invalid_parameter_value'; end if;
  select id, active, role_id into prof from public.profiles where id = p_profile;
  if not found then raise exception 'PERFIL_INEXISTENTE'; end if;
  if not prof.active then raise exception 'CUENTA_SUSPENDIDA'; end if;

  if p_hash is not null then
    if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'SESION_INVALIDA'; end if;
    select * into v from public.cc_visitors where token_hash = p_hash and estado in ('activo', 'adoptado') for update;
    if not found then raise exception 'SESION_INVALIDA'; end if;
    if v.estado = 'adoptado' then
      if v.adopted_profile_id = p_profile then
        return jsonb_build_object('estado', 'ya_adoptado', 'visitor_id', v.id, 'adoptados', 0);
      end if;
      insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v.id, 'conflicto', '{"motivo":"adoptado_por_otro"}', p_profile);
      return jsonb_build_object('estado', 'ajeno', 'adoptados', 0);
    end if;
    if v.pending_profile_id is not null and v.pending_profile_id <> p_profile then
      insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v.id, 'conflicto', '{"motivo":"registrado_por_otro"}', p_profile);
      return jsonb_build_object('estado', 'ajeno', 'adoptados', 0);
    end if;
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = v.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (v.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (v.id, 'revocado', '{"motivo":"adopcion"}');
    convs := public._cc_adoptar_conversaciones(v.id, p_profile);   -- CC-2
    carts := public._cc_adoptar_carritos(v.id, p_profile);         -- CC-5
    return jsonb_build_object('estado', 'adoptado', 'visitor_id', v.id, 'adoptados', 1, 'conversaciones', convs, 'carritos', carts);
  end if;

  for r in select id from public.cc_visitors where pending_profile_id = p_profile and estado = 'activo' order by created_at for update loop
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = r.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (r.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (r.id, 'revocado', '{"motivo":"adopcion"}');
    convs := convs + public._cc_adoptar_conversaciones(r.id, p_profile);   -- CC-2
    carts := carts + public._cc_adoptar_carritos(r.id, p_profile);         -- CC-5
    n := n + 1;
  end loop;
  return jsonb_build_object('estado', case when n > 0 then 'adoptado' else 'nada' end, 'adoptados', n, 'conversaciones', convs, 'carritos', carts);
end;
$$;

-- cc_visitantes_purgar: texto CC-2 + no purgar visitantes con carrito (intención durable).
create or replace function public.cc_visitantes_purgar(p_dias int default 90) returns int
language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  if p_dias is null or p_dias < 30 then raise exception 'CC1_ARGUMENTOS: la retención mínima es 30 días' using errcode = 'invalid_parameter_value'; end if;
  perform set_config('app.cc_purga', 'on', true);
  delete from public.cc_visitors v
   where v.estado = 'activo' and v.adopted_profile_id is null and v.pending_profile_id is null
     and v.last_seen_at < now() - make_interval(days => p_dias)
     and not exists (select 1 from public.prospects p where p.visitor_id = v.id)
     and not exists (select 1 from public.cc_conversations c where c.visitor_id = v.id)
     and not exists (select 1 from public.cc_messages m where m.actor_visitor_id = v.id)
     and not exists (select 1 from public.cc_carts k where k.visitor_id = v.id);   -- CC-5
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) PRIVILEGIOS
-- ---------------------------------------------------------------------------
revoke all on function public.cc_carrito_proyeccion(uuid, uuid), public.cc_carrito_abrir(text, text, uuid, uuid), public.cc_carrito_ver(uuid, text, text, uuid),
  public._cc_cart_mutar(uuid, text, text, uuid, text, uuid, int, text), public.cc_carrito_agregar(uuid, text, text, uuid, uuid, int, text), public.cc_carrito_actualizar(uuid, text, text, uuid, uuid, int, text),
  public.cc_carrito_quitar(uuid, text, text, uuid, uuid, text), public.cc_carrito_vaciar(uuid, text, text, uuid, text), public.cc_carrito_oferta(uuid, text, text, uuid, text), public.cc_carrito_preparar_checkout(uuid, text, text, uuid),
  public._cc_adoptar_carritos(uuid, uuid), public._cc_cart_evento(uuid, text, text, uuid, uuid, uuid, int, int, jsonb), public._cc_cart_autoridad(uuid, text, uuid, uuid), public._cc_cart_activo(text, uuid, uuid, uuid),
  public._cc_cart_operacion(uuid, text, jsonb), public._cc_cart_registrar_op(uuid, text, jsonb, jsonb), public._cc_cart_actor(text, text, uuid) from public, anon, authenticated;
grant execute on function public.cc_carrito_abrir(text, text, uuid, uuid), public.cc_carrito_ver(uuid, text, text, uuid), public.cc_carrito_agregar(uuid, text, text, uuid, uuid, int, text),
  public.cc_carrito_actualizar(uuid, text, text, uuid, uuid, int, text), public.cc_carrito_quitar(uuid, text, text, uuid, uuid, text), public.cc_carrito_vaciar(uuid, text, text, uuid, text),
  public.cc_carrito_oferta(uuid, text, text, uuid, text), public.cc_carrito_preparar_checkout(uuid, text, text, uuid) to service_role;

do $post$
begin
  if has_function_privilege('authenticated', 'public.cc_carrito_agregar(uuid,text,text,uuid,uuid,int,text)', 'EXECUTE') or has_function_privilege('anon', 'public.cc_carrito_ver(uuid,text,text,uuid)', 'EXECUTE') then raise exception 'CC5: clientes con acceso a comandos de carrito'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('cc_carts', 'cc_cart_items', 'cc_cart_operations') and grantee in ('anon', 'authenticated')) then raise exception 'CC5: clientes con grants en tablas de carrito'; end if;
  if pg_get_functiondef('public.cc_visitante_adoptar(text,uuid)'::regprocedure) not like '%_cc_adoptar_carritos%' or pg_get_functiondef('public.cc_visitante_adoptar(text,uuid)'::regprocedure) not like '%_cc_adoptar_conversaciones%' then raise exception 'CC5: adopción sin ganchos'; end if;
  if (select count(*) from information_schema.columns where table_name = 'cc_cart_items' and column_name in ('unit_price', 'price', 'subtotal', 'discount', 'stock', 'cost')) > 0 then raise exception 'CC5: el carrito no persiste autoridad económica'; end if;
end $post$;
