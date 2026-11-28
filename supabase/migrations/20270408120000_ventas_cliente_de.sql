-- ============================================================================
-- «CLIENTE DE … · VENDIÓ …» EN LAS VENTAS SIN VENDEDOR (27 nov 2026, dueño: «todos los pedidos en el pasado que hayan
-- salido sin vendedor porque eran de alguien y lo generó otro, hay que poner de quién es el cliente y quién lo vendió»).
--   Un pedido guarda CONGELADO su vendedor al crearse (cartera del cliente; regla CX-0c, inmutable a propósito: nadie lo
--   reescribe, ni Dirección). Cuando en ese momento no hubo vendedor resoluble —p. ej. el cliente era de Antonio y Antonio
--   todavía no contaba como vendedor, o su ficha de Odoo dice «Antonio Gallardo» sin equivalencia— salió «Sin vendedor».
--   Esta función NO cambia ningún pedido: dice, para mostrarlo, de quién es HOY el cliente y quién capturó la venta.
--     · cliente_de: el vendedor de cartera del cliente (cuenta del portal o cliente comercial); si no tiene, el vendedor de
--       su ficha de Odoo (texto); si tampoco, nada.
--     · vendio: quien capturó el pedido (`placed_by_id` → su nombre; si no, el texto `placed_by`).
--   Lo leen Dirección y el jefe de ventas (los mismos que ven las ventas de todo el equipo). Solo lectura.
-- Solo crea una función. Rollback: drop function public.ventas_cliente_de(uuid[]);
-- ============================================================================
do $pre$ begin
  if to_regprocedure('public.ventas_cliente_de(uuid[])') is not null then raise exception 'VENTAS-CLIENTE-DE: ya aplicada'; end if;
  if to_regprocedure('public._jefe_ventas()') is null then raise exception 'VENTAS-CLIENTE-DE: falta _jefe_ventas'; end if;
end $pre$;

create function public.ventas_cliente_de(p_pedidos uuid[])
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id', o.id,
           'cliente_de', coalesce(
              (select coalesce(nullif(p.meta ->> 'name', ''), p.full_name) from public.profiles p
                where p.id = coalesce((select k.seller_profile_id from public.cc_cartera k where k.profile_id = coalesce(o.doctor_id, cu.profile_id)),
                                      (select k.seller_profile_id from public.cc_cartera_clientes k where k.customer_id = o.customer_id))),
              nullif(btrim(cu.seller_name), '')),
           'cliente_de_origen', case
              when exists (select 1 from public.cc_cartera k where k.profile_id = coalesce(o.doctor_id, cu.profile_id))
                or exists (select 1 from public.cc_cartera_clientes k where k.customer_id = o.customer_id) then 'cartera'
              when nullif(btrim(cu.seller_name), '') is not null then 'odoo' end,
           'vendio', coalesce((select coalesce(nullif(p.meta ->> 'name', ''), p.full_name) from public.profiles p where p.id::text = o.shipping_meta ->> 'placed_by_id'),
                              nullif(btrim(regexp_replace(coalesce(o.shipping_meta ->> 'placed_by', ''), '\s*\((Ventas|Dirección)\)\s*$', '')), ''))
         )), '[]'::jsonb)
    from public.orders o left join public.customers cu on cu.id = o.customer_id
   where auth.uid() is not null and (public.auth_role() = 'admin' or public._jefe_ventas())
     and o.id = any (coalesce(p_pedidos, '{}'))
     and coalesce(o.shipping_meta ->> 'seller_profile_id', '') = '' and coalesce(o.shipping_meta ->> 'seller', '') = '';
$function$;

revoke all on function public.ventas_cliente_de(uuid[]) from public, anon;
grant execute on function public.ventas_cliente_de(uuid[]) to authenticated, service_role;
comment on function public.ventas_cliente_de(uuid[]) is 'Para ventas sin vendedor congelado: de quién es hoy el cliente (cartera u Odoo) y quién capturó la venta. Solo lectura; no cambia pedidos.';
