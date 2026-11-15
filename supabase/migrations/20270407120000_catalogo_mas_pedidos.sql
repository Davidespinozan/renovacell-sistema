-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CATÁLOGO · "MÁS PEDIDO" (15 nov 2026, auditoría UX + referencia del menú de STRYV Restaurant). La tienda del doctor marca
-- con "Más pedido" los productos que más se piden. Esta función devuelve SOLO identificadores de producto (agregado, sin
-- montos, clientes ni pedidos), de los últimos N días, contando pedidos distintos (no piezas) y solo productos que
-- aparecen en al menos 2 pedidos (con poca venta no se marca nada). Cualquier usuario con sesión la puede leer.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.catalogo_mas_pedidos(integer,integer)') is not null then raise exception 'MAS-PEDIDOS: ya aplicada'; end if;
end $pre$;

create function public.catalogo_mas_pedidos(p_dias integer default 90, p_limite integer default 8) returns uuid[]
  language sql stable security definer set search_path = public as
$$
  select coalesce(array_agg(product_id order by n desc, product_id), '{}')
    from (select i.product_id, count(distinct o.id) n
            from public.order_items i join public.orders o on o.id = i.order_id
           where i.product_id is not null and o.status not in ('cancelled', 'draft')
             and o.created_at > now() - make_interval(days => least(greatest(coalesce(p_dias, 90), 7), 365))
           group by i.product_id
          having count(distinct o.id) >= 2
           order by n desc, i.product_id
           limit least(greatest(coalesce(p_limite, 8), 1), 24)) t
$$;
revoke all on function public.catalogo_mas_pedidos(integer, integer) from public, anon;
grant execute on function public.catalogo_mas_pedidos(integer, integer) to authenticated;
