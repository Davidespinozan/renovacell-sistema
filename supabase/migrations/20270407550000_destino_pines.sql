-- DESTINO EN EL MAPA (23 nov 2026, dueño: «¿cómo es lo más pro?» → «dale»). «Choferes en ruta» muestra A DÓNDE va
-- cada chofer, no solo dónde entregó. Sin Google:
--   1. El sistema APRENDE de cada entrega: el punto GPS donde el chofer marca «Entregado» queda como el pin de esa
--      dirección («puerta»). La siguiente entrega a la misma dirección ya sale exacta. Entregas cercanas lo afinan.
--   2. Dirección nueva: la Edge destinos-geocodificar la busca en OpenStreetMap (Nominatim) y deja un pin APROXIMADO
--      (calle / colonia / CP), que el mapa dibuja distinto. Solo viaja la dirección (sin nombre ni teléfono).
--   3. Si el chofer marca «Entregado» a más de 300 m de un destino confiable (puerta o calle), queda la alerta.
-- La dirección se identifica por su texto normalizado (CP + calle y número + colonia) del pedido.

create table if not exists public.direccion_pines (
  clave text primary key,
  lat numeric(9,6) check (lat between -90 and 90),
  lng numeric(9,6) check (lng between -180 and 180),
  fuente text not null check (fuente in ('entrega','osm')),
  precision text not null check (precision in ('puerta','calle','colonia','cp','sin_resultado')),
  entregas integer not null default 0,
  actualizado_at timestamptz not null default now()
);
alter table public.direccion_pines enable row level security;
revoke all on public.direccion_pines from anon, authenticated;

alter table public.chofer_ubicaciones add column if not exists distancia_destino_m integer;
alter table public.chofer_ubicaciones add column if not exists lejos_destino boolean not null default false;

-- Clave de una dirección (la misma dirección escrita igual → la misma clave). Null si no hay calle.
create or replace function public._direccion_clave(a jsonb)
returns text language sql immutable set search_path to 'public' as $f$
  with n as (select
    btrim(regexp_replace(lower(translate(coalesce(a ->> 'line1', ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', ' ', 'g')) as calle,
    btrim(regexp_replace(lower(translate(coalesce(a ->> 'colonia', ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', ' ', 'g')) as col,
    regexp_replace(coalesce(a ->> 'cp', ''), '\D', '', 'g') as cp)
  select case when a is null or jsonb_typeof(a) <> 'object' or (select calle from n) = '' then null
              else (select cp || '|' || calle || '|' || col from n) end
$f$;

-- Distancia en metros entre dos puntos (haversine).
create or replace function public._distancia_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns integer language sql immutable as $f$
  select round(2 * 6371000 * asin(sqrt(power(sin(radians((lat2 - lat1)::float8) / 2), 2)
         + cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2))))::integer
$f$;

-- Al guardar el punto de ENTREGA: compara con el destino conocido (alerta) y aprende el pin de la dirección.
create or replace function public._tr_entrega_aprende_pin()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_clave text; p public.direccion_pines; d integer; v_confiable boolean;
begin
  if new.tipo <> 'entrega' or new.shipment_id is null then return new; end if;
  select public._direccion_clave(o.shipping_meta -> 'address') into v_clave
    from public.shipments s join public.orders o on o.id = s.order_id where s.id = new.shipment_id;
  if v_clave is null then return new; end if;
  select * into p from public.direccion_pines where clave = v_clave;
  if found and p.lat is not null then
    d := public._distancia_m(p.lat, p.lng, new.lat, new.lng);
    v_confiable := p.fuente = 'entrega' or p.precision = 'calle';
    new.distancia_destino_m := d;
    new.lejos_destino := v_confiable and d > 300 + least(coalesce(new.precision_m, 0), 200);
  end if;
  -- GPS muy impreciso: no enseña nada (la alerta sí se calcula).
  if coalesce(new.precision_m, 0) > 150 then return new; end if;
  if not found or p.lat is null or p.fuente = 'osm' then
    insert into public.direccion_pines as x (clave, lat, lng, fuente, precision, entregas, actualizado_at)
    values (v_clave, new.lat, new.lng, 'entrega', 'puerta', 1, now())
    on conflict (clave) do update set lat = excluded.lat, lng = excluded.lng, fuente = 'entrega', precision = 'puerta', entregas = 1, actualizado_at = now();
  elsif d <= 300 then
    -- afina con promedio (las primeras 10 entregas pesan; después se mueve poco)
    update public.direccion_pines set
      lat = round((lat * least(entregas, 10) + new.lat) / (least(entregas, 10) + 1), 6),
      lng = round((lng * least(entregas, 10) + new.lng) / (least(entregas, 10) + 1), 6),
      entregas = entregas + 1, actualizado_at = now()
    where clave = v_clave;
  end if;   -- lejos de un pin de entrega: no se mueve (puede ser una entrega fuera de lugar)
  return new;
end;
$f$;
drop trigger if exists chofer_ubicacion_aprende_pin on public.chofer_ubicaciones;
create trigger chofer_ubicacion_aprende_pin before insert on public.chofer_ubicaciones
  for each row when (new.tipo = 'entrega') execute function public._tr_entrega_aprende_pin();

-- Lo que ya se entregó antes de hoy también enseña (en orden, sin alertas retroactivas).
do $b$
declare r record; v_clave text; p public.direccion_pines; d integer;
begin
  for r in select u.* from public.chofer_ubicaciones u where u.tipo = 'entrega' and u.shipment_id is not null and coalesce(u.precision_m, 0) <= 150 order by u.at loop
    select public._direccion_clave(o.shipping_meta -> 'address') into v_clave from public.shipments s join public.orders o on o.id = s.order_id where s.id = r.shipment_id;
    continue when v_clave is null;
    select * into p from public.direccion_pines where clave = v_clave;
    if not found then
      insert into public.direccion_pines (clave, lat, lng, fuente, precision, entregas) values (v_clave, r.lat, r.lng, 'entrega', 'puerta', 1);
    else
      d := public._distancia_m(p.lat, p.lng, r.lat, r.lng);
      if d <= 300 then
        update public.direccion_pines set lat = round((lat * least(entregas, 10) + r.lat) / (least(entregas, 10) + 1), 6),
          lng = round((lng * least(entregas, 10) + r.lng) / (least(entregas, 10) + 1), 6), entregas = entregas + 1 where clave = v_clave;
      end if;
    end if;
  end loop;
end $b$;

-- Para la Edge (solo servicio): direcciones de entregas vivas sin pin (o sin resultado hace más de 7 días).
create or replace function public.destinos_sin_pin(p_limite integer default 5)
returns jsonb language sql stable security definer set search_path to 'public' as $f$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select distinct on (k.clave) jsonb_build_object('clave', k.clave, 'line1', k.a ->> 'line1', 'colonia', k.a ->> 'colonia',
             'cp', k.a ->> 'cp', 'city', k.a ->> 'city', 'state', k.a ->> 'state') as x
      from (select public._direccion_clave(o.shipping_meta -> 'address') as clave, o.shipping_meta -> 'address' as a
              from public.shipments s join public.orders o on o.id = s.order_id
             where s.driver_id is not null and s.status in ('despachado','out_for_delivery','incident')) k
     where k.clave is not null
       and not exists (select 1 from public.direccion_pines p where p.clave = k.clave
                        and (p.lat is not null or p.actualizado_at > now() - interval '7 days'))
     limit greatest(1, least(coalesce(p_limite, 5), 10))) z
$f$;

-- Para la Edge (solo servicio): guarda el pin aproximado de OSM; nunca pisa uno aprendido de una entrega.
create or replace function public.destino_pin_osm(p_clave text, p_lat numeric, p_lng numeric, p_precision text)
returns text language plpgsql security definer set search_path to 'public' as $f$
begin
  if p_clave is null or p_precision not in ('calle','colonia','cp','sin_resultado') then return 'invalido'; end if;
  if exists (select 1 from public.direccion_pines where clave = p_clave and fuente = 'entrega') then return 'ya_exacto'; end if;
  insert into public.direccion_pines as x (clave, lat, lng, fuente, precision, entregas, actualizado_at)
  values (p_clave, case when p_precision = 'sin_resultado' then null else round(p_lat, 6) end,
          case when p_precision = 'sin_resultado' then null else round(p_lng, 6) end, 'osm', p_precision, 0, now())
  on conflict (clave) do update set lat = excluded.lat, lng = excluded.lng, precision = excluded.precision, actualizado_at = now()
    where x.fuente = 'osm';
  return 'ok';
end;
$f$;

-- Mapa de la oficina: + destino de cada entrega (pin aprendido o aproximado), su dirección y la alerta de distancia.
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
                       'direccion', nullif(concat_ws(', ', nullif(btrim(o.shipping_meta -> 'address' ->> 'line1'), ''), nullif(btrim(o.shipping_meta -> 'address' ->> 'colonia'), '')), ''),
                       'lat', e.lat, 'lng', e.lng, 'distancia_m', e.distancia_destino_m, 'lejos', coalesce(e.lejos_destino, false),
                       'destino', (select jsonb_build_object('lat', dp.lat, 'lng', dp.lng, 'fuente', dp.fuente, 'precision', dp.precision)
                                     from public.direccion_pines dp where dp.clave = public._direccion_clave(o.shipping_meta -> 'address') and dp.lat is not null))
                       order by s.status = 'delivered', s.estimated_delivery_at nulls last)
                     from public.shipments s join public.orders o on o.id = s.order_id
                     left join lateral (select u.lat, u.lng, u.distancia_destino_m, u.lejos_destino from public.chofer_ubicaciones u
                                         where u.shipment_id = s.id and u.tipo = 'entrega' limit 1) e on true
                    where s.driver_id = p.id
                      and (s.status in ('despachado','out_for_delivery','incident') or (s.status = 'delivered' and s.delivered_at >= v_hoy))), '[]'::jsonb)
      ) x
      from public.profiles p
      where p.role_id = 'driver' and p.active and not coalesce(p.interna, false)) s), '[]'::jsonb);
end;
$function$;

revoke all on function public._direccion_clave(jsonb), public._distancia_m(numeric,numeric,numeric,numeric), public._tr_entrega_aprende_pin(),
  public.destinos_sin_pin(integer), public.destino_pin_osm(text,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.destinos_sin_pin(integer), public.destino_pin_osm(text,numeric,numeric,text) to service_role;
revoke all on function public.choferes_en_mapa() from public, anon;
grant execute on function public.choferes_en_mapa() to authenticated;
