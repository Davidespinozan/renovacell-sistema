-- CC-0A · Frontera de PRECIO: anon y doctor NO verificado no obtienen precio base, lista,
-- descuento por volumen ni estructura de listas; el doctor verificado ve lo suyo; el
-- personal conserva su lectura; precio_de / crear_pedido / vender_pos no cambian.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse');
  v_pos uuid := tests.user('pos'); v_drv uuid := tests.user('driver');
  v_doc uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor'); v_sus uuid := tests.user('warehouse');
  v_p uuid := tests.product(100); v_list uuid; v_o uuid := gen_random_uuid(); v_r jsonb; n int;
begin
  -- Fixtures con service_role (como lo haría Dirección desde la app, sin tocar la RLS que se prueba).
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;              -- doctor registrado, NO verificado
  insert into public.price_lists (name, is_default, sort) values ('Mayoreo-T', false, 1) returning id into v_list;
  insert into public.product_prices (product_id, list_id, price) values (v_p, v_list, 80);
  insert into public.product_volume_prices (product_id, min_quantity, price, discount_percent) values (v_p, 5, 90, 10);
  update public.profiles set price_list_id = v_list where id in (v_doc, v_nov);
  perform tests.act_as_owner();

  -- ══ puede_ver_precio(): una sola verdad ══════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws('select public.puede_ver_precio()', 'permission denied', 'anon no puede ni invocar puede_ver_precio()');
  perform tests.act_as(v_nov);
  perform tests.ok(not public.puede_ver_precio(), 'doctor NO verificado: puede_ver_precio = false');
  perform tests.act_as(v_doc);
  perform tests.ok(public.puede_ver_precio(), 'doctor verificado: puede_ver_precio = true');
  perform tests.act_as(v_wh);
  perform tests.ok(public.puede_ver_precio(), 'almacén: puede_ver_precio = true');
  perform tests.act_as(v_admin);
  perform tests.ok(public.puede_ver_precio(), 'Dirección: puede_ver_precio = true');
  perform tests.act_as_owner();
  perform tests.suspender(v_sus, 'prueba cc0a');
  perform tests.act_as(v_sus);
  perform tests.throws('select public.puede_ver_precio()', 'CUENTA_SUSPENDIDA', 'suspendido: falla cerrado (no false silencioso)');
  perform tests.act_as_owner();

  -- ══ A · product_volume_prices ════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.product_volume_prices', 'permission denied', 'ANON: product_volume_prices sin privilegio');
  perform tests.act_as(v_nov);
  perform tests.eq((select count(*) from public.product_volume_prices)::int, 0, 'DOCTOR_UNVERIFIED: 0 reglas de volumen');
  perform tests.act_as(v_doc);
  perform tests.eq((select count(*) from public.product_volume_prices where product_id = v_p)::int, 1, 'DOCTOR_VERIFIED: ve la regla de volumen');
  perform tests.act_as(v_wh);
  perform tests.eq((select count(*) from public.product_volume_prices where product_id = v_p)::int, 1, 'WAREHOUSE: ve volumen (como antes)');
  perform tests.act_as(v_pos);
  perform tests.eq((select count(*) from public.product_volume_prices where product_id = v_p)::int, 1, 'POS: ve volumen');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*) from public.product_volume_prices where product_id = v_p)::int, 1, 'ADMIN: ve volumen');
  perform tests.lives(format('insert into public.product_volume_prices (product_id, min_quantity, price) values (%L, 10, 1)', v_p), 'ADMIN escribe volumen (pvp_write intacto)');
  perform tests.act_as(v_doc);
  perform tests.throws(format('insert into public.product_volume_prices (product_id, min_quantity, price) values (%L, 20, 1)', v_p), 'row-level security', 'DOCTOR_VERIFIED no escribe volumen');

  -- ══ B · product_prices ═══════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.product_prices', 'permission denied', 'ANON: product_prices sin privilegio');
  perform tests.act_as(v_nov);
  perform tests.eq((select count(*) from public.product_prices)::int, 0, 'DOCTOR_UNVERIFIED: 0 precios de lista aunque tenga lista asignada');
  perform tests.act_as(v_doc);
  perform tests.eq((select price from public.product_prices where product_id = v_p and list_id = v_list), 80::numeric, 'DOCTOR_VERIFIED: ve el precio de SU lista');
  perform tests.act_as_service();
  insert into public.price_lists (name, sort) values ('VIP-T', 2);
  insert into public.product_prices (product_id, list_id, price) select v_p, id, 50 from public.price_lists where name = 'VIP-T';
  perform tests.act_as(v_doc);
  perform tests.eq((select count(*) from public.product_prices where product_id = v_p)::int, 1, 'DOCTOR_VERIFIED: NO ve otras listas');
  perform tests.act_as(v_bill);
  perform tests.eq((select count(*) from public.product_prices where product_id = v_p)::int, 2, 'BILLING: ve todas las listas');
  perform tests.act_as(v_drv);
  perform tests.eq((select count(*) from public.product_prices)::int, 0, 'DRIVER: sin lectura de listas (igual que antes)');

  -- ══ C · price_lists (estructura) ═════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.price_lists', 'permission denied', 'ANON: price_lists sin privilegio');
  perform tests.act_as(v_nov);
  perform tests.eq((select count(*) from public.price_lists)::int, 0, 'DOCTOR_UNVERIFIED: no descubre la estructura de listas');
  perform tests.act_as(v_doc);
  perform tests.ok((select count(*) from public.price_lists) >= 3, 'DOCTOR_VERIFIED: lee nombres de listas (como antes)');

  -- ══ D · products_safe / product_stock ya cumplían (se confirma, no se cambia) ═
  perform tests.act_as(v_nov);
  perform tests.eq((select count(*) from public.products_safe)::int, 0, 'DOCTOR_UNVERIFIED: products_safe vacío (precio base no sale por aquí)');
  perform tests.eq((select count(*) from public.product_stock)::int, 0, 'DOCTOR_UNVERIFIED: product_stock vacío');
  perform tests.act_as(v_doc);
  perform tests.eq((select price from public.products_safe where id = v_p), 100::numeric, 'DOCTOR_VERIFIED: precio base en products_safe');
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.products_safe', 'permission denied', 'ANON: products_safe sin privilegio');

  -- ══ E · inferencia por otra vía: precio_de() y crear_pedido para el no verificado ═
  perform tests.act_as(v_nov);
  perform tests.throws(format('select public.crear_pedido(%L, ''CC0A-1'', %L, %L)', v_o, v_nov, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1))),
    'No autorizado', 'DOCTOR_UNVERIFIED: crear_pedido niega (sin precio en la respuesta)');
  perform tests.ok(not exists (select 1 from public.orders where id = v_o), 'y no quedó pedido');

  -- ══ F · el pricing del servidor no cambió ════════════════════════════════
  perform tests.act_as_owner();
  perform tests.eq(public.precio_de(v_p, v_list, 1), 80::numeric, 'precio_de: lista');
  perform tests.eq(public.precio_de(v_p, v_list, 5), 80::numeric, 'precio_de: least(lista, volumen)');
  perform tests.eq(public.precio_de(v_p, null, 5), 90::numeric, 'precio_de: volumen sobre base');
  perform tests.act_as(v_doc);
  v_r := public.crear_pedido(v_o, 'CC0A-2', v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 5)));
  perform tests.eq((v_r ->> 'total')::numeric, 400::numeric, 'DOCTOR_VERIFIED: crear_pedido con precio de servidor (5 × 80)');
  perform tests.act_as_owner();
end $t$;
rollback;
