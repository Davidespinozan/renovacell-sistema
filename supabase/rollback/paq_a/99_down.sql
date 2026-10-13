-- PAQ-A (148) · down: elimina el rastreo de paquetería (función y las dos tablas, con su historial).
-- No toca shipments, orders ni sus funciones. ⚠️ Se pierde el historial de eventos guardado (se puede volver a
-- consultar a la paquetería mientras la guía siga vigente).
do $pre$ begin
  if to_regclass('public.shipment_tracking') is null then raise exception 'PAQ-A down: no está aplicada'; end if;
end $pre$;
drop function public.registrar_rastreo(uuid, text, text, text, text, timestamptz, jsonb, text);
drop table public.shipment_tracking_events;
drop table public.shipment_tracking;
do $post$ begin
  if to_regclass('public.shipment_tracking') is not null or to_regclass('public.shipment_tracking_events') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'registrar_rastreo') then
    raise exception 'PAQ-A down: quedaron objetos';
  end if;
end $post$;
