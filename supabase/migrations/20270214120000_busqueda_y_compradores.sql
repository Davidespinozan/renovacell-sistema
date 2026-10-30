-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- HERRAMIENTAS DEL VENDEDOR · bloque A (30 oct 2026).
--   · cc_buscar_mensajes: buscar una PALABRA en todas las conversaciones que quien busca puede ver ("muchas veces se
--     acuerdan de que hablaron algo con alguien pero no se acuerdan del cliente"). Sin acentos ni mayúsculas; el
--     vendedor en las suyas (las que atiende o atendió), Dirección en todas. Devuelve por conversación el mensaje más
--     reciente que coincide y cuántas veces aparece.
--   · cc_productos_compradores / cc_compradores_producto: por producto, qué clientes lo compraron (para volver a
--     ofrecérselo). Decisión del dueño: cada vendedor ve SOLO su cartera; el jefe de ventas y Dirección, todos. Venta =
--     pedido no cancelado, ni borrador, ni pendiente de pago, y renglón con precio (las cotizaciones no cuentan).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_buscar_mensajes(text,integer)') is not null then raise exception 'BLOQUE-A: ya aplicada'; end if;
  if to_regprocedure('public._cc_puede_atender(uuid)') is null or to_regprocedure('public._jefe_ventas()') is null or to_regprocedure('public._cc_vendedor_de_cliente(uuid)') is null then
    raise exception 'BLOQUE-A: faltan CC-2, COMISIONES-JEFE o VINCULAR-CLIENTE'; end if;
end $pre$;

create index if not exists idx_order_items_product on public.order_items (product_id);
create index if not exists idx_order_items_order on public.order_items (order_id);

-- Texto para comparar: minúsculas y sin acentos (conserva números y signos: un folio o una presentación también se buscan).
create function public._cc_busq_norm(p text) returns text language sql immutable set search_path = public as
$$ select translate(lower(coalesce(p, '')), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc') $$;

create function public.cc_buscar_mensajes(p_q text, p_limite integer default 40) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_role text := public.auth_role(); v_q text := btrim(public._cc_busq_norm(p_q));
begin
  if v_uid is null or not (v_role = 'admin' or (v_role = 'pos' and public._cc_puede_atender(v_uid))) then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if length(v_q) < 3 then return '[]'::jsonb; end if;
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  return coalesce((
    select jsonb_agg(x order by (x ->> 'fecha') desc) from (
      select jsonb_build_object(
        'conversation_id', c.id, 'nombre', public._cc_nombre_dueno(c.id), 'abierta', c.estado = 'abierta', 'tuya', c.seller_profile_id = v_uid,
        'puede_abrir', v_role = 'admin' or (c.estado = 'abierta' and c.seller_profile_id = v_uid and c.modo in ('human_requested', 'human_assigned', 'human_active', 'human_ended')),
        'fecha', m.created_at, 'quien', m.actor_type, 'texto', left(m.content, 600), 'coincidencias', m.n) x
      from (select distinct on (mm.conversation_id) mm.conversation_id, mm.content, mm.created_at, mm.actor_type,
                   count(*) over (partition by mm.conversation_id) n
              from public.cc_messages mm join public.cc_conversations cc on cc.id = mm.conversation_id
             where mm.actor_type <> 'system' and public._cc_busq_norm(mm.content) like '%' || v_q || '%' escape '\'
               and (v_role = 'admin' or cc.seller_profile_id = v_uid
                    or exists (select 1 from public.cc_participants pa where pa.conversation_id = cc.id and pa.profile_id = v_uid))
             order by mm.conversation_id, mm.seq desc) m
      join public.cc_conversations c on c.id = m.conversation_id
      order by m.created_at desc
      limit greatest(1, least(coalesce(p_limite, 40), 100))) t), '[]'::jsonb);
end;
$$;
revoke all on function public.cc_buscar_mensajes(text, integer) from public, anon;
grant execute on function public.cc_buscar_mensajes(text, integer) to authenticated;

-- Ventas por cliente y producto (una fila por renglón vendido), con el cliente resuelto aunque el pedido sea de una cuenta.
create function public._ventas_cliente_producto() returns table (product_id uuid, customer_id uuid, order_id uuid, qty integer, created_at timestamptz, folio text)
  language sql stable security definer set search_path = public as
$$
  select oi.product_id, coalesce(o.customer_id, (select cu.id from public.customers cu where cu.profile_id = o.doctor_id order by cu.created_at limit 1)),
         o.id, oi.qty, o.created_at, o.external_ref
    from public.orders o join public.order_items oi on oi.order_id = o.id
   where o.status not in ('cancelled', 'draft', 'pending_payment') and oi.unit_price is not null and oi.product_id is not null
$$;

-- ¿Quién llama ve a todos los clientes (jefe de ventas o Dirección) o solo a su cartera (vendedor)?
create function public._alcance_compradores(out todos boolean, out uid uuid) language plpgsql stable security definer set search_path = public as
$$
begin
  uid := auth.uid();
  if uid is null or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  todos := public.auth_role() = 'admin' or public._jefe_ventas();
end;
$$;

create function public.cc_productos_compradores() returns jsonb language plpgsql stable security definer set search_path = public as
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

create function public.cc_compradores_producto(p_product uuid) returns jsonb language plpgsql stable security definer set search_path = public as
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
revoke all on function public.cc_productos_compradores(), public.cc_compradores_producto(uuid) from public, anon;
grant execute on function public.cc_productos_compradores(), public.cc_compradores_producto(uuid) to authenticated;

do $post$ begin
  if to_regprocedure('public.cc_buscar_mensajes(text,integer)') is null or to_regprocedure('public.cc_compradores_producto(uuid)') is null then
    raise exception 'BLOQUE-A: no quedó aplicada'; end if;
end $post$;
