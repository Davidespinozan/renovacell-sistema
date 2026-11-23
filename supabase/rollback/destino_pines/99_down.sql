-- DESTINO EN EL MAPA (0755) · down: el mapa vuelve a mostrar solo dónde se entregó; sin pines por dirección.
drop trigger if exists chofer_ubicacion_aprende_pin on public.chofer_ubicaciones;
drop function if exists public._tr_entrega_aprende_pin();
drop function if exists public.destinos_sin_pin(integer);
drop function if exists public.destino_pin_osm(text, numeric, numeric, text);
CREATE OR REPLACE FUNCTION public.choferes_en_mapa()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
drop function if exists public._direccion_clave(jsonb);
drop function if exists public._distancia_m(numeric, numeric, numeric, numeric);
alter table public.chofer_ubicaciones drop column if exists distancia_destino_m, drop column if exists lejos_destino;
drop table if exists public.direccion_pines;
