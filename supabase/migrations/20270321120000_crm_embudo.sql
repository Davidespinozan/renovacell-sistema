-- ============================================================================
-- CRM · EMBUDO DE VENTAS (2 nov 2026, dueño: "meter funciones de CRM: nuevo, calificado, propuesta, ganado").
-- Decisiones del dueño: entran OPORTUNIDADES DE VENTA (un médico nuevo que escribió, o un cliente actual con una venta
-- nueva en curso); avance AUTOMÁTICO + manual; cada vendedor ve lo suyo, Dirección y el jefe de ventas todo.
--   · nuevo      → escribe por WhatsApp / portal / enlace y no tiene otra oportunidad abierta
--   · calificado → queda verificado o ligado a su ficha de cliente (o el vendedor lo marca)
--   · propuesta  → se le manda cotización o se le levanta un pedido
--   · ganado     → su pedido queda pagado (o liberado a crédito)
--   · perdido    → solo a mano, con motivo
-- Nunca retrocede sola; el vendedor la puede mover a mano (con motivo para Perdido). Todo queda en su historial.
-- Las reglas automáticas NUNCA detienen el chat, la cotización ni el pedido (fallan en silencio con aviso).
-- ============================================================================
create table if not exists public.crm_oportunidades (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.cc_conversations(id) on delete set null,
  seller_profile_id uuid references public.profiles(id) on delete set null,
  etapa text not null default 'nuevo' check (etapa in ('nuevo', 'calificado', 'propuesta', 'ganado', 'perdido')),
  titulo text check (length(titulo) <= 120),
  monto_estimado numeric(14,2) check (monto_estimado >= 0),
  origen text not null default 'vendedor' check (origen in ('whatsapp', 'portal', 'enlace', 'vendedor', 'cotizacion', 'pedido')),
  cotizacion_id uuid references public.cotizaciones(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  motivo_perdida text check (length(motivo_perdida) <= 300),
  etapa_at timestamptz not null default now(),
  cerrada_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_crm_op_abierta_cliente on public.crm_oportunidades (customer_id) where etapa not in ('ganado', 'perdido');
create index if not exists ix_crm_op_abierta_conv on public.crm_oportunidades (conversation_id) where etapa not in ('ganado', 'perdido');
create index if not exists ix_crm_op_vendedor on public.crm_oportunidades (seller_profile_id, etapa);
create table if not exists public.crm_oportunidad_eventos (
  id bigserial primary key,
  oportunidad_id uuid not null references public.crm_oportunidades(id) on delete cascade,
  etapa_anterior text, etapa_nueva text not null, motivo text, automatico boolean not null default false,
  actor uuid, at timestamptz not null default now()
);
alter table public.crm_oportunidades enable row level security;
alter table public.crm_oportunidad_eventos enable row level security;
revoke all on public.crm_oportunidades, public.crm_oportunidad_eventos from public, anon, authenticated;

-- ── núcleo ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._crm_orden(p text) returns int language sql immutable as
$$ select case p when 'nuevo' then 1 when 'calificado' then 2 when 'propuesta' then 3 when 'ganado' then 4 when 'perdido' then 5 end $$;

-- La oportunidad ABIERTA de esa persona (por ficha, cuenta o conversación).
create or replace function public._crm_abierta(p_customer uuid, p_profile uuid, p_conv uuid) returns uuid
  language sql stable security definer set search_path = public as
$$ select id from public.crm_oportunidades
    where etapa not in ('ganado', 'perdido')
      and ((p_customer is not null and customer_id = p_customer) or (p_profile is not null and profile_id = p_profile) or (p_conv is not null and conversation_id = p_conv))
    order by created_at desc limit 1 $$;

-- Mover de etapa. Automático: solo hacia ADELANTE y nunca desde ganado/perdido. Deja historial.
create or replace function public._crm_avanzar(p_id uuid, p_etapa text, p_auto boolean, p_motivo text default null, p_extra jsonb default '{}'::jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
declare o public.crm_oportunidades;
begin
  select * into o from public.crm_oportunidades where id = p_id for update;
  if not found then return; end if;
  if p_auto and (o.etapa in ('ganado', 'perdido') or public._crm_orden(p_etapa) <= public._crm_orden(o.etapa)) then
    -- no retrocede ni salta desde un cierre; aun así se ligan datos nuevos (cotización/pedido/monto)
    update public.crm_oportunidades set cotizacion_id = coalesce((p_extra ->> 'cotizacion_id')::uuid, cotizacion_id), order_id = coalesce((p_extra ->> 'order_id')::uuid, order_id),
           monto_estimado = coalesce((p_extra ->> 'monto')::numeric, monto_estimado), updated_at = now() where id = p_id and etapa not in ('ganado', 'perdido');
    return;
  end if;
  if o.etapa = p_etapa then return; end if;
  update public.crm_oportunidades set etapa = p_etapa, etapa_at = now(), updated_at = now(),
         cerrada_at = case when p_etapa in ('ganado', 'perdido') then now() end,
         motivo_perdida = case when p_etapa = 'perdido' then p_motivo end,
         cotizacion_id = coalesce((p_extra ->> 'cotizacion_id')::uuid, cotizacion_id), order_id = coalesce((p_extra ->> 'order_id')::uuid, order_id),
         monto_estimado = coalesce((p_extra ->> 'monto')::numeric, monto_estimado)
   where id = p_id;
  insert into public.crm_oportunidad_eventos (oportunidad_id, etapa_anterior, etapa_nueva, motivo, automatico, actor) values (p_id, o.etapa, p_etapa, p_motivo, p_auto, auth.uid());
end;
$$;

create or replace function public._crm_nueva(p_customer uuid, p_profile uuid, p_conv uuid, p_seller uuid, p_etapa text, p_origen text, p_titulo text, p_extra jsonb default '{}'::jsonb) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid;
begin
  insert into public.crm_oportunidades (customer_id, profile_id, conversation_id, seller_profile_id, etapa, origen, titulo, monto_estimado, cotizacion_id, order_id, created_by,
                                        cerrada_at)
  values (p_customer, p_profile, p_conv, p_seller, p_etapa, p_origen, left(p_titulo, 120), (p_extra ->> 'monto')::numeric, (p_extra ->> 'cotizacion_id')::uuid, (p_extra ->> 'order_id')::uuid, auth.uid(),
          case when p_etapa in ('ganado', 'perdido') then now() end)
  returning id into v_id;
  insert into public.crm_oportunidad_eventos (oportunidad_id, etapa_anterior, etapa_nueva, motivo, automatico, actor) values (v_id, null, p_etapa, null, true, auth.uid());
  return v_id;
end;
$$;

-- ── reglas automáticas (cada una a prueba de fallas: nunca detiene la operación) ──────────────────────────
-- NUEVO: escribe por un canal (cliente o visitante) y no tiene oportunidad abierta.
create or replace function public._crm_tr_mensaje() returns trigger language plpgsql security definer set search_path = public as
$$
declare c record; v_cust uuid; v_origen text;
begin
  if new.actor_type not in ('visitor', 'doctor') then return new; end if;
  begin
    select id, profile_id, visitor_id, seller_profile_id, customer_id into c from public.cc_conversations where id = new.conversation_id;
    v_cust := public._cc_cliente_conv(new.conversation_id);
    if public._crm_abierta(v_cust, c.profile_id, c.id) is not null then return new; end if;
    -- una oportunidad nueva por persona cada 30 días como máximo (una plática que sigue no es una venta nueva)
    if exists (select 1 from public.crm_oportunidades x where x.created_at > now() - interval '30 days'
                and ((v_cust is not null and x.customer_id = v_cust) or (c.profile_id is not null and x.profile_id = c.profile_id) or x.conversation_id = c.id)) then return new; end if;
    v_origen := case when exists (select 1 from public.cc_wa_contactos w where c.visitor_id is not null and w.visitor_id = c.visitor_id) then 'whatsapp'
                     when c.profile_id is not null then 'portal' else 'enlace' end;
    perform public._crm_nueva(v_cust, c.profile_id, c.id, coalesce(c.seller_profile_id, case when v_cust is not null then public._cc_vendedor_de_cliente(v_cust) end),
                              case when c.profile_id is not null and exists (select 1 from public.profiles p where p.id = c.profile_id and p.verified) then 'calificado' else 'nuevo' end,
                              v_origen, left(new.content, 80));
  exception when others then raise warning 'CRM: oportunidad desde mensaje no creada: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists crm_desde_mensaje on public.cc_messages;
create trigger crm_desde_mensaje after insert on public.cc_messages for each row execute function public._crm_tr_mensaje();

-- CALIFICADO: la conversación queda ligada a su ficha, o la cuenta queda verificada.
create or replace function public._crm_tr_conversacion() returns trigger language plpgsql security definer set search_path = public as
$$
declare v uuid;
begin
  begin
    if new.customer_id is distinct from old.customer_id and new.customer_id is not null then
      update public.crm_oportunidades set customer_id = new.customer_id, updated_at = now() where conversation_id = new.id and customer_id is null and etapa not in ('ganado', 'perdido');
      for v in select id from public.crm_oportunidades where conversation_id = new.id and etapa = 'nuevo' loop perform public._crm_avanzar(v, 'calificado', true); end loop;
    end if;
    if new.seller_profile_id is distinct from old.seller_profile_id and new.seller_profile_id is not null then
      update public.crm_oportunidades set seller_profile_id = new.seller_profile_id, updated_at = now() where conversation_id = new.id and seller_profile_id is null and etapa not in ('ganado', 'perdido');
    end if;
  exception when others then raise warning 'CRM: conversación: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists crm_desde_conversacion on public.cc_conversations;
create trigger crm_desde_conversacion after update of customer_id, seller_profile_id on public.cc_conversations for each row execute function public._crm_tr_conversacion();

create or replace function public._crm_tr_verificado() returns trigger language plpgsql security definer set search_path = public as
$$
declare v uuid;
begin
  if new.verified and not coalesce(old.verified, false) then
    begin
      for v in select id from public.crm_oportunidades where etapa = 'nuevo' and (profile_id = new.id or customer_id in (select id from public.customers where profile_id = new.id)) loop
        perform public._crm_avanzar(v, 'calificado', true, 'cuenta verificada');
      end loop;
    exception when others then raise warning 'CRM: verificación: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_desde_verificacion on public.profiles;
create trigger crm_desde_verificacion after update of verified on public.profiles for each row execute function public._crm_tr_verificado();

-- PROPUESTA: se crea una cotización (con su monto).
create or replace function public._crm_tr_cotizacion() returns trigger language plpgsql security definer set search_path = public as
$$
declare v uuid; v_prof uuid;
begin
  begin
    select profile_id into v_prof from public.customers where id = new.customer_id;
    v := public._crm_abierta(new.customer_id, v_prof, new.conversation_id);
    if v is null then
      perform public._crm_nueva(new.customer_id, v_prof, new.conversation_id, coalesce(new.seller_profile_id, public._cc_vendedor_de_cliente(new.customer_id)), 'propuesta', 'cotizacion',
                                'Cotización ' || coalesce(new.folio, ''), jsonb_build_object('cotizacion_id', new.id, 'monto', new.total));
    else
      perform public._crm_avanzar(v, 'propuesta', true, 'cotización ' || coalesce(new.folio, ''), jsonb_build_object('cotizacion_id', new.id, 'monto', new.total));
    end if;
  exception when others then raise warning 'CRM: cotización: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists crm_desde_cotizacion on public.cotizaciones;
create trigger crm_desde_cotizacion after insert on public.cotizaciones for each row execute function public._crm_tr_cotizacion();

-- PROPUESTA al levantarse un pedido; GANADO al quedar pagado o liberado a crédito.
create or replace function public._crm_pedido(p_order uuid) returns void language plpgsql security definer set search_path = public as
$$
declare o record; v uuid; v_lib boolean; v_prof uuid;
begin
  select id, customer_id, doctor_id, total, status, external_ref, shipping_meta into o from public.orders where id = p_order;
  if not found or o.customer_id is null or o.status in ('cancelled', 'draft') then return; end if;
  select profile_id into v_prof from public.customers where id = o.customer_id;
  select coalesce(liberado, false) into v_lib from public.v_order_money where order_id = p_order;
  v := public._crm_abierta(o.customer_id, coalesce(o.doctor_id, v_prof), null);
  if v is null then
    -- venta sin oportunidad abierta: se registra igual para que el embudo cuente todas las ventas (entra ya en su etapa)
    if exists (select 1 from public.crm_oportunidades where order_id = p_order) then
      if coalesce(v_lib, false) then perform public._crm_avanzar((select id from public.crm_oportunidades where order_id = p_order limit 1), 'ganado', true, 'pedido pagado', jsonb_build_object('monto', o.total)); end if;
      return;
    end if;
    perform public._crm_nueva(o.customer_id, coalesce(o.doctor_id, v_prof), null, coalesce(nullif(o.shipping_meta ->> 'seller_profile_id', '')::uuid, public._cc_vendedor_de_cliente(o.customer_id)),
                              case when v_lib then 'ganado' else 'propuesta' end, 'pedido', 'Pedido ' || coalesce(o.external_ref, ''), jsonb_build_object('order_id', o.id, 'monto', o.total));
    return;
  end if;
  perform public._crm_avanzar(v, case when v_lib then 'ganado' else 'propuesta' end, true, case when v_lib then 'pedido ' || coalesce(o.external_ref, '') || ' pagado' else 'pedido ' || coalesce(o.external_ref, '') end,
                              jsonb_build_object('order_id', o.id, 'monto', o.total));
end;
$$;
create or replace function public._crm_tr_pedido() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  begin
    if tg_table_name = 'orders' then perform public._crm_pedido(new.id); else perform public._crm_pedido(new.order_id); end if;   -- pedido / cobro / crédito
  exception when others then raise warning 'CRM: pedido: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists crm_desde_pedido on public.orders;
create constraint trigger crm_desde_pedido after insert on public.orders deferrable initially deferred for each row execute function public._crm_tr_pedido();   -- con el total final
drop trigger if exists crm_desde_cobro on public.payment_entries;
create trigger crm_desde_cobro after insert on public.payment_entries for each row execute function public._crm_tr_pedido();
drop trigger if exists crm_desde_credito on public.credit_grants;
create trigger crm_desde_credito after insert on public.credit_grants for each row execute function public._crm_tr_pedido();

-- ── lo que usa la pantalla ───────────────────────────────────────────────────────────────────────────────
create or replace function public._crm_ve_todo() returns boolean language sql stable security definer set search_path = public as
$$ select public.auth_role() = 'admin' or public._jefe_ventas() $$;
create or replace function public._crm_puede(p_id uuid) returns boolean language sql stable security definer set search_path = public as
$$ select public._crm_ve_todo() or (public.auth_role() = 'pos' and exists (select 1 from public.crm_oportunidades x where x.id = p_id and x.seller_profile_id = auth.uid())) $$;

create or replace function public._crm_json(o public.crm_oportunidades) returns jsonb language sql stable security definer set search_path = public as
$$ select jsonb_build_object('id', o.id, 'etapa', o.etapa, 'titulo', o.titulo, 'monto', o.monto_estimado, 'origen', o.origen, 'customer_id', o.customer_id, 'conversation_id', o.conversation_id,
     'cliente', coalesce((select c.full_name from public.customers c where c.id = o.customer_id), (select p.full_name from public.profiles p where p.id = o.profile_id),
                         case when o.conversation_id is not null then public._cc_nombre_dueno(o.conversation_id) end, 'Sin nombre'),
     'vendedor_id', o.seller_profile_id, 'vendedor', (select d.name from public.staff_directory d where d.id = o.seller_profile_id),
     'cotizacion_id', o.cotizacion_id, 'order_id', o.order_id, 'folio_pedido', (select x.external_ref from public.orders x where x.id = o.order_id),
     'motivo_perdida', o.motivo_perdida, 'etapa_at', o.etapa_at, 'created_at', o.created_at, 'cerrada_at', o.cerrada_at,
     'dias_en_etapa', greatest(0, extract(day from now() - o.etapa_at)::int)) $$;

create or replace function public.crm_embudo(p_vendedor uuid default null, p_cerradas_dias int default 30) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(public._crm_json(o) order by public._crm_orden(o.etapa), o.etapa_at desc) from public.crm_oportunidades o
     where (o.etapa not in ('ganado', 'perdido') or o.cerrada_at > now() - make_interval(days => least(greatest(coalesce(p_cerradas_dias, 30), 1), 365)))
       and case when public._crm_ve_todo() then (p_vendedor is null or o.seller_profile_id = p_vendedor) else o.seller_profile_id = auth.uid() end), '[]'::jsonb);
end;
$$;

create or replace function public.crm_mover(p_id uuid, p_etapa text, p_motivo text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare o public.crm_oportunidades; v_motivo text := nullif(btrim(left(coalesce(p_motivo, ''), 300)), '');
begin
  if not public._crm_puede(p_id) then raise exception 'NO_AUTORIZADO: esa oportunidad no es tuya' using errcode = 'insufficient_privilege'; end if;
  if p_etapa not in ('nuevo', 'calificado', 'propuesta', 'ganado', 'perdido') then raise exception 'ETAPA_INVALIDA' using errcode = 'check_violation'; end if;
  if p_etapa = 'perdido' and (v_motivo is null or length(v_motivo) < 3) then raise exception 'MOTIVO_REQUERIDO: escribe por qué se perdió' using errcode = 'check_violation'; end if;
  perform public._crm_avanzar(p_id, p_etapa, false, v_motivo);
  select * into o from public.crm_oportunidades where id = p_id;
  return public._crm_json(o);
end;
$$;

create or replace function public.crm_crear(p_customer uuid, p_titulo text default null, p_monto numeric default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v uuid; o public.crm_oportunidades; v_seller uuid;
begin
  if public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from public.customers where id = p_customer) then raise exception 'CLIENTE_INEXISTENTE' using errcode = 'check_violation'; end if;
  v_seller := public._cc_vendedor_de_cliente(p_customer);
  if public.auth_role() = 'pos' and not public._crm_ve_todo() and v_seller is not null and v_seller <> auth.uid() then raise exception 'NO_AUTORIZADO: ese cliente es de otro vendedor' using errcode = 'insufficient_privilege'; end if;
  if public._crm_abierta(p_customer, null, null) is not null then raise exception 'YA_ABIERTA: ese cliente ya tiene una oportunidad abierta' using errcode = 'check_violation'; end if;
  v := public._crm_nueva(p_customer, (select profile_id from public.customers where id = p_customer), null, case when public.auth_role() = 'pos' then auth.uid() else v_seller end,
                         'nuevo', 'vendedor', coalesce(nullif(btrim(p_titulo), ''), 'Oportunidad'), case when p_monto is not null and p_monto >= 0 then jsonb_build_object('monto', p_monto) else '{}'::jsonb end);
  select * into o from public.crm_oportunidades where id = v;
  return public._crm_json(o);
end;
$$;

create or replace function public.crm_editar(p_id uuid, p_titulo text default null, p_monto numeric default null, p_vendedor uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare o public.crm_oportunidades;
begin
  if not public._crm_puede(p_id) then raise exception 'NO_AUTORIZADO: esa oportunidad no es tuya' using errcode = 'insufficient_privilege'; end if;
  if p_vendedor is not null and not public._crm_ve_todo() then raise exception 'NO_AUTORIZADO: solo Dirección o el jefe de ventas reasignan' using errcode = 'insufficient_privilege'; end if;
  if p_vendedor is not null and not exists (select 1 from public.profiles where id = p_vendedor and role_id = 'pos' and active) then raise exception 'VENDEDOR_INVALIDO' using errcode = 'check_violation'; end if;
  update public.crm_oportunidades set titulo = coalesce(left(nullif(btrim(p_titulo), ''), 120), titulo), monto_estimado = case when p_monto is not null and p_monto >= 0 then round(p_monto, 2) else monto_estimado end,
         seller_profile_id = coalesce(p_vendedor, seller_profile_id), updated_at = now() where id = p_id returning * into o;
  return public._crm_json(o);
end;
$$;

-- Totales para Dirección y el jefe de ventas: por etapa y por vendedor, y la conversión de los últimos N días.
create or replace function public.crm_resumen(p_dias int default 30) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_desde timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 365));
begin
  if not public._crm_ve_todo() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object(
    'por_etapa', (select coalesce(jsonb_object_agg(etapa, jsonb_build_object('n', n, 'monto', monto)), '{}'::jsonb) from (
        select etapa, count(*) n, coalesce(sum(monto_estimado), 0) monto from public.crm_oportunidades
         where etapa not in ('ganado', 'perdido') or cerrada_at >= v_desde group by etapa) x),
    'por_vendedor', (select coalesce(jsonb_agg(x order by x.ganado_monto desc), '[]'::jsonb) from (
        select o.seller_profile_id vendedor_id, (select d.name from public.staff_directory d where d.id = o.seller_profile_id) vendedor,
               count(*) filter (where etapa not in ('ganado', 'perdido')) abiertas, count(*) filter (where etapa = 'ganado' and cerrada_at >= v_desde) ganadas,
               count(*) filter (where etapa = 'perdido' and cerrada_at >= v_desde) perdidas,
               coalesce(sum(monto_estimado) filter (where etapa = 'ganado' and cerrada_at >= v_desde), 0) ganado_monto
          from public.crm_oportunidades o group by o.seller_profile_id) x),
    'conversion', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where etapa = 'ganado') / count(*), 1) end
                     from public.crm_oportunidades where etapa in ('ganado', 'perdido') and cerrada_at >= v_desde),
    'dias', least(greatest(coalesce(p_dias, 30), 1), 365));
end;
$$;

do $g$ begin
  execute 'revoke all on function public._crm_orden(text), public._crm_abierta(uuid,uuid,uuid), public._crm_avanzar(uuid,text,boolean,text,jsonb), public._crm_nueva(uuid,uuid,uuid,uuid,text,text,text,jsonb), public._crm_tr_mensaje(), public._crm_tr_conversacion(), public._crm_tr_verificado(), public._crm_tr_cotizacion(), public._crm_pedido(uuid), public._crm_tr_pedido(), public._crm_ve_todo(), public._crm_puede(uuid), public._crm_json(public.crm_oportunidades) from public, anon, authenticated';
  execute 'revoke all on function public.crm_embudo(uuid,int), public.crm_mover(uuid,text,text), public.crm_crear(uuid,text,numeric), public.crm_editar(uuid,text,numeric,uuid), public.crm_resumen(int) from public, anon';
  execute 'grant execute on function public.crm_embudo(uuid,int), public.crm_mover(uuid,text,text), public.crm_crear(uuid,text,numeric), public.crm_editar(uuid,text,numeric,uuid), public.crm_resumen(int) to authenticated';
end $g$;
