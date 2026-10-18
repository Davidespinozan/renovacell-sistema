-- PROMOCIONES · rollback de la migración 173: se retiran las promociones y precio_de/3 vuelve al texto de la 135.
-- Las promociones capturadas se pierden (son configuración comercial, no pedidos): se decide a mano salvo bandera.
do $pre$ begin
  if coalesce(current_setting('app.promociones_rollback_forzado', true), '') <> 'on' and exists (select 1 from public.promociones) then
    raise exception 'PROMOCIONES down: hay promociones capturadas; no se revierte en automático (SET app.promociones_rollback_forzado = ''on'' para forzarlo)';
  end if;
end $pre$;
drop function public.promocion_estado(uuid, boolean);
drop function public.promocion_guardar(jsonb);
drop function public.promociones_lista(boolean);
drop function public._promo_json(uuid);
drop function public._promo_puede_administrar();
drop function public.promos_vigentes();
-- precio_de/3 tal como quedó en la 135 (CX-0A):
CREATE OR REPLACE FUNCTION public.precio_de(p_product uuid, p_list uuid, p_qty integer)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_claim_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_rol_sesion text := coalesce(current_setting('role', true), '');
  v_base numeric; v_vol numeric;
begin
  if not (v_claim_rol = 'service_role' or (v_claim_rol = '' and v_rol_sesion not in ('authenticated', 'anon'))) then
    if public.auth_role() = any (array['admin', 'billing', 'pos', 'warehouse', 'packing', 'comm']) then
      null;
    elsif public.puede_ver_precio()
          and (p_list is null or p_list = (select p.price_list_id from public.profiles p where p.id = auth.uid())) then
      null;
    else
      raise exception 'PRECIO_NO_AUTORIZADO: no tienes acceso a este precio' using errcode = 'insufficient_privilege';
    end if;
  end if;

  select coalesce(
           (select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = p_list),
           (select pr.price from public.products pr where pr.id = p_product))
    into v_base;
  select pv.price into v_vol from public.product_volume_prices pv
   where pv.product_id = p_product and pv.active and pv.min_quantity <= p_qty
   order by pv.min_quantity desc limit 1;
  return case when v_vol is null then v_base else least(v_base, v_vol) end;
end;
$function$

;
comment on function public.precio_de(uuid, uuid, integer) is 'CX-0A · Precio autorizado (lista ∥ General, LEAST con volumen) con barrera: mismo alcance que la RLS de product_prices.';
revoke all on function public.precio_de(uuid, uuid, int) from public, anon;
grant execute on function public.precio_de(uuid, uuid, int) to authenticated, service_role;
drop function public._promo_precio(uuid, uuid, int);
drop function public._promo_hoy();
drop table public.promocion_lineas;
drop table public.promociones;
do $post$ begin
  if md5(pg_get_functiondef('public.precio_de(uuid,uuid,integer)'::regprocedure)) <> '349176d8415cc46db01f1eaf887c9255' then raise exception 'PROMOCIONES down: precio_de/3 no quedó como en la 135'; end if;
end $post$;
