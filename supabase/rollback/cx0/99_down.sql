-- CX-0A (135) · down: restaura EXACTAMENTE el precio_de/3 de 20261002120000 (md5 de producción
-- 9efe19506f40e19c3dc5baeca66b9014), sin barrera. No toca datos ni precio_de/2. Permisos: los mismos que en producción.
create or replace function public.precio_de(p_product uuid, p_list uuid, p_qty int)
returns numeric language sql security definer set search_path = public stable as $fn$
  with b as (
    select coalesce(
      (select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = p_list),
      (select pr.price from public.products pr where pr.id = p_product)
    ) as base
  ), v as (
    select (
      select pv.price from public.product_volume_prices pv
      where pv.product_id = p_product and pv.active and pv.min_quantity <= p_qty
      order by pv.min_quantity desc limit 1
    ) as vol
  )
  select case when v.vol is null then b.base else least(b.base, v.vol) end from b, v;
$fn$;
comment on function public.precio_de(uuid, uuid, integer) is null;
revoke all on function public.precio_de(uuid, uuid, int) from public, anon;
grant execute on function public.precio_de(uuid, uuid, int) to authenticated, service_role;
