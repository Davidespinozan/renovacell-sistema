-- MAYOREO-REGLAS (20270222) · reglas del dueño sobre el pedido completo:
--   1. un producto en su MAYOREO → todo el pedido a mayoreo (cada uno a su mejor precio por cantidad);
--   2. los de medio mayoreo en 10 se juntan (5 + 5) para el medio mayoreo, nunca para el mayoreo; los de 5 no se juntan.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  a uuid := tests.product(1300); b uuid := tests.product(800); c uuid := tests.product(4600); d uuid := tests.product(500);
  e uuid := tests.product(100); f uuid := tests.product(2000); q jsonb; r jsonb; cu uuid;
  L jsonb;
begin
  perform tests.act_as_owner();
  insert into public.product_volume_prices (product_id, min_quantity, price, nivel) values
    (a, 10, 1170, 'medio'), (a, 50, 800, 'mayoreo'),     -- Nabota 100
    (b, 10, 720, 'medio'),  (b, 50, 400, 'mayoreo'),     -- Innotox 50
    (c, 5, 4370, 'medio'),  (c, 10, 3900, 'mayoreo'),    -- Botox 100 (medio en 5: no se junta)
    (d, 10, 450, 'medio'),  (d, 20, 400, 'mayoreo'),     -- Magnesio (otra categoría)
    (f, 20, 1200, 'mayoreo');                            -- Revage R: su único escalón es el mayoreo
  perform tests.act_as_service();

  -- ══ 2 · juntar para el medio mayoreo ══
  L := jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 5), jsonb_build_object('product_id', b, 'qty', 5));
  q := public._qty_volumen(L);
  perform tests.ok(public.precio_de(a, null, 5, (q ->> a::text)::int) = 1170 and public.precio_de(b, null, 5, (q ->> b::text)::int) = 720, '2 · 5 Nabota + 5 Innotox: los dos a su medio mayoreo');
  q := public._qty_volumen(jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 5), jsonb_build_object('product_id', d, 'qty', 5)));
  perform tests.ok(public.precio_de(d, null, 5, (q ->> d::text)::int) = 450, '2 · se juntan aunque sean de otra categoría (cualquiera con medio en 10)');
  q := public._qty_volumen(jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 5), jsonb_build_object('product_id', b, 'qty', 4)));
  perform tests.ok(public.precio_de(a, null, 5, (q ->> a::text)::int) = 1300, '2 · 5 + 4 = 9: todavía no');
  q := public._qty_volumen(jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 5), jsonb_build_object('product_id', c, 'qty', 5)));
  perform tests.ok(public.precio_de(a, null, 5, (q ->> a::text)::int) = 1300, '2 · el Botox (medio en 5) no cuenta para juntar 10');
  q := public._qty_volumen(jsonb_build_array(jsonb_build_object('product_id', c, 'qty', 3), jsonb_build_object('product_id', c, 'qty', 2)));
  perform tests.eq((q ->> c::text)::int, 5, '2 · el mismo producto en dos renglones se suma');
  q := public._qty_volumen(jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 25), jsonb_build_object('product_id', b, 'qty', 25)));
  perform tests.ok(public.precio_de(a, null, 25, (q ->> a::text)::int) = 1170 and public.precio_de(b, null, 25, (q ->> b::text)::int) = 720, '2 · 25 + 25 no llega al mayoreo: juntar solo da medio mayoreo');

  -- ══ 1 · uno en mayoreo → todo el pedido a mayoreo ══
  q := public._qty_volumen(jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 50), jsonb_build_object('product_id', b, 'qty', 1),
         jsonb_build_object('product_id', c, 'qty', 1), jsonb_build_object('product_id', d, 'qty', 2), jsonb_build_object('product_id', e, 'qty', 1)));
  perform tests.ok(public.precio_de(a, null, 50, (q ->> a::text)::int) = 800 and public.precio_de(b, null, 1, (q ->> b::text)::int) = 400
    and public.precio_de(c, null, 1, (q ->> c::text)::int) = 3900 and public.precio_de(d, null, 2, (q ->> d::text)::int) = 400
    and public.precio_de(e, null, 1, (q ->> e::text)::int) = 100, '1 · 50 Nabota: Innotox, Botox y Magnesio a SU mayoreo; sin escalones, precio normal');
  q := public._qty_volumen(jsonb_build_array(jsonb_build_object('product_id', f, 'qty', 20), jsonb_build_object('product_id', a, 'qty', 1)));
  perform tests.ok(public.precio_de(a, null, 1, (q ->> a::text)::int) = 800, '1 · también dispara un producto cuyo único escalón es de mayoreo (Revage R)');
  q := public._qty_volumen(jsonb_build_array(jsonb_build_object('product_id', c, 'qty', 5), jsonb_build_object('product_id', a, 'qty', 1)));
  perform tests.ok(public.precio_de(a, null, 1, (q ->> a::text)::int) = 1300, '1 · llegar a un MEDIO mayoreo no dispara nada');

  -- ══ 3 · los que cobran usan las reglas ══
  perform tests.act_as_owner();
  insert into public.customers (full_name, active) values ('Clínica Mayoreo', true) returning id into cu;
  perform tests.act_as(v_admin);
  r := public.crear_pedido(gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 5), jsonb_build_object('product_id', b, 'qty', 5)), null, false, cu);
  perform tests.eq((r ->> 'total')::numeric, (5 * 1170 + 5 * 720)::numeric, '3 · crear_pedido: 5 + 5 a medio mayoreo');
  r := public.crear_pedido(gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 50), jsonb_build_object('product_id', c, 'qty', 1)), null, false, cu);
  perform tests.eq((r ->> 'total')::numeric, (50 * 800 + 3900)::numeric, '3 · crear_pedido: 50 Nabota → Botox a mayoreo');
  perform tests.eq(public.precio_de(a, null, 5), 1300::numeric, '3 · un renglón solo sigue igual (sin pedido no hay reglas)');

  -- ══ 4 · el nivel se valida y las piezas internas no se exponen ══
  perform tests.act_as_owner();
  perform tests.throws(format('insert into public.product_volume_prices (product_id, min_quantity, price, nivel) values (%L, 30, 10, ''super'')', e), 'ck_pvp_nivel', '4 · nivel solo medio o mayoreo');
  perform tests.act_as(v_admin);
  perform tests.throws('select public._qty_volumen(''[]''::jsonb)', 'permission denied', '4 · el cálculo interno no se llama con sesión');
end $t$;
rollback;
