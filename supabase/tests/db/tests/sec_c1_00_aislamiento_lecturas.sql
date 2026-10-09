-- SEC-C1 · Para POS, lo que se ve de una tabla hija o de una RPC nunca excede lo que se ve del pedido en orders.
-- Equivalencia: POS_VE_ESTADO(pedido) ⇔ POS_VE_PEDIDO(pedido) para cada ruta de visibilidad (cartera, correo heredado,
-- meta.owner, venta de mostrador propia) y cada ruta que NO da visibilidad (capturista, histórico Odoo, ajeno).
-- Cortes y arqueo: POS solo su corte de cajero. Dirección, Facturación, Almacén, Empaque, doctor y service_role intactos.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing');
  posA uuid := tests.user('pos', 'c1-posa@t.local'); posB uuid := tests.user('pos', 'c1-posb@t.local'); posC uuid := tests.user('pos', 'c1-posc@t.local');
  v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing'); v_drv uuid := tests.user('driver');
  dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); dC uuid := tests.user('doctor'); dH uuid := tests.user('doctor');
  v_nadie uuid := gen_random_uuid(); v_hoy date := public.hoy_local();
  p uuid := tests.product(100); lot uuid; cA uuid; cB uuid; cH uuid;
  oA uuid; oA2 uuid; oB uuid; oC uuid; oLeg uuid; oSaleA uuid; oSaleB uuid; oCapt uuid; oHist uuid; oCanc uuid;
  todos uuid[]; o uuid; rol text; u uuid; e1 text; e2 text; n int; ok_rls boolean; ok_helper boolean; ok_din boolean; ok_fis boolean;
  ve_esperado jsonb; r jsonb;
  linea jsonb := null;
begin
  -- ══ ESCENARIO ════════════════════════════════════════════════════════════════════════════════
  perform tests.act_as_service();
  cA := tests.cliente(dA); cB := tests.cliente(dB);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, posA);                              -- cartera VALIDADA de posA
  update public.profiles set meta = coalesce(meta, '{}') || '{"owner":"c1-posc@t.local"}' where id = dC;        -- ruta heredada meta.owner → posC
  insert into public.customers (full_name, phone, seller_name, source, profile_id) values ('Histórico', '5550001111', 'c1-posa', 'odoo', dH) returning id into cH;
  perform tests.act_as_owner();
  lot := tests.stock(p, 'C1', 80);
  linea := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1));
  perform tests.act_as(v_admin);
  oA    := (public.crear_pedido(gen_random_uuid(), null, dA, linea, null, false, cA) ->> 'order_id')::uuid;   -- vendedor = posA (cartera)
  oA2   := (public.crear_pedido(gen_random_uuid(), null, dA, linea, null, false, cA) ->> 'order_id')::uuid;
  oCanc := (public.crear_pedido(gen_random_uuid(), null, dA, linea, null, false, cA) ->> 'order_id')::uuid;
  oB    := (public.crear_pedido(gen_random_uuid(), null, dB, linea, null, false, cB) ->> 'order_id')::uuid;   -- ajeno
  perform public.cancelar_pedido(gen_random_uuid(), oCanc, 'prueba');
  perform tests.act_as(posA);
  oCapt := (public.crear_pedido(gen_random_uuid(), null, dB, linea, null, false, cB) ->> 'order_id')::uuid;  -- posA CAPTURA, no es vendedor
  perform tests.act_as_owner();
  oC    := tests.order(dC, 'pending_payment', linea);                                                         -- meta.owner → posC
  oLeg  := tests.order(dB, 'pending_payment', linea, 'pending', '{"seller":"c1-posa@t.local"}'::jsonb);       -- vendedor heredado por correo
  oHist := tests.order(dH, 'pending_payment', linea, 'pending', jsonb_build_object('customer', jsonb_build_object('id', cH)));  -- Odoo dice "c1-posa": no autoriza
  oSaleA := tests.venta_pos(posA, 100); oSaleB := tests.venta_pos(posB, 100);
  todos := array[oA, oA2, oCanc, oB, oCapt, oC, oLeg, oHist, oSaleA, oSaleB];
  -- dinero: cobros, una declaración por pedido, reembolsos, cortes
  perform tests.act_as(v_bill);
  perform public.registrar_cobro(gen_random_uuid(), oA, 'transferencia', 100);
  perform public.registrar_cobro(gen_random_uuid(), oB, 'transferencia', 100);
  perform public.autorizar_reembolso(gen_random_uuid(), oA, 'correccion', 5, 'ajuste');
  perform public.autorizar_reembolso(gen_random_uuid(), oB, 'correccion', 5, 'ajuste');
  perform tests.act_as(dA); perform public.reportar_pago(gen_random_uuid(), oA2, 'transferencia', 100, 'REF-A2');
  perform tests.act_as(dB); perform public.reportar_pago(gen_random_uuid(), oCapt, 'transferencia', 100, 'REF-CAPT');
  perform tests.act_as(posA); perform public.registrar_corte_caja(gen_random_uuid(), v_hoy, 'cajero', 0, 100, null, posA);
  perform tests.act_as(posB); perform public.registrar_corte_caja(gen_random_uuid(), v_hoy, 'cajero', 0, 100, null, posB);
  perform tests.act_as(v_bill); perform public.registrar_corte_caja(gen_random_uuid(), v_hoy, 'dia', 0, 0, 'arqueo', null);
  perform tests.surtir(oA); perform tests.surtir(oB);                                                         -- movimientos de surtido con order_id
  perform tests.act_as_owner();

  -- ══ FORMA ════════════════════════════════════════════════════════════════════════════════════
  perform tests.ok((select string_agg(tablename || '=' || md5(qual), ',' order by tablename) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
                    and tablename in ('order_items','payment_entries','payment_claims','refunds','cash_closings','inventory_movements','orders'))
    = 'cash_closings=f07a46d9d9ceca9490b7a227394ca50a,inventory_movements=a57e5032292211476a5a2c9f88c3cf60,order_items=ade972101e92ee55948b004d0d03cfe3,'
      'orders=457f39b6ea229576071c7c7f4f4a389d,payment_claims=6355714e576fcd50cdd9bc3a52810b05,payment_entries=172b94d73fdb6f9d4374e9d6dcb0d07e,refunds=a3783ee439bf98656dd35f22b74dc246',
    'G1 · políticas SEC-C1 instaladas y orders_select_scoped intacta');
  perform tests.ok((select string_agg(proname || '=' || md5(pg_get_functiondef(oid)), ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace
                    and proname in ('estado_dinero_pedido','estado_fiscal_pedido','efectivo_esperado','tramo_corte_caja','_sec_c1_pos_ve_pedido','_sec_c1_ve_pedido','_sec_c1_pos_ve_movimiento'))
    = '_sec_c1_pos_ve_movimiento=14b0f521726efff2be278ccfee165ea6,_sec_c1_pos_ve_pedido=88173057fc46e7dd94f986aab64c23ca,_sec_c1_ve_pedido=7a0a76e0ff4969dff47c5a30c6efee64,efectivo_esperado=85db31cc72539b1097166d272887dccc,estado_dinero_pedido=7744d815fd05b6d654e6076f9c530b62,'
      'estado_fiscal_pedido=3ea41141a787035a653988d0ca66ccba,tramo_corte_caja=fe2088f04d3b6e4d0136a0e084cb06b6', 'G2 · funciones SEC-C1 instaladas');
  perform tests.ok(not has_function_privilege('authenticated', 'public._sec_c1_pos_ve_pedido(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public._sec_c1_pos_ve_pedido(uuid)', 'EXECUTE')
               and not has_function_privilege('service_role', 'public._sec_c1_pos_ve_pedido(uuid)', 'EXECUTE'), 'G3 · el helper interno no se expone por la API');
  perform tests.ok(not has_function_privilege('anon', 'public._sec_c1_ve_pedido(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public._sec_c1_pos_ve_movimiento(uuid)', 'EXECUTE')
               and (select provolatile = 's' and not prosecdef from pg_proc where oid = 'public._sec_c1_ve_pedido(uuid)'::regprocedure)
               and not exists (select 1 from pg_depend d where d.refobjid in ('public.pedido_visible(uuid)'::regprocedure) and d.classid = 'pg_policy'::regclass),
    'G3b · helpers de política: invoker / sin anon, y ninguna política depende de pedido_visible (rollback CC-0A)');
  perform tests.ok((select string_agg(proname || '=' || md5(pg_get_functiondef(oid)), ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace
                    and proname in ('pedido_visible','_cx0c_venta_pos_propia','order_vendor_email','vender_pos','crear_pedido','registrar_cobro','reportar_pago','registrar_corte_caja'))
    = '_cx0c_venta_pos_propia=d367994ba8540919115663de4605825a,crear_pedido=bee5aa3614e2b9e0327ebec6a1b38e2e,order_vendor_email=58a350df9c9582768d78a0ec1de00dde,'
      'pedido_visible=dd2c4bfe38132e221e0860ecc77e2020,registrar_cobro=0283a2987642a72f1fca89d6691e3c71,registrar_corte_caja=818494eef08f5fa91ac06e649541be41,'
      'reportar_pago=a41ef8615e80f0834c2e6b48e75d4004,vender_pos=9ae71e2fbe55825514202b99d4bec03b', 'G4 · dependencias y escrituras (CX-0c, SEC-A, SEC-B) intactas');

  -- ══ EQUIVALENCIA · POS_VE_ESTADO ⇔ POS_VE_PEDIDO (positivos y negativos) ═════════════════════
  ve_esperado := jsonb_build_object('posA', jsonb_build_array(oA, oA2, oCanc, oLeg, oSaleA), 'posB', jsonb_build_array(oSaleB), 'posC', jsonb_build_array(oC));
  foreach rol in array array['posA','posB','posC'] loop
    u := case rol when 'posA' then posA when 'posB' then posB else posC end;
    foreach o in array todos loop
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', (select email from public.profiles where id = u))::text, true);
      perform set_config('role', 'authenticated', true);
      ok_rls := exists (select 1 from public.orders where id = o);
      begin perform public.estado_dinero_pedido(o); ok_din := true; exception when others then ok_din := false; end;
      begin perform public.estado_fiscal_pedido(o); ok_fis := true; exception when others then ok_fis := false; end;
      perform set_config('role', 'postgres', true);                                    -- el helper corre como dueño (igual que dentro de las RPC)
      ok_helper := public._sec_c1_pos_ve_pedido(o);
      perform tests.ok(ok_rls = (ve_esperado -> rol) ? o::text and ok_helper = ok_rls and ok_din = ok_rls and ok_fis = ok_rls,
        format('E · %s / %s: orders=%s helper=%s dinero=%s fiscal=%s', rol,
               case o when oA then 'cartera' when oA2 then 'cartera2' when oCanc then 'cartera cancelado' when oB then 'ajeno' when oCapt then 'capturista≠vendedor'
                      when oC then 'meta.owner' when oLeg then 'correo heredado' when oHist then 'histórico Odoo' when oSaleA then 'venta mostrador A' else 'venta mostrador B' end,
               ok_rls, ok_helper, ok_din, ok_fis));
    end loop;
  end loop;
  perform tests.act_as_owner();

  -- ══ NEGATIVAS · POS A sobre lo ajeno (tablas hijas) ══════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', posA, 'role', 'authenticated', 'email', 'c1-posa@t.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.eq((select count(*)::int from public.order_items where order_id in (oB, oCapt, oC, oHist, oSaleB)), 0, 'N1 · POS A no ve partidas de pedidos ajenos (ni capturados, ni Odoo, ni de POS B)');
  perform tests.eq((select count(*)::int from public.order_items where order_id not in (select id from public.orders)), 0, 'N1b · ninguna partida visible sin su pedido visible');
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = any (array[oB, oSaleB])), 0, 'N2 · POS A no ve asientos ajenos (ni el efectivo de POS B)');
  perform tests.eq((select count(*)::int from public.payment_entries where order_id not in (select id from public.orders)), 0, 'N2b · ningún asiento visible sin su pedido visible');
  perform tests.eq((select count(*)::int from public.payment_claims where order_id = oCapt), 0, 'N3 · POS A no ve la declaración del pedido que solo capturó');
  perform tests.eq((select count(*)::int from public.payment_claims where order_id not in (select id from public.orders)), 0, 'N3b · ninguna declaración visible sin su pedido visible');
  perform tests.eq((select count(*)::int from public.refunds), 0, 'N4 · POS no lee reembolsos (ni de su cartera: ninguna pantalla los usa)');
  perform tests.eq((select count(*)::int from public.cash_closings where cajero is distinct from posA), 0, 'N5 · POS A no ve cortes de POS B ni el del día');
  perform tests.eq((select count(*)::int from public.inventory_movements where order_id is null or order_id not in (select id from public.orders)), 0,
    'N6 · POS A no ve movimientos ajenos ni de recepción');
  -- arqueo
  perform tests.throws(format('select public.efectivo_esperado(%L, ''cajero'', %L)', v_hoy, posB), 'solo puedes consultar tu propio corte', 'N7 · arqueo de POS B: rechazado');
  perform tests.throws(format('select public.efectivo_esperado(%L, ''dia'', null)', v_hoy), 'solo puedes consultar tu propio corte', 'N7b · arqueo del día: rechazado');
  perform tests.throws(format('select public.efectivo_esperado(%L)', v_hoy), 'solo puedes consultar tu propio corte', 'N7c · alcance por omisión (día): rechazado');
  perform tests.throws(format('select public.efectivo_esperado(%L, ''cajero'', null)', v_hoy), 'solo puedes consultar tu propio corte', 'N7d · cajero NULL: rechazado');
  perform tests.throws(format('select public.efectivo_esperado(%L, ''CAJERO'', %L)', v_hoy, posA), 'solo puedes consultar tu propio corte', 'N7e · alcance con otra capitalización: rechazado');
  perform tests.throws(format('select public.tramo_corte_caja(%L, ''cajero'', %L)', v_hoy, posB), 'solo puedes consultar tu propio corte', 'N8 · tramo de POS B: rechazado');
  perform tests.throws(format('select public.tramo_corte_caja(%L, ''dia'', null)', v_hoy), 'solo puedes consultar tu propio corte', 'N8b · tramo del día: rechazado');
  -- mismo error para ajeno e inexistente
  begin perform public.estado_dinero_pedido(oB); exception when others then e1 := sqlerrm; end;
  begin perform public.estado_dinero_pedido(gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  perform tests.ok(e1 = 'NO_AUTORIZADO' and e1 = e2, 'N9 · estado_dinero_pedido: ajeno e inexistente indistinguibles para POS');
  begin perform public.estado_fiscal_pedido(oB); exception when others then e1 := sqlerrm; end;
  begin perform public.estado_fiscal_pedido(gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  perform tests.ok(e1 like 'NO_AUTORIZADO%' and e1 = e2, 'N9b · estado_fiscal_pedido: ajeno e inexistente indistinguibles para POS');
  -- F3-J: ya no se reconstruye un pedido ajeno
  perform tests.eq((select count(*)::int from public.order_items i join public.payment_claims c on c.order_id = i.order_id where i.order_id = oCapt), 0,
    'N10 · F3-J cerrado: partidas + declaración de un pedido ajeno no se pueden unir');
  -- positivos de POS A sobre lo propio
  perform tests.ok((select count(*) from public.order_items where order_id in (oA, oA2, oCanc, oLeg, oSaleA)) = 5, 'P1 · POS A ve las partidas de su cartera, su cancelado, su heredado y su venta');
  perform tests.ok((select count(*) from public.payment_entries where order_id = oA) = 1 and (select count(*) from public.payment_entries where order_id = oSaleA) = 1,
    'P2 · POS A ve los asientos de sus pedidos (incluido el efectivo de su venta)');
  perform tests.eq((select count(*)::int from public.payment_claims where order_id = oA2), 1, 'P3 · POS A ve la declaración de un pedido de su cartera (Bandeja)');
  perform tests.ok((select count(*) = 1 and bool_and(cajero = posA) from public.cash_closings), 'P4 · POS A ve SU corte');
  perform tests.ok((select count(*) from public.inventory_movements where order_id in (oA, oSaleA)) >= 2, 'P5 · POS A ve los movimientos de sus pedidos');
  perform tests.eq(public.efectivo_esperado(v_hoy, 'cajero', posA), 0::numeric, 'P6 · POS A arquea su propio corte (tramo siguiente = 0, no recuenta)');
  perform tests.ok((public.tramo_corte_caja(v_hoy, 'cajero', posA) ->> 'primer_corte')::boolean = false, 'P6b · POS A consulta el tramo de su cadena');
  perform tests.ok((public.estado_dinero_pedido(oA) ->> 'order_id')::uuid = oA, 'P7 · POS A consulta el estado de dinero de su pedido');
  perform set_config('role', 'postgres', true);

  -- ══ OTROS ACTORES ════════════════════════════════════════════════════════════════════════════
  foreach rol in array array['admin','billing'] loop
    perform tests.act_as(case rol when 'admin' then v_admin else v_bill end);
    perform tests.ok((select count(*) from public.order_items where order_id = any (todos)) = 10 and (select count(*) from public.payment_entries) >= 4
                 and (select count(*) from public.payment_claims) = 2 and (select count(*) from public.refunds) = 2 and (select count(*) from public.cash_closings) = 3,
      'P8 · ' || rol || ' conserva partidas, asientos, declaraciones, reembolsos y todos los cortes');
    perform tests.ok(public.efectivo_esperado(v_hoy, 'dia', null) >= 0 and public.efectivo_esperado(v_hoy, 'cajero', posB) >= 0
                 and (public.tramo_corte_caja(v_hoy, 'cajero', posB) ? 'desde') and (public.estado_dinero_pedido(oB) ? 'order_id')
                 and (public.estado_fiscal_pedido(oB) ? 'status'), 'P8b · ' || rol || ' conserva arqueo global, por cajero y estados de cualquier pedido');
    perform tests.throws(format('select public.estado_dinero_pedido(%L)', gen_random_uuid()), 'PEDIDO_INEXISTENTE', 'P8c · ' || rol || ' distingue inexistente (visibilidad global)');
  end loop;
  foreach rol in array array['warehouse','packing'] loop
    perform tests.act_as(case rol when 'warehouse' then v_wh else v_pk end);
    perform tests.ok((select count(*) from public.order_items where order_id = any (todos)) = 10 and (select count(*) from public.inventory_movements where order_id in (oA, oB)) >= 2
                 and (public.estado_dinero_pedido(oB) ? 'order_id'), 'P9 · ' || rol || ' conserva partidas, movimientos y estado de dinero para surtir');
    perform tests.ok((select count(*) from public.payment_entries) = 0 and (select count(*) from public.refunds) = 0 and (select count(*) from public.cash_closings) = 0,
      'P9b · ' || rol || ' sigue sin finanzas (como antes)');
  end loop;
  perform tests.act_as(dA);
  perform tests.ok((select count(*) from public.order_items where order_id in (oA, oA2, oCanc)) = 3 and (select count(*) from public.payment_claims where order_id = oA2) = 1
               and (select count(*) from public.order_items where order_id = oB) = 0 and (public.estado_dinero_pedido(oA) ? 'order_id'),
    'P10 · el doctor ve lo suyo (partidas, su declaración, su estado) y no lo ajeno');
  begin perform public.estado_dinero_pedido(oB); exception when others then e1 := sqlerrm; end;
  begin perform public.estado_dinero_pedido(gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  perform tests.ok(e1 = 'NO_AUTORIZADO' and e1 = e2, 'N11 · doctor: pedido ajeno e inexistente indistinguibles');
  perform tests.act_as(v_drv);
  perform tests.ok((select count(*) from public.order_items) = 0 and (select count(*) from public.payment_entries) = 0 and (select count(*) from public.inventory_movements) = 0,
    'N12 · chofer sin partidas, dinero ni movimientos (como antes)');
  perform tests.act_as(v_nadie);
  perform tests.ok((select count(*) from public.order_items) + (select count(*) from public.payment_entries) + (select count(*) from public.payment_claims)
                 + (select count(*) from public.refunds) + (select count(*) from public.cash_closings) + (select count(*) from public.inventory_movements) = 0,
    'N13 · autenticado sin perfil: nada');
  perform tests.throws(format('select public.estado_dinero_pedido(%L)', oA), 'NO_AUTORIZADO', 'N13b · sin perfil: estado de dinero rechazado');
  perform tests.throws(format('select public.efectivo_esperado(%L, ''cajero'', %L)', v_hoy, v_nadie), 'NO_AUTORIZADO', 'N13c · sin perfil: arqueo rechazado');
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.order_items', 'permission denied', 'N14 · anon sin acceso a partidas');
  perform tests.throws(format('select public.estado_dinero_pedido(%L)', oA), 'permission denied', 'N14b · anon sin EXECUTE');
  perform tests.throws(format('select public._sec_c1_pos_ve_pedido(%L)', oA), 'permission denied', 'N14c · anon no llama al helper');
  perform set_config('request.jwt.claims', json_build_object('sub', posA, 'role', 'authenticated', 'email', 'c1-posa@t.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.throws(format('select public._sec_c1_pos_ve_pedido(%L)', oA), 'permission denied', 'N14d · ni un POS llama al helper por la API (no es un oráculo)');
  perform tests.act_as_service();
  perform tests.ok((select count(*) from public.order_items where order_id = any (todos)) = 10 and (select count(*) from public.refunds) = 2
               and (public.registrar_cobro(gen_random_uuid(), oC, 'stripe', 100, null, 'cs_c1', null, 'pi_c1') ->> 'status') = 'applied',
    'P11 · service_role (webhook Stripe) conserva lectura y cobro');
  perform tests.act_as_owner();
end $t$;
rollback;
