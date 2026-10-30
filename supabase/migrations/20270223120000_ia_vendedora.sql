-- ============================================================================
-- IA-VENDEDORA (30 oct 2026) · el dueño quiere que la IA "también la haga de vendedor": que conozca precios de medio mayoreo
-- y mayoreo, las reglas del pedido y las promociones, que cotice combinaciones, que vea oportunidades de ahorro exactas y
-- que recomiende por especialidad, complementos y recompra. Todo sale del SERVIDOR (nunca lo calcula el modelo):
--   · _cc_precio_vol: cada escalón dice si es medio mayoreo o mayoreo, si el producto se junta para el medio de 10 y las
--     reglas del pedido.
--   · cc_ia_cotizar: cotiza varias líneas con las reglas del pedido (lo que se cobraría) + oportunidades.
--   · _cc_oportunidades: cuánto falta para el siguiente nivel y cuánto ahorra en lo que YA lleva (montos exactos).
--   · cc_ia_perfil_comercial: tipo de cliente, especialidad, lo que compra, su carrito, sus oportunidades y lo que buscó.
--   · cc_ia_recomendaciones: complementos curados, comprados juntos, por especialidad, recompra y similares.
--   · cc_producto_especialidad: qué especialidades usan cada producto (lo cura Dirección).
--   · cc_actividad_catalogo + cc_registrar_actividad: búsquedas y fichas vistas en el catálogo (señal para la IA y el vendedor).
-- Precio solo para quien puede verlo (cc_ia_contexto_actor.puede_precio): un visitante o un doctor sin verificar no recibe montos.
-- ============================================================================

-- ── 0 · Reglas del pedido en palabras (una sola fuente para la IA) ─────────────────────────────────
create or replace function public._cc_reglas_pedido_texto() returns text language sql immutable as
$$ select 'Reglas de precio por cantidad del pedido: 1) si un producto llega a su escalón de mayoreo, TODO el pedido se cobra a mayoreo (cada producto a su propio mejor precio por cantidad); 2) los productos cuyo medio mayoreo empieza en 10 piezas se pueden juntar entre sí, aunque sean distintos (5 de uno + 5 de otro = 10), y cada uno queda a su medio mayoreo; juntar piezas solo alcanza el medio mayoreo, nunca el mayoreo; los de medio mayoreo en 5 no se juntan. Una promoción vigente con mejor precio siempre manda.' $$;

-- ── 1 · Precio de un producto con el nivel de cada escalón ────────────────────────────────────────
create or replace function public._cc_precio_vol(p_profile uuid, p_product uuid, p_qty integer, p_qty_vol integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; v_list uuid; v_qty int := least(greatest(coalesce(p_qty, 1), 1), 999); v_unit numeric; v_base numeric; prod record; v_normal numeric; v_promo jsonb; v_promo_unit numeric;
begin
  ctx := public.cc_ia_contexto_actor(p_profile);
  if not (ctx ->> 'puede_precio')::boolean then
    return jsonb_build_object('autorizado', false, 'motivo', 'PRICE_REQUIRES_VERIFICATION');
  end if;
  select p.id, p.name, p.sellable into prod from public.products p where p.id = p_product and p.active and (p.show_portal or p.show_landing);
  if prod.id is null then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_DISPONIBLE'); end if;
  if not prod.sellable then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_VENDIBLE', 'nombre', prod.name); end if;
  select price_list_id into v_list from public.profiles where id = p_profile;
  v_unit := public.precio_de(p_product, v_list, v_qty, greatest(v_qty, coalesce(p_qty_vol, v_qty)));
  v_base := public.precio_de(p_product, v_list, 1);
  if v_unit is null then return jsonb_build_object('autorizado', false, 'motivo', 'SIN_PRECIO', 'nombre', prod.name); end if;
  select coalesce((select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = v_list), (select pr.price from public.products pr where pr.id = p_product)) into v_normal;
  v_promo := public._promo_info(p_product, v_list);
  v_promo_unit := public._promo_precio(p_product, v_list, v_qty);
  return jsonb_build_object('autorizado', true, 'product_id', prod.id, 'nombre', prod.name, 'cantidad', v_qty, 'precio_unitario', v_unit, 'total', round(v_unit * v_qty, 2), 'moneda', 'MXN',
    'por_volumen', v_unit < v_base,
    'lista', (select l.name from public.price_lists l where l.id = v_list),
    'escalas', (select coalesce(jsonb_agg(jsonb_build_object('desde', pv.min_quantity, 'precio', pv.price, 'nivel', case pv.nivel when 'mayoreo' then 'mayoreo' else 'medio_mayoreo' end) order by pv.min_quantity), '[]'::jsonb) from public.product_volume_prices pv where pv.product_id = p_product and pv.active),
    -- IA-VENDEDORA · las reglas del pedido viajan con cada precio: la IA las explica y las usa para vender
    'se_junta_para_medio_mayoreo', exists (select 1 from public.product_volume_prices pv where pv.product_id = p_product and pv.active and pv.nivel = 'medio' and pv.min_quantity = 10
                                           and not exists (select 1 from public.product_volume_prices o where o.product_id = p_product and o.active and o.nivel = 'medio' and o.min_quantity < 10)),
    'reglas_del_pedido', public._cc_reglas_pedido_texto(),
    'precio_normal', v_normal,
    'en_promocion', v_promo is not null and v_promo_unit is not null and v_unit = v_promo_unit and v_unit < coalesce(v_normal, v_unit + 1),
    'promocion', v_promo);
end;
$function$;

-- ── 2 · Especialidades por producto (lo cura Dirección; la IA recomienda con esto) ────────────────
create table if not exists public.cc_producto_especialidad (
  product_id  uuid not null references public.products(id) on delete cascade,
  especialidad text not null references public.especialidades(clave) on update cascade on delete cascade,
  origen      text not null default 'manual' check (origen in ('manual', 'fuente')),
  created_by  uuid, created_at timestamptz not null default now(),
  primary key (product_id, especialidad));
alter table public.cc_producto_especialidad enable row level security;
revoke all on public.cc_producto_especialidad from public, anon, authenticated;

create or replace function public.producto_especialidades() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if public.auth_role() not in ('admin', 'pos', 'billing', 'comm') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_object_agg(product_id, claves) from (select product_id, jsonb_agg(especialidad order by especialidad) claves from public.cc_producto_especialidad group by 1) x), '{}'::jsonb);
end;
$$;
create or replace function public.producto_especialidades_guardar(p_product uuid, p_claves text[]) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_n int;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from public.products where id = p_product) then raise exception 'PRODUCTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if exists (select 1 from unnest(coalesce(p_claves, '{}')) c where not exists (select 1 from public.especialidades e where e.clave = c and e.activa)) then
    raise exception 'ESPECIALIDAD_INVALIDA' using errcode = 'check_violation';
  end if;
  delete from public.cc_producto_especialidad where product_id = p_product and especialidad <> all (coalesce(p_claves, '{}'));
  insert into public.cc_producto_especialidad (product_id, especialidad, created_by)
  select p_product, c, auth.uid() from unnest(coalesce(p_claves, '{}')) c on conflict do nothing;
  select count(*) into v_n from public.cc_producto_especialidad where product_id = p_product;
  return jsonb_build_object('product_id', p_product, 'especialidades', v_n);
end;
$$;

-- ── 3 · Actividad en el catálogo (búsquedas y fichas vistas) ──────────────────────────────────────
create table if not exists public.cc_actividad_catalogo (
  id         bigserial primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tipo       text not null check (tipo in ('busqueda', 'ficha', 'sin_resultados')),
  product_id uuid references public.products(id) on delete cascade,
  termino    text check (termino is null or length(termino) between 2 and 80),
  at         timestamptz not null default now(),
  constraint ck_act_dato check ((tipo = 'ficha' and product_id is not null) or (tipo <> 'ficha' and termino is not null)));
create index if not exists ix_act_perfil_at on public.cc_actividad_catalogo (profile_id, at desc);
alter table public.cc_actividad_catalogo enable row level security;
revoke all on public.cc_actividad_catalogo from public, anon, authenticated;

create or replace function public.cc_registrar_actividad(p_tipo text, p_product uuid default null, p_termino text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- El doctor (su propia sesión) deja la señal; repetida en 10 min no se duplica y hay un techo por hora.
declare v_uid uuid := auth.uid(); v_term text := nullif(left(btrim(regexp_replace(coalesce(p_termino, ''), '\s+', ' ', 'g')), 80), '');
begin
  if v_uid is null or public.auth_role() <> 'doctor' then return jsonb_build_object('ok', false); end if;
  if p_tipo not in ('busqueda', 'ficha', 'sin_resultados') then raise exception 'DATO_INVALIDO:tipo' using errcode = 'check_violation'; end if;
  if p_tipo = 'ficha' and (p_product is null or not exists (select 1 from public.products where id = p_product and active)) then return jsonb_build_object('ok', false); end if;
  if p_tipo <> 'ficha' and (v_term is null or length(v_term) < 2) then return jsonb_build_object('ok', false); end if;
  if (select count(*) from public.cc_actividad_catalogo where profile_id = v_uid and at > now() - interval '1 hour') >= 120 then return jsonb_build_object('ok', false, 'limite', true); end if;
  if exists (select 1 from public.cc_actividad_catalogo a where a.profile_id = v_uid and a.tipo = p_tipo and a.at > now() - interval '10 minutes'
              and a.product_id is not distinct from (case when p_tipo = 'ficha' then p_product end)
              and lower(coalesce(a.termino, '')) = lower(coalesce(case when p_tipo <> 'ficha' then v_term end, ''))) then
    return jsonb_build_object('ok', true, 'repetida', true);
  end if;
  insert into public.cc_actividad_catalogo (profile_id, tipo, product_id, termino)
  values (v_uid, p_tipo, case when p_tipo = 'ficha' then p_product end, case when p_tipo <> 'ficha' then v_term end);
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 4 · Totales y oportunidades del pedido (montos exactos del servidor) ──────────────────────────
create or replace function public._cc_lineas_total(p_lines jsonb, p_list uuid, p_vq jsonb default null) returns numeric
  language sql stable security definer set search_path = public as
$$
  with l as (select (x ->> 'product_id')::uuid pid, sum((x ->> 'qty')::int)::int q from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x group by 1),
  v as (select coalesce(p_vq, public._qty_volumen(p_lines)) vq)
  select coalesce(round(sum(public.precio_de(l.pid, p_list, l.q, greatest(l.q, coalesce((v.vq ->> l.pid::text)::int, l.q))) * l.q), 2), 0) from l, v;
$$;

create or replace function public._cc_oportunidades(p_lines jsonb, p_list uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare
  v_total numeric; v_vq jsonb; v_l jsonb; t record; hyp jsonb; vq2 jsonb; v_ya numeric; v_nuevo numeric; out jsonb := '[]'::jsonb; v_suma10 int; v_pool jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then return '[]'::jsonb; end if;
  v_total := public._cc_lineas_total(p_lines, p_list); v_vq := public._qty_volumen(p_lines);
  select jsonb_agg(jsonb_build_object('pid', l.pid, 'q', l.q, 'nombre', p.name,
           't_medio', (select min(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = 'medio'),
           't_mayoreo', (select min(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = 'mayoreo')))
    into v_l
    from (select (x ->> 'product_id')::uuid pid, sum((x ->> 'qty')::int)::int q from jsonb_array_elements(p_lines) x group by 1) l
    join public.products p on p.id = l.pid;
  if v_l is null then return '[]'::jsonb; end if;
  -- Ya hay un producto en mayoreo: todo el pedido está en su mejor precio; no hay nada que ofrecer por cantidad.
  if exists (select 1 from jsonb_array_elements(v_l) e where (e ->> 't_mayoreo') is not null and (e ->> 'q')::int >= (e ->> 't_mayoreo')::int) then return '[]'::jsonb; end if;
  -- Mayoreo: si ESTE producto llega a su mayoreo, todo el pedido baja.
  for t in select (e ->> 'pid')::uuid pid, (e ->> 'q')::int q, e ->> 'nombre' nombre, (e ->> 't_mayoreo')::int t_mayoreo
             from jsonb_array_elements(v_l) e where (e ->> 't_mayoreo') is not null and (e ->> 'q')::int < (e ->> 't_mayoreo')::int
            order by (e ->> 't_mayoreo')::int - (e ->> 'q')::int limit 3 loop
    hyp := (select jsonb_agg(jsonb_build_object('product_id', e ->> 'pid', 'qty', case when (e ->> 'pid')::uuid = t.pid then t.t_mayoreo else (e ->> 'q')::int end)) from jsonb_array_elements(v_l) e);
    vq2 := public._qty_volumen(hyp);
    v_nuevo := public._cc_lineas_total(hyp, p_list);
    v_ya := public._cc_lineas_total(p_lines, p_list, vq2);
    out := out || jsonb_build_array(jsonb_build_object('tipo', 'mayoreo', 'product_id', t.pid, 'nombre', t.nombre, 'lleva', t.q, 'faltan', t.t_mayoreo - t.q,
      'precio_unitario_al_llegar', public.precio_de(t.pid, p_list, t.t_mayoreo, t.t_mayoreo),
      'todo_el_pedido_a_mayoreo', true, 'total_actual', v_total, 'total_si_llega', v_nuevo, 'ahorro_en_lo_que_ya_lleva', round(v_total - v_ya, 2)));
  end loop;
  -- Juntar 10: piezas de productos con medio mayoreo en 10.
  select coalesce(sum((e ->> 'q')::int), 0), jsonb_agg(e ->> 'nombre') into v_suma10, v_pool from jsonb_array_elements(v_l) e where (e ->> 't_medio')::int = 10;
  if v_suma10 between 1 and 9 then
    vq2 := v_vq || coalesce((select jsonb_object_agg(e ->> 'pid', greatest((e ->> 'q')::int, 10)) from jsonb_array_elements(v_l) e where (e ->> 't_medio')::int = 10), '{}'::jsonb);
    v_ya := public._cc_lineas_total(p_lines, p_list, vq2);
    out := out || jsonb_build_array(jsonb_build_object('tipo', 'juntar_10', 'lleva', v_suma10, 'faltan', 10 - v_suma10, 'productos_que_ya_cuentan', v_pool,
      'como', 'agregando piezas de cualquier producto con medio mayoreo de 10 (también de los que ya lleva)',
      'total_actual', v_total, 'ahorro_en_lo_que_ya_lleva', round(v_total - v_ya, 2)));
  end if;
  -- Medio mayoreo propio que no se junta (p. ej. desde 5 piezas).
  for t in select (e ->> 'pid')::uuid pid, (e ->> 'q')::int q, e ->> 'nombre' nombre, (e ->> 't_medio')::int t_medio
             from jsonb_array_elements(v_l) e where (e ->> 't_medio') is not null and (e ->> 't_medio')::int <> 10 and (e ->> 'q')::int < (e ->> 't_medio')::int
            order by (e ->> 't_medio')::int - (e ->> 'q')::int limit 2 loop
    hyp := (select jsonb_agg(jsonb_build_object('product_id', e ->> 'pid', 'qty', case when (e ->> 'pid')::uuid = t.pid then t.t_medio else (e ->> 'q')::int end)) from jsonb_array_elements(v_l) e);
    v_nuevo := public._cc_lineas_total(hyp, p_list);
    out := out || jsonb_build_array(jsonb_build_object('tipo', 'medio_mayoreo', 'product_id', t.pid, 'nombre', t.nombre, 'lleva', t.q, 'faltan', t.t_medio - t.q,
      'precio_unitario_al_llegar', public.precio_de(t.pid, p_list, t.t_medio, t.t_medio), 'total_actual', v_total, 'total_si_llega', v_nuevo));
  end loop;
  return coalesce((select jsonb_agg(o order by (o ->> 'faltan')::int) from jsonb_array_elements(out) o), '[]'::jsonb);
end;
$$;

-- ── 5 · Cotizar varias líneas con las reglas del pedido ───────────────────────────────────────────
create or replace function public.cc_ia_cotizar(p_profile uuid, p_lineas jsonb) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare ctx jsonb; v_list uuid; v_lines jsonb; v_vq jsonb; v_out jsonb := '[]'::jsonb; v_total numeric := 0; v_normal numeric := 0; r record; v_unit numeric; v_pieza numeric;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  ctx := public.cc_ia_contexto_actor(p_profile);
  if not coalesce((ctx ->> 'puede_precio')::boolean, false) then return jsonb_build_object('autorizado', false, 'motivo', 'PRICE_REQUIRES_VERIFICATION'); end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 20 then return jsonb_build_object('autorizado', false, 'motivo', 'LINEAS_INVALIDAS'); end if;
  select price_list_id into v_list from public.profiles where id = p_profile;
  select jsonb_agg(jsonb_build_object('product_id', pid, 'qty', q)) into v_lines
    from (select (x ->> 'product_id')::uuid pid, sum(least(greatest(coalesce((x ->> 'cantidad')::int, (x ->> 'qty')::int, 1), 1), 999))::int q
            from jsonb_array_elements(p_lineas) x group by 1) l
    join public.products p on p.id = l.pid and p.active and p.sellable and (p.show_portal or p.show_landing);
  if v_lines is null then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_DISPONIBLE'); end if;
  v_vq := public._qty_volumen(v_lines);
  for r in select (x ->> 'product_id')::uuid pid, (x ->> 'qty')::int q, p.name from jsonb_array_elements(v_lines) x join public.products p on p.id = (x ->> 'product_id')::uuid order by p.name loop
    v_unit := public.precio_de(r.pid, v_list, r.q, (v_vq ->> r.pid::text)::int);
    v_pieza := public.precio_de(r.pid, v_list, 1);
    v_out := v_out || jsonb_build_array(jsonb_build_object('product_id', r.pid, 'nombre', r.name, 'cantidad', r.q, 'precio_pieza', v_pieza, 'precio_unitario', v_unit,
      'nivel_aplicado', (select case pv.nivel when 'mayoreo' then 'mayoreo' else 'medio_mayoreo' end from public.product_volume_prices pv
                          where pv.product_id = r.pid and pv.active and pv.price = v_unit order by pv.min_quantity desc limit 1),
      'por_reglas_del_pedido', (v_vq ->> r.pid::text)::int > r.q and v_unit < public.precio_de(r.pid, v_list, r.q),
      'subtotal', round(v_unit * r.q, 2)));
    v_total := v_total + round(v_unit * r.q, 2); v_normal := v_normal + round(v_pieza * r.q, 2);
  end loop;
  return jsonb_build_object('autorizado', true, 'moneda', 'MXN', 'lineas', v_out, 'total', v_total, 'ahorro_vs_precio_por_pieza', round(v_normal - v_total, 2),
    'oportunidades', public._cc_oportunidades(v_lines, v_list), 'reglas_del_pedido', public._cc_reglas_pedido_texto());
end;
$$;

-- ── 6 · Perfil comercial del cliente para la IA (solo con precio autorizado: doctor verificado) ──
create or replace function public.cc_ia_perfil_comercial(p_profile uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare ctx jsonb; v_cu uuid; cu record; v_list uuid; v_cart uuid; v_lines jsonb;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  ctx := public.cc_ia_contexto_actor(p_profile);
  if p_profile is null or ctx ->> 'actor' <> 'doctor' or not coalesce((ctx ->> 'puede_precio')::boolean, false) then return null; end if;
  v_cu := public._cc_chk_customer(p_profile);
  select c.tipo_cliente, coalesce(e.nombre, nullif(btrim(c.especialidad_otra), '')) especialidad, c.especialidad clave into cu
    from public.customers c left join public.especialidades e on e.clave = c.especialidad where c.id = v_cu;
  select price_list_id into v_list from public.profiles where id = p_profile;
  select k.id into v_cart from public.cc_carts k where k.profile_id = p_profile and k.estado = 'active' order by k.last_activity_at desc nulls last limit 1;
  select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.quantity)) into v_lines from public.cc_cart_items i where i.cart_id = v_cart;
  return jsonb_build_object(
    'tipo_cliente', case cu.tipo_cliente when 'clinica' then 'clínica' when 'doctor' then 'doctor(a) independiente' end,
    'especialidad', cu.especialidad,
    'compra_seguido', coalesce((select jsonb_agg(x order by x.piezas desc) from (
        select oi.product_id, p.name nombre, sum(oi.qty)::int piezas, count(distinct o.id)::int pedidos, max(o.created_at)::date ultima_compra
          from public.orders o join public.order_items oi on oi.order_id = o.id join public.products p on p.id = oi.product_id
         where (o.customer_id = v_cu or o.doctor_id = p_profile) and o.status <> 'cancelled' and o.created_at > now() - interval '18 months'
         group by 1, 2 order by sum(oi.qty) desc limit 8) x), '[]'::jsonb),
    'carrito', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'nombre', p.name, 'cantidad', i.quantity) order by i.created_at)
        from public.cc_cart_items i join public.products p on p.id = i.product_id where i.cart_id = v_cart), '[]'::jsonb),
    'oportunidades_del_carrito', case when v_lines is null then '[]'::jsonb else public._cc_oportunidades(v_lines, v_list) end,
    'interes_reciente', coalesce((select jsonb_agg(x) from (
        select case a.tipo when 'ficha' then 'vio_la_ficha' when 'sin_resultados' then 'busco_sin_resultados' else 'busco' end que_hizo,
               a.product_id, p.name nombre, a.termino, max(a.at)::date cuando, count(*)::int veces
          from public.cc_actividad_catalogo a left join public.products p on p.id = a.product_id
         where a.profile_id = p_profile and a.at > now() - interval '7 days'
         group by a.tipo, a.product_id, p.name, a.termino order by max(a.at) desc limit 8) x), '[]'::jsonb));
end;
$$;

-- ── 7 · Recomendaciones con motivo (solo productos vendibles y visibles para su audiencia) ─────────
create or replace function public.cc_ia_recomendaciones(p_profile uuid, p_product uuid default null, p_limite int default 6) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare ctx jsonb; v_aud text; v_cu uuid; v_esp text; v_cart uuid; lim int := least(greatest(coalesce(p_limite, 6), 1), 10);
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  ctx := public.cc_ia_contexto_actor(p_profile);
  v_aud := coalesce(ctx ->> 'audiencia', 'public');
  if p_profile is not null then
    v_cu := public._cc_chk_customer(p_profile);
    select especialidad into v_esp from public.customers where id = v_cu;
    select k.id into v_cart from public.cc_carts k where k.profile_id = p_profile and k.estado = 'active' order by k.last_activity_at desc nulls last limit 1;
  end if;
  return coalesce((
    with vis as (
      select p.* from public.products p
       where p.active and p.sellable and (case when v_aud = 'public' then p.show_landing else (p.show_portal or p.show_landing) end)
         and (p_product is null or p.id <> p_product)
         and not exists (select 1 from public.cc_cart_items i where i.cart_id = v_cart and i.product_id = p.id)),
    base as (select coalesce(p_product, null) pid),
    cart_ids as (select i.product_id from public.cc_cart_items i where i.cart_id = v_cart union select p_product where p_product is not null),
    c as (
      -- 1 · complementos y alternativas curados por Renovacell
      select r.related_id id, 1 prio, case r.tipo when 'complemento' then 'complemento' else 'alternativa' end motivo, r.nota detalle
        from public.cc_product_relations r where r.estado = 'approved' and r.product_id in (select product_id from cart_ids)
      union all
      -- 2 · lo que otros clientes compran junto con esto
      select oi2.product_id, 2, 'comprado_junto', count(distinct oi.order_id)::text || ' pedidos'
        from public.order_items oi join public.orders o on o.id = oi.order_id and o.status <> 'cancelled'
        join public.order_items oi2 on oi2.order_id = oi.order_id and oi2.product_id <> oi.product_id
       where oi.product_id in (select product_id from cart_ids)
       group by oi2.product_id having count(distinct oi.order_id) >= 2
      union all
      -- 3 · lo que usa su especialidad
      select pe.product_id, 3, 'tu_especialidad', (select e.nombre from public.especialidades e where e.clave = pe.especialidad)
        from public.cc_producto_especialidad pe where v_esp is not null and pe.especialidad = v_esp
      union all
      -- 4 · recompra: lo compró antes y hace más de 45 días que no lo pide
      select oi.product_id, 4, 'recompra', 'última compra ' || to_char(max(o.created_at), 'DD/MM/YYYY')
        from public.orders o join public.order_items oi on oi.order_id = o.id
       where v_cu is not null and (o.customer_id = v_cu or o.doctor_id = p_profile) and o.status <> 'cancelled'
       group by oi.product_id having max(o.created_at) < now() - interval '45 days'
      union all
      -- 5 · similares: misma familia o categoría del producto que está viendo
      select p.id, 5, 'similar', coalesce(p.family, p.category)
        from public.products p, public.products b where p_product is not null and b.id = p_product
         and ((b.family is not null and p.family = b.family) or (b.category is not null and p.category = b.category))),
    mejor as (select distinct on (c.id) c.id, c.prio, c.motivo, c.detalle from c order by c.id, c.prio)
    select jsonb_agg(jsonb_build_object('product_id', v.id, 'nombre', v.name, 'categoria', v.category, 'motivo', m.motivo, 'detalle', m.detalle) order by m.prio, v.name)
      from (select * from mejor order by prio limit lim) m join vis v on v.id = m.id), '[]'::jsonb);
end;
$$;

-- ── 8 · Permisos ─────────────────────────────────────────────────────────────────────────────────
alter function public._cc_reglas_pedido_texto() owner to postgres;
alter function public.producto_especialidades() owner to postgres;
alter function public.producto_especialidades_guardar(uuid, text[]) owner to postgres;
alter function public.cc_registrar_actividad(text, uuid, text) owner to postgres;
alter function public._cc_lineas_total(jsonb, uuid, jsonb) owner to postgres;
alter function public._cc_oportunidades(jsonb, uuid) owner to postgres;
alter function public.cc_ia_cotizar(uuid, jsonb) owner to postgres;
alter function public.cc_ia_perfil_comercial(uuid) owner to postgres;
alter function public.cc_ia_recomendaciones(uuid, uuid, int) owner to postgres;
revoke all on function public._cc_reglas_pedido_texto(), public.producto_especialidades(), public.producto_especialidades_guardar(uuid, text[]),
  public.cc_registrar_actividad(text, uuid, text), public._cc_lineas_total(jsonb, uuid, jsonb), public._cc_oportunidades(jsonb, uuid),
  public.cc_ia_cotizar(uuid, jsonb), public.cc_ia_perfil_comercial(uuid), public.cc_ia_recomendaciones(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public._cc_reglas_pedido_texto() to service_role;
grant execute on function public.producto_especialidades(), public.producto_especialidades_guardar(uuid, text[]), public.cc_registrar_actividad(text, uuid, text) to authenticated;
grant execute on function public._cc_lineas_total(jsonb, uuid, jsonb), public._cc_oportunidades(jsonb, uuid), public.cc_ia_cotizar(uuid, jsonb),
  public.cc_ia_perfil_comercial(uuid), public.cc_ia_recomendaciones(uuid, uuid, int) to service_role;
