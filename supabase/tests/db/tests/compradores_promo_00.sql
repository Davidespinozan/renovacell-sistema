-- COMPRADORES × PROMOCIÓN (20270322) · lo vendido es la presentación y se cuenta en su familia; cada producto dice su
-- promoción vigente; cc_oportunidades_promo: a qué clientes de mi cartera ofrecerles lo que compraron y hoy está en promoción.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sJefe uuid := tests.user('pos');
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor');
  cu1 uuid; cu2 uuid; cuSin uuid; fam uuid; v1 uuid; v2 uuid; p3 uuid; p4 uuid; pm1 uuid; pm2 uuid; l2 uuid; o uuid; r jsonb; x jsonb; hoy date;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","jefe_ventas"]}' where id = sJefe;
  cu1 := tests.cliente(d1); cu2 := tests.cliente(d2);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1), (d2, s2);
  insert into public.customers (full_name, phone, active) values ('Clínica Sin Cuenta', '6691234567', true) returning id into cuSin;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cuSin, s1);

  fam := tests.product(1000); v1 := tests.product(1000); v2 := tests.product(1500); p3 := tests.product(300); p4 := tests.product(200);
  perform tests.act_as_owner();
  update public.products set name = 'Familia Toxina' where id = fam;
  update public.products set parent_product_id = fam, name = 'Toxina 100 U' where id = v1;
  update public.products set parent_product_id = fam, name = 'Toxina 300 U' where id = v2;
  perform tests.act_as_service();
  perform tests.order(d1, 'delivered', jsonb_build_array(jsonb_build_object('product_id', v1, 'qty', 2)));
  perform tests.order(d2, 'delivered', jsonb_build_array(jsonb_build_object('product_id', v2, 'qty', 1)));
  perform tests.act_as_owner();
  insert into public.orders (external_ref, customer_id, total, status, payment_method, payment_status) values ('F-CLIN-9', cuSin, 900, 'delivered', 'efectivo', 'pending') returning id into o;
  insert into public.order_items (order_id, product_id, qty, unit_price) values (o, p3, 3, 300);

  -- ══ 1 · sin promociones: la presentación cuenta en su familia (antes no aparecía) ══
  perform tests.act_as(s1);
  r := public.cc_productos_compradores();
  perform tests.ok(exists (select 1 from jsonb_array_elements(r) e where e ->> 'product_id' = fam::text and (e ->> 'clientes')::int = 1 and e -> 'promos' = '[]'::jsonb), '1 · lo comprado en presentación se cuenta en la familia');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(r) e where e ->> 'product_id' in (v1::text, v2::text)), '1 · la lista es por familia (sin las presentaciones sueltas)');
  r := public.cc_compradores_producto(fam);
  perform tests.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'customer_id' = cu1::text and r -> 0 -> 'presentaciones' = '["Toxina 100 U"]'::jsonb and not (r -> 0 ->> 'promo_aplica')::boolean, '1 · quién la compró y qué presentación (' || r::text || ')');
  perform tests.eq(public.cc_compradores_producto(v1), r, '1 · desde una presentación se ve la familia completa');
  perform tests.eq(public.cc_oportunidades_promo(), '[]'::jsonb, '1 · sin promoción vigente no hay a quién ofrecer');

  -- ══ 2 · promoción en OTRA presentación de la familia: se le ofrece a quien compró la familia ══
  perform tests.act_as_owner();
  hoy := public._promo_hoy();
  insert into public.promociones (nombre, desde, hasta) values ('Buen Fin', hoy - 1, hoy + 10) returning id into pm1;
  insert into public.promocion_lineas (promocion_id, product_id, min_qty, precio) values (pm1, v2, 1, 1300), (pm1, v2, 5, 1200), (pm1, p4, 1, 150);
  perform tests.act_as(s1);
  r := public.cc_productos_compradores();
  x := (select e from jsonb_array_elements(r) e where e ->> 'product_id' = fam::text);
  perform tests.ok(jsonb_array_length(x -> 'promos') = 1 and x -> 'promos' -> 0 ->> 'nombre' = 'Buen Fin' and x -> 'promos' -> 0 ->> 'producto' = 'Toxina 300 U'
                   and (x -> 'promos' -> 0 ->> 'precio_normal')::numeric = 1500 and jsonb_array_length(x -> 'promos' -> 0 -> 'escalones') = 2, '2 · la familia dice su promoción, precio normal y escalones (' || x::text || ')');
  perform tests.ok((public.cc_compradores_producto(fam) -> 0 ->> 'promo_aplica')::boolean, '2 · al comprador le aplica');
  r := public.cc_oportunidades_promo();
  perform tests.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'customer_id' = cu1::text and r -> 0 -> 'ofertas' -> 0 ->> 'familia' = 'Familia Toxina'
                   and (r -> 0 -> 'ofertas' -> 0 ->> 'veces')::int = 1 and r -> 0 ->> 'telefono' is not distinct from (select phone from public.customers where id = cu1), '2 · s1: solo su cliente que compró la familia en promoción (' || r::text || ')');
  perform tests.ok(r -> 0 -> 'vendedor' = 'null'::jsonb, '2 · el vendedor no ve nombres de vendedor');
  perform tests.act_as(sJefe);
  r := public.cc_oportunidades_promo();
  perform tests.ok(jsonb_array_length(r) = 2 and not exists (select 1 from jsonb_array_elements(r) e where e ->> 'customer_id' = cuSin::text)
                   and exists (select 1 from jsonb_array_elements(r) e where e ->> 'vendedor' is not null), '2 · el jefe ve a todos, con su vendedor; la clínica no (lo suyo no está en promoción)');

  -- ══ 3 · promoción limitada a otra lista de precios: no se le ofrece a quien no le aplica ══
  perform tests.act_as_owner();
  insert into public.price_lists (name, is_default, sort) values ('Solo distribuidores', false, 99) returning id into l2;
  insert into public.promociones (nombre, desde, hasta, listas) values ('Distribuidores', hoy, hoy + 3, array[l2]) returning id into pm2;
  insert into public.promocion_lineas (promocion_id, product_id, min_qty, precio) values (pm2, p3, 1, 250);
  perform tests.act_as(s1);
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.cc_oportunidades_promo()) e where e ->> 'customer_id' = cuSin::text), '3 · promoción de otra lista: no se le ofrece');
  perform tests.ok(not (public.cc_compradores_producto(p3) -> 0 ->> 'promo_aplica')::boolean, '3 · y en el detalle dice que no le aplica');
  perform tests.ok(jsonb_array_length((select e from jsonb_array_elements(public.cc_productos_compradores()) e where e ->> 'product_id' = p3::text) -> 'promos') = 1, '3 · la vista por producto sí la muestra (es informativa)');
  perform tests.act_as_owner();
  update public.promociones set listas = null where id = pm2;
  perform tests.act_as(s1);
  r := public.cc_oportunidades_promo();
  perform tests.ok(jsonb_array_length(r) = 2 and exists (select 1 from jsonb_array_elements(r) e where e ->> 'customer_id' = cuSin::text), '3 · para todas las listas: también la clínica sin cuenta');

  -- ══ 4 · desactivada o vencida: ya no cuenta ══
  perform tests.act_as_owner();
  update public.promociones set activa = false where id = pm1;
  update public.promociones set desde = hoy - 10, hasta = hoy - 1 where id = pm2;
  perform tests.act_as(s1);
  perform tests.eq(public.cc_oportunidades_promo(), '[]'::jsonb, '4 · promociones apagadas o vencidas no generan ofertas');
  perform tests.ok((select e -> 'promos' from jsonb_array_elements(public.cc_productos_compradores()) e where e ->> 'product_id' = fam::text) = '[]'::jsonb, '4 · ni aparecen en la lista');

  -- ══ 5 · permisos ══
  perform tests.act_as(d1);
  perform tests.throws('select public.cc_oportunidades_promo()', 'NO_AUTORIZADO', '5 · un doctor no');
  perform tests.act_as_anon();
  perform tests.throws('select public.cc_oportunidades_promo()', 'permission denied', '5 · anónimo no');
  perform tests.act_as(s1);
  perform tests.throws(format('select public._cc_promo_familia(%L, null)', fam), 'permission denied', '5 · los auxiliares no se llaman desde la app');
  perform tests.act_as(v_admin);
  perform tests.ok(jsonb_typeof(public.cc_oportunidades_promo()) = 'array', '5 · Dirección sí');
end $t$;
rollback;
