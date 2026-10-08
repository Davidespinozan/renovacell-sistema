-- SEC-A (138) · down: restaura EXACTAMENTE order_owner (md5 275ca1cc…) y order_vendor_email (md5 b7de05a5…) de producción,
-- sus permisos (PUBLIC + anon + authenticated + service_role) y su comentario (ninguno). No toca políticas ni datos.
-- ⚠️ REABRE la exposición: anon y cualquier autenticado vuelven a obtener el comprador / meta.owner de pedidos ajenos.
do $pre$ begin
  if md5(pg_get_functiondef('public.order_owner(uuid)'::regprocedure)) <> '57dc33250d48b3b53f9fc5909a8d015d'
     or md5(pg_get_functiondef('public.order_vendor_email(uuid)'::regprocedure)) <> '58a350df9c9582768d78a0ec1de00dde' then
    raise exception 'SEC-A down: las funciones no son la versión SEC-A esperada; no se revierte sobre un estado desconocido';
  end if;
end $pre$;
CREATE OR REPLACE FUNCTION public.order_owner(o_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT doctor_id FROM orders WHERE id = o_id;
$function$;
CREATE OR REPLACE FUNCTION public.order_vendor_email(o_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.meta ->> 'owner' FROM public.orders o JOIN public.profiles p ON p.id = o.doctor_id WHERE o.id = o_id;
$function$;
comment on function public.order_owner(uuid) is null;
comment on function public.order_vendor_email(uuid) is null;
grant execute on function public.order_owner(uuid) to public, anon, authenticated, service_role;
grant execute on function public.order_vendor_email(uuid) to public, anon, authenticated, service_role;
