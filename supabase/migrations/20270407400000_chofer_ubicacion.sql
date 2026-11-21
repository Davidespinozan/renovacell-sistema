-- CHOFER EN EL MAPA (21 nov 2026, dueño: «ver en tiempo real al chofer cuando entrega» → «DALE»).
--   · El celular del chofer manda su ubicación SOLO mientras está en ruta (tiene una entrega viva) y con la app abierta
--     (límite de las apps web), a lo más una vez cada 45 s.
--   · Al marcar «Entregado» se guarda dónde estaba (prueba de entrega).
--   · Dirección y Almacén ven en un mapa la última ubicación de cada chofer, su recorrido de hoy y sus entregas.
--   · Se conservan 30 días.
create table if not exists public.chofer_ubicaciones (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.profiles(id),
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  precision_m integer check (precision_m >= 0),
  tipo text not null default 'ruta' check (tipo in ('ruta','entrega')),
  shipment_id uuid references public.shipments(id),
  at timestamptz not null default now()
);
create index if not exists idx_chofer_ubic_driver_at on public.chofer_ubicaciones (driver_id, at desc);
create index if not exists idx_chofer_ubic_shipment on public.chofer_ubicaciones (shipment_id) where shipment_id is not null;
alter table public.chofer_ubicaciones enable row level security;
revoke all on public.chofer_ubicaciones from anon, authenticated;

create or replace function public.chofer_ubicacion_registrar(p_lat numeric, p_lng numeric, p_precision integer default null,
                                                             p_tipo text default 'ruta', p_shipment uuid default null)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_ult timestamptz;
begin
  if public.auth_role() <> 'driver' then raise exception 'NO_AUTORIZADO: solo el chofer' using errcode = 'insufficient_privilege'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return 'invalida'; end if;
  if p_tipo = 'entrega' then
    if p_shipment is null or not exists (select 1 from public.shipments s where s.id = p_shipment and s.driver_id = v_uid) then return 'no_es_tuya'; end if;
    if exists (select 1 from public.chofer_ubicaciones u where u.shipment_id = p_shipment and u.tipo = 'entrega') then return 'ya_registrada'; end if;
  else
    -- solo en ruta: con al menos una entrega viva asignada
    if not exists (select 1 from public.shipments s where s.driver_id = v_uid and s.status in ('despachado','out_for_delivery','incident')) then return 'fuera_de_ruta'; end if;
    select max(at) into v_ult from public.chofer_ubicaciones where driver_id = v_uid and tipo = 'ruta';
    if v_ult is not null and v_ult > now() - interval '45 seconds' then return 'frenado'; end if;
  end if;
  insert into public.chofer_ubicaciones (driver_id, lat, lng, precision_m, tipo, shipment_id)
  values (v_uid, round(p_lat, 6), round(p_lng, 6), least(greatest(p_precision, 0), 100000), case when p_tipo = 'entrega' then 'entrega' else 'ruta' end,
          case when p_tipo = 'entrega' then p_shipment end);
  return 'ok';
end;
$function$;

-- Mapa de la oficina: por chofer activo, su última ubicación de hoy, su recorrido y sus entregas (vivas y entregadas hoy).
create or replace function public.choferes_en_mapa()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_hoy timestamptz := (public.hoy_local()::timestamp) at time zone 'America/Mazatlan';
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: solo Dirección o Almacén' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'nombre') from (
      select jsonb_build_object(
        'driver_id', p.id,
        'nombre', coalesce(nullif(btrim(p.full_name), ''), p.email),
        'ultima', (select jsonb_build_object('lat', u.lat, 'lng', u.lng, 'at', u.at, 'precision', u.precision_m)
                     from public.chofer_ubicaciones u where u.driver_id = p.id and u.at >= v_hoy order by u.at desc limit 1),
        'recorrido', coalesce((select jsonb_agg(jsonb_build_array(r.lat, r.lng) order by r.at) from (
                       select u.lat, u.lng, u.at from public.chofer_ubicaciones u where u.driver_id = p.id and u.at >= v_hoy
                        order by u.at desc limit 400) r), '[]'::jsonb),
        'entregas', coalesce((select jsonb_agg(jsonb_build_object(
                       'shipment_id', s.id, 'folio', o.external_ref, 'estado', s.status,
                       'cliente', coalesce((select initcap(lower(c.full_name)) from public.customers c where c.id = o.customer_id), (select pd.full_name from public.profiles pd where pd.id = o.doctor_id), ''),
                       'entregado_at', s.delivered_at,
                       'lat', (select e.lat from public.chofer_ubicaciones e where e.shipment_id = s.id and e.tipo = 'entrega' limit 1),
                       'lng', (select e.lng from public.chofer_ubicaciones e where e.shipment_id = s.id and e.tipo = 'entrega' limit 1))
                       order by s.status = 'delivered', s.estimated_delivery_at nulls last)
                     from public.shipments s join public.orders o on o.id = s.order_id
                    where s.driver_id = p.id
                      and (s.status in ('despachado','out_for_delivery','incident') or (s.status = 'delivered' and s.delivered_at >= v_hoy))), '[]'::jsonb)
      ) x
      from public.profiles p
      where p.role_id = 'driver' and p.active and not coalesce(p.interna, false)) s), '[]'::jsonb);
end;
$function$;

-- Dónde se entregó un envío (para Seguimiento).
create or replace function public.entrega_ubicacion(p_shipment uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select case when public.auth_role() = any (array['admin','warehouse','packing']) then
    (select jsonb_build_object('lat', u.lat, 'lng', u.lng, 'at', u.at, 'precision', u.precision_m)
       from public.chofer_ubicaciones u where u.shipment_id = p_shipment and u.tipo = 'entrega' limit 1) end;
$function$;

revoke all on function public.chofer_ubicacion_registrar(numeric,numeric,integer,text,uuid) from public, anon;
revoke all on function public.choferes_en_mapa() from public, anon;
revoke all on function public.entrega_ubicacion(uuid) from public, anon;
grant execute on function public.chofer_ubicacion_registrar(numeric,numeric,integer,text,uuid), public.choferes_en_mapa(), public.entrega_ubicacion(uuid) to authenticated;

-- 30 días y se borran (diario, 4:30 hora del servidor)
do $cron$ begin
  if exists (select 1 from cron.job where jobname = 'renovacell-ubicaciones-limpieza') then
    perform cron.unschedule('renovacell-ubicaciones-limpieza'); end if;
  perform cron.schedule('renovacell-ubicaciones-limpieza', '30 10 * * *',
    $q$delete from public.chofer_ubicaciones where at < now() - interval '30 days'$q$);
end $cron$;
