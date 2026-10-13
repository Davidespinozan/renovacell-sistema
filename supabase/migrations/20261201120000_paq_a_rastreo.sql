-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PAQ-A (migración 148) · RASTREO DE PAQUETERÍA, NEUTRAL AL PROVEEDOR (DHL hoy; T1 después)
--   Hasta hoy el sistema generaba la guía y ya no sabía nada del envío: marcaba "en camino" al generarla y la entrega
--   se cerraba a mano. Aquí se guarda lo que la paquetería reporta, para Empaque, Dirección y el cliente.
--   · shipment_tracking          un renglón por envío: último estado conocido, quién firmó, cuándo se consultó.
--   · shipment_tracking_events   historial de eventos de la paquetería (sin duplicados).
--   · registrar_rastreo(...)     única vía de escritura; SOLO el servicio (la Edge `shipping`, tras consultar al
--                                proveedor). Estados neutrales: sin_eventos, recolectado, en_transito, en_reparto,
--                                entregado, incidencia.
--   Lectura: quien ya puede ver el envío (logística, el chofer asignado y el dueño del pedido) — la política
--   consulta `shipments` con los permisos de quien lee, así que hereda su RLS tal cual.
--   NO cambia: shipments, shipments_guard, confirmar_entrega, orders ni sus políticas. El cierre de la entrega sigue
--   pasando por confirmar_entrega (lo invoca la Edge con la identidad de quien sincroniza). No hay tarea programada:
--   en producción no está pg_net; la sincronización es bajo demanda con caché (decisión aparte).
--   Independiente de las migraciones 146 y 147. Aplicar en UNA transacción. Rollback: supabase/rollback/paq_a/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.shipment_tracking') is not null or to_regclass('public.shipment_tracking_events') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'registrar_rastreo') then
    raise exception 'PAQ-A: ya aplicada';
  end if;
  if to_regclass('public.shipments') is null or to_regprocedure('public._cc_es_service()') is null then
    raise exception 'PAQ-A: faltan shipments o _cc_es_service()';
  end if;
  -- La lectura hereda la política de envíos: debe ser la auditada (SEC-A / SEC-C3).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shipments' and policyname = 'shipments_select_scoped' and cmd = 'SELECT') then
    raise exception 'PAQ-A: falta la política de lectura de envíos';
  end if;
end $pre$;

create table public.shipment_tracking (
  shipment_id      uuid primary key references public.shipments(id) on delete cascade,
  provider         text not null constraint ck_strk_provider check (length(provider) between 1 and 40),
  estado           text not null constraint ck_strk_estado check (estado in ('sin_eventos', 'recolectado', 'en_transito', 'en_reparto', 'entregado', 'incidencia')),
  descripcion      text constraint ck_strk_desc check (descripcion is null or length(descripcion) <= 300),
  firmado_por      text constraint ck_strk_firma check (firmado_por is null or length(firmado_por) <= 120),
  entregado_at     timestamptz,
  ultimo_evento_at timestamptz,
  synced_at        timestamptz not null default now(),
  error            text constraint ck_strk_error check (error is null or length(error) <= 300),
  constraint ck_strk_entregado check ((estado = 'entregado') = (entregado_at is not null))
);
comment on table public.shipment_tracking is 'PAQ-A · Último estado que reporta la paquetería para un envío. Lo escribe solo registrar_rastreo (servicio).';

create table public.shipment_tracking_events (
  id          bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  ocurrido_at timestamptz not null,
  codigo      text not null default '' constraint ck_stre_codigo check (length(codigo) <= 20),
  descripcion text not null default '' constraint ck_stre_desc check (length(descripcion) <= 300),
  lugar       text constraint ck_stre_lugar check (lugar is null or length(lugar) <= 160),
  created_at  timestamptz not null default now(),
  constraint uq_stre_evento unique (shipment_id, ocurrido_at, codigo, descripcion)
);
create index idx_stre_envio on public.shipment_tracking_events (shipment_id, ocurrido_at desc);
comment on table public.shipment_tracking_events is 'PAQ-A · Historial de eventos de la paquetería por envío (sin duplicados).';

alter table public.shipment_tracking enable row level security;
alter table public.shipment_tracking_events enable row level security;
revoke all on public.shipment_tracking, public.shipment_tracking_events from public, anon, authenticated;
grant select on public.shipment_tracking, public.shipment_tracking_events to authenticated;
-- Ve el rastreo quien ve el envío: la subconsulta se evalúa con los permisos del lector (RLS de shipments).
create policy shipment_tracking_select on public.shipment_tracking for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_tracking.shipment_id));
create policy shipment_tracking_events_select on public.shipment_tracking_events for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_tracking_events.shipment_id));

create function public.registrar_rastreo(
  p_shipment uuid, p_provider text, p_estado text, p_descripcion text default null, p_firmado_por text default null,
  p_entregado_at timestamptz default null, p_eventos jsonb default '[]'::jsonb, p_error text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- PAQ-A · Guarda lo que reportó la paquetería. Solo el servicio. No toca shipments ni orders.
-- Un error de consulta (p_error) NO borra lo ya conocido: solo anota el error y la hora del intento.
-- "entregado" es terminal: una consulta posterior no lo degrada.
declare v_prev public.shipment_tracking; e jsonb; v_at timestamptz; v_n int := 0; v_ult timestamptz;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO: el rastreo lo registra el servicio' using errcode = 'insufficient_privilege'; end if;
  if p_shipment is null or not exists (select 1 from public.shipments where id = p_shipment) then raise exception 'ENVIO_INEXISTENTE'; end if;
  if coalesce(btrim(p_provider), '') = '' then raise exception 'PROVEEDOR_REQUERIDO'; end if;
  select * into v_prev from public.shipment_tracking where shipment_id = p_shipment for update;

  if p_error is not null then
    insert into public.shipment_tracking (shipment_id, provider, estado, synced_at, error)
    values (p_shipment, btrim(p_provider), 'sin_eventos', now(), left(p_error, 300))
    on conflict (shipment_id) do update set synced_at = now(), error = left(p_error, 300);
    return jsonb_build_object('status', 'error_anotado');
  end if;

  if p_estado is null or p_estado not in ('sin_eventos', 'recolectado', 'en_transito', 'en_reparto', 'entregado', 'incidencia') then
    raise exception 'ESTADO_INVALIDO: %', coalesce(p_estado, '(nulo)');
  end if;
  if p_eventos is not null and jsonb_typeof(p_eventos) <> 'array' then raise exception 'EVENTOS_INVALIDOS'; end if;
  if jsonb_array_length(coalesce(p_eventos, '[]'::jsonb)) > 200 then raise exception 'EVENTOS_INVALIDOS: demasiados eventos'; end if;

  for e in select * from jsonb_array_elements(coalesce(p_eventos, '[]'::jsonb)) loop
    begin v_at := (e ->> 'at')::timestamptz; exception when others then v_at := null; end;
    continue when v_at is null;
    insert into public.shipment_tracking_events (shipment_id, ocurrido_at, codigo, descripcion, lugar)
    values (p_shipment, v_at, left(coalesce(e ->> 'code', ''), 20), left(coalesce(e ->> 'description', ''), 300), nullif(left(coalesce(e ->> 'location', ''), 160), ''))
    on conflict on constraint uq_stre_evento do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  select max(ocurrido_at) into v_ult from public.shipment_tracking_events where shipment_id = p_shipment;

  if v_prev.estado = 'entregado' and p_estado <> 'entregado' then
    update public.shipment_tracking set synced_at = now(), error = null, ultimo_evento_at = v_ult where shipment_id = p_shipment;
    return jsonb_build_object('status', 'sin_cambio', 'estado', 'entregado', 'eventos_nuevos', v_n);
  end if;

  insert into public.shipment_tracking (shipment_id, provider, estado, descripcion, firmado_por, entregado_at, ultimo_evento_at, synced_at, error)
  values (p_shipment, btrim(p_provider), p_estado, left(p_descripcion, 300), nullif(left(btrim(coalesce(p_firmado_por, '')), 120), ''),
          case when p_estado = 'entregado' then coalesce(p_entregado_at, v_ult, now()) end, v_ult, now(), null)
  on conflict (shipment_id) do update
     set provider = excluded.provider, estado = excluded.estado, descripcion = excluded.descripcion,
         firmado_por = coalesce(excluded.firmado_por, public.shipment_tracking.firmado_por),
         entregado_at = case when excluded.estado = 'entregado' then coalesce(public.shipment_tracking.entregado_at, excluded.entregado_at) end,
         ultimo_evento_at = excluded.ultimo_evento_at, synced_at = now(), error = null;
  return jsonb_build_object('status', 'registrado', 'estado', p_estado, 'eventos_nuevos', v_n,
                            'cambio', v_prev.estado is distinct from p_estado);
end;
$$;
alter function public.registrar_rastreo(uuid, text, text, text, text, timestamptz, jsonb, text) owner to postgres;
comment on function public.registrar_rastreo(uuid, text, text, text, text, timestamptz, jsonb, text) is 'PAQ-A · Única vía de escritura del rastreo de paquetería. Solo el servicio. No toca shipments ni orders.';
revoke all on function public.registrar_rastreo(uuid, text, text, text, text, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.registrar_rastreo(uuid, text, text, text, text, timestamptz, jsonb, text) to service_role;

do $post$ begin
  if (select count(*) from pg_class c where c.oid in ('public.shipment_tracking'::regclass, 'public.shipment_tracking_events'::regclass) and c.relrowsecurity) <> 2 then
    raise exception 'PAQ-A: RLS no quedó activa';
  end if;
  if has_table_privilege('authenticated', 'public.shipment_tracking', 'insert') or has_table_privilege('authenticated', 'public.shipment_tracking', 'update')
     or has_table_privilege('authenticated', 'public.shipment_tracking', 'delete') or has_table_privilege('authenticated', 'public.shipment_tracking_events', 'insert')
     or has_table_privilege('authenticated', 'public.shipment_tracking_events', 'update') or has_table_privilege('authenticated', 'public.shipment_tracking_events', 'delete')
     or has_table_privilege('anon', 'public.shipment_tracking', 'select') or has_table_privilege('anon', 'public.shipment_tracking_events', 'select') then
    raise exception 'PAQ-A: los clientes no deben poder escribir el rastreo ni el anónimo leerlo';
  end if;
  if has_function_privilege('authenticated', 'public.registrar_rastreo(uuid,text,text,text,text,timestamptz,jsonb,text)', 'execute')
     or has_function_privilege('anon', 'public.registrar_rastreo(uuid,text,text,text,text,timestamptz,jsonb,text)', 'execute') then
    raise exception 'PAQ-A: registrar_rastreo solo es del servicio';
  end if;
end $post$;
