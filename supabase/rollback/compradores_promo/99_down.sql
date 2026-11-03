-- Reversa de 20270322120000_compradores_promo.sql: quita lo nuevo y regresa los dos comandos al texto de 20270214.
drop function if exists public.cc_oportunidades_promo(), public._cc_promo_familia(uuid, uuid), public._cc_lista_de_cliente(uuid);
create or replace function public.cc_productos_compradores() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._alcance_compradores();
  return coalesce((
    select jsonb_agg(jsonb_build_object('product_id', p.id, 'nombre', p.name, 'sku', p.sku, 'categoria', p.category, 'activo', p.active,
                                        'clientes', coalesce(v.clientes, 0), 'ultima', v.ultima) order by coalesce(v.clientes, 0) desc, p.name)
      from public.products p
      left join (select s.product_id, count(distinct s.customer_id) clientes, max(s.created_at) ultima
                   from public._ventas_cliente_producto() s
                  where s.customer_id is not null and (a.todos or public._cc_vendedor_de_cliente(s.customer_id) = a.uid)
                  group by s.product_id) v on v.product_id = p.id
     where p.parent_product_id is null and (p.active or v.clientes > 0)), '[]'::jsonb);
end;
$$;

create or replace function public.cc_compradores_producto(p_product uuid) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._alcance_compradores();
  return coalesce((
    select jsonb_agg(jsonb_build_object('customer_id', c.id, 'nombre', c.full_name, 'telefono', c.phone, 'email', c.email, 'tiene_cuenta', c.profile_id is not null,
                                        'veces', v.veces, 'unidades', v.unidades, 'ultima', v.ultima, 'ultimo_folio', v.ultimo_folio,
                                        'vendedor', case when a.todos then public._cc_nombre_personal(public._cc_vendedor_de_cliente(c.id)) end) order by v.ultima desc)
      from (select s.customer_id, count(distinct s.order_id) veces, sum(s.qty) unidades, max(s.created_at) ultima,
                   (array_agg(s.folio order by s.created_at desc))[1] ultimo_folio
              from public._ventas_cliente_producto() s
             where s.product_id = p_product and s.customer_id is not null
             group by s.customer_id) v
      join public.customers c on c.id = v.customer_id
     where a.todos or public._cc_vendedor_de_cliente(c.id) = a.uid), '[]'::jsonb);
end;
$$;

revoke all on function public._cc_busq_norm(text), public._ventas_cliente_producto(), public._alcance_compradores() from public, anon, authenticated;
