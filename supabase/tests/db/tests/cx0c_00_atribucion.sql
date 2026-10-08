-- CX-0c · Atribución comercial del pedido: el SERVIDOR decide vendedor (cartera), su origen y el capturista; nada
-- del navegador cuenta; D3 en POS (cartera > cajero autenticado; no resoluble → sin vendedor); «Checkout canónico
-- (CC-6)» solo para el pedido que marcó el checkout; todo congelado para todos; visibilidad POS por vendedor (id),
-- histórico solo-email o cajero que registró el cobro.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse'); v_pack uuid := tests.user('packing');
  v_drv uuid := tests.user('driver');
  v_s1 uuid := tests.user('pos', 'vend1@test.local'); v_s2 uuid := tests.user('pos', 'caja2@test.local'); v_s3 uuid := tests.user('pos', 'otro3@test.local');
  v_sx uuid := tests.user('pos', 'baja@test.local');
  dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); dC uuid := tests.user('doctor'); dD uuid := tests.user('doctor'); dE uuid := tests.user('doctor');
  cA uuid; cB uuid; cC uuid; cE uuid; cH uuid; cH0 uuid; p uuid; lot uuid; cart uuid; rv uuid; o uuid; oA uuid; oP1 uuid; oP2 uuid; oP3 uuid; oV uuid; oHist uuid;
  r jsonb; m jsonb; st text; act text; mut text; n int; e text; ok boolean;
  lineas jsonb; pos_l jsonb; pos_a jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set full_name = 'Cajera Dos' where id = v_s2;
  update public.profiles set active = false where id = v_sx;   -- vendedor dado de baja
  cA := tests.cliente(dA); cB := tests.cliente(dB); cC := tests.cliente(dC); cE := tests.cliente(dE);
  update public.customers set seller_name = 'VENDEDOR ODOO' where id = cE;                                   -- ligada, sin cartera, con señal Odoo
  insert into public.customers (full_name, seller_name, source) values ('Histórico Odoo', 'VENDEDOR ODOO', 'odoo') returning id into cH;
  insert into public.customers (full_name, source) values ('Histórico sin señal', 'odoo') returning id into cH0;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, v_s1), (dC, v_sx), (dD, v_s1);
  p := tests.producto_fam('Rellenos', 'Hyalux', 100);
  lot := tests.stock(p, 'CX0C-L', 200);
  perform tests.act_as_owner();
  lineas := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1));
  pos_l := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1));
  pos_a := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 1));
  insert into public.doctor_locations (doctor_id, name, line1, exterior_number, neighborhood, postal_code, city, state, contact_phone, is_default)
  values (dA, 'Consultorio', 'Av. 1', '1', 'Centro', '82000', 'Mazatlán', 'Sinaloa', '6690000000', true),
         (dB, 'Consultorio', 'Av. 2', '2', 'Centro', '82000', 'Mazatlán', 'Sinaloa', '6690000000', true);

  -- ══ A · CHECKOUT CANÓNICO (CC-6) ══════════════════════════════════════════════════════════════
  perform tests.act_as_service();
  cart := (public.cc_carrito_abrir('doctor', null, dA) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart, 'doctor', null, dA, p, 1, 'a1');
  perform tests.act_as(dA);
  rv := (public.cc_checkout_revisar(cart) ->> 'review_id')::uuid;
  r := public.cc_checkout_confirmar(rv, 'op-cx0c-1');
  oA := (r ->> 'order_id')::uuid;
  perform tests.ok(coalesce(current_setting('app.cc_checkout_pedido', true), '') = '', 'A1 · tras el checkout la marca de canal queda vacía (sin residuo)');
  perform tests.act_as_owner();
  select shipping_meta into m from public.orders where id = oA;
  perform tests.ok(m ->> 'placed_by' = 'Checkout canónico (CC-6)', 'A1 · D5: checkout legítimo conserva «Checkout canónico (CC-6)»');
  perform tests.ok(m ->> 'seller_profile_id' = v_s1::text and m ->> 'seller' = 'vend1@test.local' and m ->> 'seller_origen' = 'cartera', 'A1 · checkout con cartera → vendedor de cartera');
  perform tests.ok(m ->> 'source' = 'cc_checkout' and m ? 'cart_id' and m ? 'checkout_review_id' and m -> 'customer' ->> 'id' = cA::text, 'A1 · resto del metadata del checkout y snapshot CX-0b intactos');
  perform tests.act_as_owner();
  perform tests.act_as_service();
  cart := (public.cc_carrito_abrir('doctor', null, dB) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart, 'doctor', null, dB, p, 1, 'b1');
  perform tests.act_as(dB);
  rv := (public.cc_checkout_revisar(cart) ->> 'review_id')::uuid;
  o := (public.cc_checkout_confirmar(rv, 'op-cx0c-2') ->> 'order_id')::uuid;
  perform tests.act_as_owner();
  select shipping_meta into m from public.orders where id = o;
  perform tests.ok(not (m ? 'seller') and not (m ? 'seller_profile_id') and m ->> 'seller_origen' = 'sin_vendedor' and m ->> 'placed_by' = 'Checkout canónico (CC-6)', 'A2 · checkout sin cartera → sin vendedor (y CC-6)');

  -- ══ B · CANAL Y ATRIBUCIÓN NO FALSIFICABLES (RPC directa del doctor) ══════════════════════════
  perform tests.act_as(dA);
  o := gen_random_uuid();
  r := public.crear_pedido(o, null, dA, lineas, jsonb_build_object('seller', 'otro3@test.local', 'seller_profile_id', v_s3, 'seller_origen', 'cartera',
         'placed_by', 'Checkout canónico (CC-6)', 'source', 'cc_checkout', 'notas', 'n'), false, null);
  perform tests.act_as_owner();
  select shipping_meta into m from public.orders where id = o;
  perform tests.ok(m ->> 'seller_profile_id' = v_s1::text and m ->> 'seller' = 'vend1@test.local' and m ->> 'seller_origen' = 'cartera', 'B1 · seller/id/origen falsificados por el doctor → se ignoran (cartera)');
  perform tests.ok(m ->> 'placed_by' = 'Pedido directo del portal', 'B2 · el doctor NO obtiene «Checkout canónico (CC-6)» falsificando placed_by/source');
  perform tests.ok(m ->> 'notas' = 'n', 'B3 · otras secciones del metadata se conservan');
  -- marca de canal: otra orden, residuo y rollback
  perform tests.act_as(dA);
  perform set_config('app.cc_checkout_pedido', gen_random_uuid()::text, true);
  o := gen_random_uuid(); perform public.crear_pedido(o, null, dA, lineas);
  perform set_config('app.cc_checkout_pedido', '', true);
  perform tests.act_as_owner();
  perform tests.eq((select shipping_meta ->> 'placed_by' from public.orders where id = o), 'Pedido directo del portal', 'B4 · marca de canal de OTRO pedido no sirve (ligada a p_order_id)');
  perform tests.act_as_owner();
  perform tests.act_as_service();
  cart := (public.cc_carrito_abrir('doctor', null, dA) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart, 'doctor', null, dA, p, 1, 'a2');
  perform tests.act_as(dA);
  rv := (public.cc_checkout_revisar(cart) ->> 'review_id')::uuid;
  perform set_config('app.cc_checkout_fallar', 'despues_w1', true);
  begin perform public.cc_checkout_confirmar(rv, 'op-cx0c-f'); exception when others then e := sqlerrm; end;
  perform set_config('app.cc_checkout_fallar', '', true);
  perform tests.ok(e like 'FALLO_INYECTADO%' and coalesce(current_setting('app.cc_checkout_pedido', true), '') = '', 'B5 · un checkout que falla después de crear el pedido no deja la marca activa (rollback)');
  o := gen_random_uuid(); perform public.crear_pedido(o, null, dA, lineas);
  perform tests.act_as_owner();
  perform tests.eq((select shipping_meta ->> 'placed_by' from public.orders where id = o), 'Pedido directo del portal', 'B6 · la operación siguiente no hereda la marca');
  -- superficie: nada expuesto fija GUCs con nombre dinámico; solo el checkout fija esta marca
  perform tests.ok(not exists (select 1 from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace where ns.nspname in ('public', 'graphql_public')
                                and pr.prosrc ~* 'set_config\s*\(\s*[^''\s]'), 'B7 · ninguna función expuesta llama set_config con nombre dinámico');
  perform tests.eq((select string_agg(pr.proname, ',' order by pr.proname) from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
                    where ns.nspname = 'public' and pr.prosrc ~ 'app\.cc_checkout_pedido' and pr.prosrc ~ 'set_config'), 'cc_checkout_confirmar', 'B8 · solo cc_checkout_confirmar fija la marca de canal');
  perform tests.ok(not exists (select 1 from pg_proc pr where array_to_string(pr.proconfig, ',') ~ 'cc_checkout_pedido'), 'B9 · ninguna función la fija por cláusula SET');
  perform tests.act_as(dA);
  perform tests.throws(format('select public._cx0c_atribucion(%L, null)', cA), 'permission denied', 'B10 · la resolución de cartera no es una RPC expuesta (doctor)');
  perform tests.act_as_anon();
  perform tests.throws(format('select public._cx0c_atribucion(%L, null)', cA), 'permission denied', 'B10 · ni para anon');
  perform tests.throws(format('select public._cx0c_venta_pos_propia(%L)', cA), 'permission denied', 'B11 · el auxiliar de autoría POS no es invocable por anon');
  perform tests.act_as_owner();

  -- ══ C · VENTAS (D2) ═══════════════════════════════════════════════════════════════════════════
  perform tests.act_as(v_admin);
  o := (public.crear_pedido(gen_random_uuid(), null, dA, lineas, '{"placed_by":"Fulano","seller":"x@y"}', false, cA) ->> 'order_id')::uuid;
  perform tests.act_as_owner(); select shipping_meta into m from public.orders where id = o;
  perform tests.ok(m ->> 'seller_profile_id' = v_s1::text and m ->> 'placed_by' = 'Administración', 'C1 · Dirección captura → vendedor de cartera; capturista «Administración» del servidor');
  perform tests.act_as(v_s2);
  oV := (public.crear_pedido(gen_random_uuid(), null, dA, lineas, null, false, cA) ->> 'order_id')::uuid;
  perform tests.act_as_owner(); select shipping_meta into m from public.orders where id = oV;
  perform tests.ok(m ->> 'seller_profile_id' = v_s1::text and m ->> 'placed_by' = 'Cajera Dos (Ventas)', 'C2 · POS captura en Ventas → vendedor = cartera, NO el capturista; placed_by del servidor');
  perform tests.act_as(v_s2);
  o := (public.crear_pedido(gen_random_uuid(), null, dB, lineas, null, false, cB) ->> 'order_id')::uuid;
  perform tests.act_as_owner(); select shipping_meta into m from public.orders where id = o;
  perform tests.ok(not (m ? 'seller') and m ->> 'seller_origen' = 'sin_vendedor', 'C3 · Ventas sin cartera → sin vendedor (el capturista no lo es)');
  perform tests.act_as(v_admin);
  o := (public.crear_pedido(gen_random_uuid(), null, null, lineas, null, false, cH) ->> 'order_id')::uuid;
  perform tests.act_as_owner(); perform tests.eq((select shipping_meta ->> 'seller_origen' from public.orders where id = o), 'no_resoluble', 'C4 · DX-1: histórico con vendedor Odoo sin equivalencia → no resoluble');
  perform tests.act_as(v_admin);
  o := (public.crear_pedido(gen_random_uuid(), null, null, lineas, null, false, cH0) ->> 'order_id')::uuid;
  perform tests.act_as_owner(); perform tests.eq((select shipping_meta ->> 'seller_origen' from public.orders where id = o), 'sin_vendedor', 'C5 · histórico sin señal → sin vendedor');
  perform tests.act_as(v_admin);
  o := (public.crear_pedido(gen_random_uuid(), null, dD, lineas, null, false, cH0) ->> 'order_id')::uuid;
  perform tests.act_as_owner(); perform tests.eq((select shipping_meta ->> 'seller_origen' from public.orders where id = o), 'no_resoluble', 'C6 · comprador con cartera + cuenta sin portal → señales contradictorias → no resoluble');
  perform tests.act_as(v_admin);
  o := (public.crear_pedido(gen_random_uuid(), null, dD, lineas) ->> 'order_id')::uuid;
  perform tests.act_as_owner(); perform tests.eq((select shipping_meta ->> 'seller_profile_id' from public.orders where id = o), v_s1::text, 'C7 · sin cuenta: cartera del comprador');
  perform tests.act_as(v_admin);
  o := (public.crear_pedido(gen_random_uuid(), null, dC, lineas, null, false, cC) ->> 'order_id')::uuid;
  perform tests.act_as_owner(); perform tests.eq((select shipping_meta ->> 'seller_origen' from public.orders where id = o), 'no_resoluble', 'C8 · vendedor de cartera dado de baja → no resoluble (sin atribución inventada)');
  perform tests.act_as(v_admin);
  o := (public.crear_pedido(gen_random_uuid(), null, dE, lineas, null, false, cE) ->> 'order_id')::uuid;
  perform tests.act_as_owner(); perform tests.eq((select shipping_meta ->> 'seller_origen' from public.orders where id = o), 'no_resoluble', 'C9 · cuenta ligada sin cartera pero con vendedor Odoo → no resoluble');

  -- ══ D · POS (D3) ══════════════════════════════════════════════════════════════════════════════
  perform tests.act_as(v_s2);
  oP1 := gen_random_uuid(); ok := public.vender_pos(oP1, 'CX0C-P1', 1, 'efectivo', null, '{"channel":"pos","seller":"otro3@test.local","placed_by":"X"}', pos_l, pos_a, false, null, cA);
  oP2 := gen_random_uuid(); ok := public.vender_pos(oP2, 'CX0C-P2', 1, 'efectivo', null, '{"channel":"pos","seller":"otro3@test.local"}', pos_l, pos_a, false, null, cB);
  oP3 := gen_random_uuid(); ok := public.vender_pos(oP3, 'CX0C-P3', 1, 'efectivo', null, '{"channel":"pos","seller":"otro3@test.local"}', pos_l, pos_a);
  o := gen_random_uuid(); ok := public.vender_pos(o, 'CX0C-P4', 1, 'efectivo', null, '{"channel":"pos"}', pos_l, pos_a, false, null, cH);
  perform tests.act_as_owner();
  select shipping_meta into m from public.orders where id = oP1;
  perform tests.ok(m ->> 'seller_profile_id' = v_s1::text and m ->> 'seller_origen' = 'cartera' and not (m ? 'placed_by'), 'D1 · POS con cartera → vendedor de cartera (no el cajero ni el falsificado); sin placed_by');
  perform tests.ok((select recorded_by = v_s2 from public.payment_entries where order_id = oP1), 'D1 · el cobro sigue registrado por el cajero (caja intacta)');
  select shipping_meta into m from public.orders where id = oP2;
  perform tests.ok(m ->> 'seller_profile_id' = v_s2::text and m ->> 'seller' = 'caja2@test.local' and m ->> 'seller_origen' = 'pos_cajero', 'D2 · POS sin cartera → cajero AUTENTICADO (no el que manda la caja)');
  select shipping_meta into m from public.orders where id = oP3;
  perform tests.ok(m ->> 'seller_profile_id' = v_s2::text and m ->> 'seller_origen' = 'pos_cajero', 'D3 · mostrador sin cuenta ni comprador → cajero autenticado');
  select shipping_meta into m from public.orders where id = o;
  perform tests.ok(not (m ? 'seller') and m ->> 'seller_origen' = 'no_resoluble', 'D4 · POS a histórico con señal Odoo → sin vendedor y SIN caer al cajero');
  perform tests.act_as(v_s2);
  o := gen_random_uuid(); ok := public.vender_pos(o, 'CX0C-P5', 1, 'efectivo', dD, '{}', pos_l, pos_a, false, null, cH0);
  perform tests.act_as_owner(); perform tests.eq((select shipping_meta ->> 'seller_origen' from public.orders where id = o), 'no_resoluble', 'D5 · POS con señales contradictorias → no resoluble (no cajero)');
  perform tests.act_as(v_s2);
  o := gen_random_uuid(); ok := public.vender_pos(o, 'CX0C-P6', 1, 'efectivo', null, '{}', pos_l, pos_a, false, null, cC);
  perform tests.act_as_owner(); perform tests.eq((select shipping_meta ->> 'seller_origen' from public.orders where id = o), 'no_resoluble', 'D6 · POS con vendedor de cartera dado de baja → no resoluble (no cajero)');
  perform tests.act_as(v_s2);
  ok := public.vender_pos(oP2, 'CX0C-P2', 1, 'efectivo', null, '{"channel":"pos","seller":"otro3@test.local"}', pos_l, pos_a, false, null, cB);
  perform tests.act_as_owner();
  perform tests.ok(ok and (select count(*) from public.payment_entries where order_id = oP2) = 1, 'D7 · idempotencia POS intacta (sin doble cobro)');

  -- ══ E · INMUTABILIDAD: 10 actores × 7 estados × mutaciones ═══════════════════════════════════
  foreach st in array array['pending_payment', 'paid', 'picking', 'packed', 'shipped', 'delivered', 'cancelled'] loop
    perform tests.act_as(v_admin);
    o := (public.crear_pedido(gen_random_uuid(), null, dD, lineas) ->> 'order_id')::uuid;   -- sin cuenta: aísla la guarda de atribución
    perform tests.act_as_owner();
    if st <> 'pending_payment' then perform tests.force_status(o, st); end if;
    foreach act in array array['doctor', 'admin', 'billing', 'warehouse', 'packing', 'service_role', 'app.trusted', 'bd_sin_jwt'] loop
      foreach mut in array array[
        'jsonb_set(shipping_meta, ''{seller}'', ''"x@y"'')', 'shipping_meta - ''seller''', format('jsonb_set(shipping_meta, ''{seller_profile_id}'', %L)', to_jsonb(v_s3::text)),
        'jsonb_set(shipping_meta, ''{seller_origen}'', ''"pos_cajero"'')', 'jsonb_set(shipping_meta, ''{placed_by}'', ''"Checkout canónico (CC-6)"'')',
        'jsonb_set(shipping_meta, ''{placed_by}'', ''null'')', '''{"tracking":"T1"}''::jsonb', 'null'] loop
        case act
          when 'doctor' then perform tests.act_as(dD);
          when 'admin' then perform tests.act_as(v_admin);
          when 'billing' then perform tests.act_as(v_bill);
          when 'warehouse' then perform tests.act_as(v_wh);
          when 'packing' then perform tests.act_as(v_pack);
          when 'service_role' then perform tests.act_as_service();
          when 'app.trusted' then perform tests.act_as_owner(); perform set_config('app.trusted', 'on', true);
          else perform tests.act_as_owner();
        end case;
        perform tests.throws(format('update public.orders set shipping_meta = %s where id = %L', mut, o), 'ATRIBUCION_PEDIDO_INMUTABLE', format('E · %s · %s · %s', st, act, left(mut, 34)));
        perform set_config('app.trusted', 'off', true);
      end loop;
    end loop;
    perform tests.act_as(v_s1); update public.orders set shipping_meta = jsonb_set(shipping_meta, '{seller}', '"x@y"') where id = o; get diagnostics n = row_count;
    perform tests.act_as(v_drv); update public.orders set shipping_meta = jsonb_set(shipping_meta, '{seller}', '"x@y"') where id = o; get diagnostics e = row_count;
    perform tests.act_as_owner();
    perform tests.ok(n = 0 and e = '0' and (select shipping_meta ->> 'seller_profile_id' = v_s1::text and shipping_meta ->> 'placed_by' = 'Administración' from public.orders where id = o),
      'E · ' || st || ' · pos/chofer 0 filas; atribución intacta');
  end loop;
  -- legítimas
  perform tests.act_as(v_admin);
  o := (public.crear_pedido(gen_random_uuid(), null, dA, lineas, null, false, cA) ->> 'order_id')::uuid;
  perform tests.lives(format('update public.orders set shipping_meta = shipping_meta || ''{"notas":"ok"}'' where id = %L', o), 'E-ok · notas (merge) siguen permitidas');
  perform tests.act_as_service();
  perform tests.lives(format('update public.orders set status = ''paid'' where id = %L', o), 'E-ok · webhook (service_role) cambia estado');
  perform tests.act_as_owner(); perform tests.force_status(o, 'packed');
  perform tests.act_as(v_wh);
  perform tests.lives(format('update public.orders set status = ''shipped'', shipping_meta = shipping_meta || ''{"tracking":"T-9"}'' where id = %L', o), 'E-ok · despacho (estado + tracking)');
  perform tests.act_as_owner();
  perform tests.ok((select shipping_meta ->> 'tracking' = 'T-9' and shipping_meta ->> 'seller_profile_id' = v_s1::text from public.orders where id = o), 'E-ok · el despacho conserva la atribución');

  -- ══ F · VISIBILIDAD POS (JWT con correo, como en producción) ═════════════════════════════════
  -- pedido histórico solo-email (anterior a CX-0c) y pedido de Ventas capturado por s2 sin cobro
  oHist := tests.order(null, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), 'pending', '{"seller":"otro3@test.local"}');
  perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated', 'email', 'vend1@test.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.ok((select count(*) from public.orders where id in (oA, oP1, oV)) = 3, 'F1 · vendedor comercial ve los pedidos de su cartera (checkout, POS y Ventas)');
  perform tests.ok((select count(*) from public.orders where id in (oP2, oP3, oHist)) = 0, 'F1 · y no ve ventas ajenas');
  perform set_config('request.jwt.claims', json_build_object('sub', v_s2, 'role', 'authenticated', 'email', 'caja2@test.local')::text, true);
  perform tests.ok((select count(*) from public.orders where id in (oP1, oP2, oP3)) = 3, 'F2 · cajero ve sus ventas, incluida la atribuida a otro vendedor (HIZO la venta POS)');
  perform tests.ok((select count(*) from public.orders where id in (oA, oHist)) = 0, 'F2 · cajero no ve pedidos de otros');
  perform tests.ok((select count(*) from public.orders where id = oV) = 0, 'F3 · capturista en Ventas sin cobro no ve el pedido (igual que antes de CX-0c)');
  perform set_config('request.jwt.claims', json_build_object('sub', v_s3, 'role', 'authenticated', 'email', 'otro3@test.local')::text, true);
  perform tests.ok((select count(*) from public.orders where id in (oA, oP1, oP2, oP3, oV)) = 0, 'F4 · otro POS no ve pedidos ajenos (aunque su correo vino falsificado en el metadata)');
  perform tests.ok((select count(*) from public.orders where id = oHist) = 1, 'F5 · pedido histórico solo-email: su vendedor por correo lo sigue viendo');
  perform tests.act_as_owner();
  -- cobro registrado por otra persona y reversa
  perform tests.cobrar(oV, 10);
  perform set_config('request.jwt.claims', json_build_object('sub', v_s2, 'role', 'authenticated', 'email', 'caja2@test.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.ok((select count(*) from public.orders where id = oV) = 0, 'F6 · un cobro registrado por OTRA persona no da visibilidad al capturista');
  perform tests.act_as(v_admin);
  perform public.reversar_asiento(gen_random_uuid(), (select id from public.payment_entries where order_id = oP1 and reversal_of is null limit 1), 'prueba CX-0c');
  perform set_config('request.jwt.claims', json_build_object('sub', v_s2, 'role', 'authenticated', 'email', 'caja2@test.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.ok((select count(*) from public.orders where id = oP1) = 1, 'F7 · tras reversar el cobro el cajero conserva su venta (la autoría no depende del pago)');
  -- ══ R1 · EXPLOIT F1: registrar un cobro NUNCA da visibilidad ═════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_s3, 'role', 'authenticated', 'email', 'otro3@test.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.ok((select count(*) from public.orders where id = oA) = 0, 'R1.1 · POS sin relación no ve el pedido de otro vendedor');
  perform public.registrar_cobro(gen_random_uuid(), oA, 'efectivo', 0.01);
  perform tests.ok((select count(*) from public.orders where id = oA) = 0, 'R1.2 · F1 BLOQUEADO: tras registrar un cobro de 0.01 sigue sin verlo');
  perform public.registrar_cobro(gen_random_uuid(), oA, 'efectivo', 0.01); perform public.registrar_cobro(gen_random_uuid(), oA, 'transferencia', 5);
  perform tests.ok((select count(*) from public.orders where id = oA) = 0, 'R1.3 · ni con varios cobros');
  perform tests.act_as(v_admin);
  perform public.reversar_asiento(gen_random_uuid(), (select id from public.payment_entries where order_id = oA and recorded_by = v_s3 and reversal_of is null and amount = 5), 'prueba R1');
  perform set_config('request.jwt.claims', json_build_object('sub', v_s3, 'role', 'authenticated', 'email', 'otro3@test.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.ok((select count(*) from public.orders where id = oA) = 0, 'R1.4 · ni después de una reversa');
  perform tests.eq((select shipping_meta ->> 'seller_profile_id' from public.orders where id = oA), null, 'R1.5 · (sin lectura, sin dato)');
  perform set_config('request.jwt.claims', json_build_object('sub', v_s1, 'role', 'authenticated', 'email', 'vend1@test.local')::text, true);
  perform tests.ok((select count(*) from public.orders where id = oA) = 1, 'R1.6 · el vendedor comercial conserva su visibilidad');
  perform tests.act_as(v_admin);
  perform tests.ok((select count(*) from public.orders where id = oA) = 1 and (select shipping_meta ->> 'seller_profile_id' from public.orders where id = oA) = v_s1::text,
    'R1.7 · Dirección lo ve y el cobro ajeno no cambió la atribución');
  -- escenario 6: el capturista de Ventas cobra → sigue sin permisos por capturar/cobrar
  perform set_config('request.jwt.claims', json_build_object('sub', v_s2, 'role', 'authenticated', 'email', 'caja2@test.local')::text, true); perform set_config('role', 'authenticated', true);
  perform public.registrar_cobro(gen_random_uuid(), oV, 'efectivo', 1);
  perform tests.ok((select count(*) from public.orders where id = oV) = 0, 'R1.8 · capturista que además cobra NO obtiene visibilidad (ni comisión: vendedor sigue siendo cartera)');
  -- escenario 7: pedido histórico sin operación venta_pos + cobro → no se inventa autoría
  perform public.registrar_cobro(gen_random_uuid(), oHist, 'efectivo', 1);
  perform tests.ok((select count(*) from public.orders where id = oHist) = 0, 'R1.9 · histórico sin autoría POS: un cobro posterior no la crea');
  -- ══ R1 · AUTORÍA NO FALSIFICABLE ══════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_s3, 'role', 'authenticated', 'email', 'otro3@test.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.throws(format('insert into public.inventory_operations (op_id, kind, actor, actor_role, request_hash, result) values (%L, ''venta_pos'', %L, ''pos'', ''x'', ''{}'')', oA, v_s3),
    'permission denied', 'R1.10 · POS no inserta operaciones (autoría inventada)');
  perform tests.throws(format('update public.inventory_operations set actor = %L where op_id = %L', v_s3, oP1), 'permission denied', 'R1.11 · POS no cambia el actor');
  perform tests.throws(format('delete from public.inventory_operations where op_id = %L', oP1), 'permission denied', 'R1.12 · POS no borra operaciones');
  perform tests.throws(format('select public._w1_op_finish(%L, ''venta_pos'', ''{}''::jsonb, ''{}''::jsonb)', oA), 'permission denied', 'R1.13 · el escritor interno de operaciones no es invocable');
  perform tests.throws(format('select public.vender_pos(%L, ''X-R1'', 1, ''efectivo'', null, ''{}'', %L, %L)', oA, pos_l, pos_a), 'PEDIDO_EXISTENTE', 'R1.14 · vender_pos con el id de un pedido ajeno: rechazado');
  perform tests.throws(format('select public.vender_pos(%L, ''OTRO'', 1, ''efectivo'', null, ''{}'', %L, %L)', oP1, pos_l, pos_a), 'OP_ID_REUTILIZADO', 'R1.15 · reutilizar la operación de otra venta: rechazado');
  perform tests.ok((select count(*) from public.orders where id = oA) = 0, 'R1.16 · tras los intentos, sigue sin verlo');
  perform tests.act_as_service();
  perform tests.throws(format('update public.inventory_operations set actor = %L where op_id = %L', v_s3, oP1), 'LEDGER_APPEND_ONLY', 'R1.17 · ni service_role reescribe la autoría (append-only)');
  perform tests.throws(format('delete from public.inventory_operations where op_id = %L', oP1), 'LEDGER_APPEND_ONLY', 'R1.18 · ni la borra');
  perform tests.act_as_owner();
  insert into public.inventory_operations (op_id, kind, actor, actor_role, request_hash, result) values (oA, 'ajuste', v_s3, 'pos', 'x', '{}');   -- otra clase de operación con ese id
  perform set_config('request.jwt.claims', json_build_object('sub', v_s3, 'role', 'authenticated', 'email', 'otro3@test.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.ok((select count(*) from public.orders where id = oA) = 0, 'R1.19 · una operación de OTRO tipo con el id del pedido no cuenta como venta POS');
  perform tests.ok(not public._cx0c_venta_pos_propia(oA) and public._cx0c_venta_pos_propia(oP3) = false, 'R1.20 · el auxiliar solo responde por el propio llamador');
  perform tests.act_as(dA);
  perform tests.ok(not public._cx0c_venta_pos_propia(oP1), 'R1.21 · un doctor no obtiene nada del auxiliar');
  perform tests.act_as(v_admin);
  perform tests.ok((select count(*) from public.orders where id in (oA, oP1, oP2, oP3, oV, oHist)) = 6, 'F8 · Dirección ve todo');
  -- cambio posterior de cartera: el pedido conserva su atribución y su visibilidad
  perform tests.act_as_service(); update public.cc_cartera set seller_profile_id = v_s3 where profile_id = dA; perform tests.act_as_owner();
  perform tests.eq((select shipping_meta ->> 'seller_profile_id' from public.orders where id = oA), v_s1::text, 'F9 · cambio de cartera no reescribe pedidos existentes');
  perform set_config('request.jwt.claims', json_build_object('sub', v_s3, 'role', 'authenticated', 'email', 'otro3@test.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.ok((select count(*) from public.orders where id = oA) = 0, 'F9 · el nuevo vendedor no hereda la visibilidad de pedidos anteriores (congelados)');
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from public.orders where shipping_meta ->> 'seller_profile_id' = v_sx::text), 'G · nunca se atribuyó a un vendedor dado de baja');
end $t$;
rollback;
