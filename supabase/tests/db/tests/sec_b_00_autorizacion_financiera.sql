-- SEC-B · autorización de escrituras financieras (D-SEC-1, D-SECB-1, D-SECB-2). POS cobra SOLO dentro de vender_pos: no
-- registra cobros, no autoriza reembolsos, no reporta pagos (ni de su cartera) y solo cierra SU corte de cajero. reportar_pago
-- autoriza rol Y pertenencia ANTES de la idempotencia; pedido ajeno e inexistente responden igual. Dirección, Facturación, el
-- webhook (service_role) y el doctor dueño conservan su operación. Un rechazo no deja asiento, declaración, reembolso ni corte.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing');
  v_pos uuid := tests.user('pos', 'secb-pos@t.local'); v_pos2 uuid := tests.user('pos', 'secb-pos2@t.local');
  v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing'); v_drv uuid := tests.user('driver');
  dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); v_nadie uuid := gen_random_uuid();
  p uuid := tests.product(100); cA uuid; oA uuid; oB uuid; oC uuid; oD uuid; oS uuid; oCart uuid; lot uuid;
  v_hoy date := public.hoy_local(); op uuid; op2 uuid; r jsonb; e1 text; e2 text; antes text; despues text; rol text; u uuid;
  linea jsonb; alloc jsonb; n int;
  snap constant text := $q$ select format('%s|%s|%s|%s|%s|%s', (select count(*) from public.payment_entries), (select count(*) from public.payment_claims),
           (select count(*) from public.refunds), (select count(*) from public.cash_closings), (select count(*) from public.money_operations),
           (select md5(string_agg(id::text || coalesce(payment_status, '') || coalesce(status, ''), ',' order by id)) from public.orders)) $q$;
  q_cobro text := 'select public.registrar_cobro(gen_random_uuid(), %L, ''efectivo'', %s)';
  q_reemb text := 'select public.autorizar_reembolso(gen_random_uuid(), %L, ''cortesia'', %s, ''prueba'')';
  q_rep   text := 'select public.reportar_pago(gen_random_uuid(), %L, ''transferencia'', %s, ''REF'')';
  q_corte text := 'select public.registrar_corte_caja(gen_random_uuid(), %L::date, %L, 0, 0, ''x'', %L::uuid)';
begin
  perform tests.act_as_service();
  cA := tests.cliente(dA);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, v_pos);           -- dA es cartera del pos
  perform tests.act_as_owner();
  oA := tests.order(dA, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  oB := tests.order(dB, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  oC := tests.order(dB, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  oD := tests.order(dA, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  oS := tests.order(dB, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  lot := tests.stock(p, 'SECB', 10);
  perform tests.act_as(v_admin);
  oCart := (public.crear_pedido(gen_random_uuid(), null, dA, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), null, false, cA) ->> 'order_id')::uuid;
  perform tests.act_as_owner();
  perform tests.ok((select shipping_meta ->> 'seller_profile_id' = v_pos::text from public.orders where id = oCart), 'fixture · oCart está atribuido al pos (su cartera)');

  -- ══ FORMA Y ALCANCE ══════════════════════════════════════════════════════════════════════════
  perform tests.eq(md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure)), '0283a2987642a72f1fca89d6691e3c71', 'G1 · registrar_cobro = versión SEC-B');
  perform tests.eq(md5(pg_get_functiondef('public.autorizar_reembolso(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)), '11e7492a53d68904573e79bd41a37190', 'G1 · autorizar_reembolso = versión SEC-B');
  perform tests.eq(md5(pg_get_functiondef('public.reportar_pago(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)), 'a41ef8615e80f0834c2e6b48e75d4004', 'G1 · reportar_pago = versión SEC-B');
  perform tests.eq(md5(pg_get_functiondef('public.registrar_corte_caja(uuid,date,text,numeric,numeric,text,uuid)'::regprocedure)), '818494eef08f5fa91ac06e649541be41', 'G1 · registrar_corte_caja = versión SEC-B');
  perform tests.ok((select bool_and(prosecdef and provolatile = 'v' and proconfig = array['search_path=public'] and proowner = 'postgres'::regrole
                                    and has_function_privilege('authenticated', oid, 'EXECUTE') and has_function_privilege('service_role', oid, 'EXECUTE')
                                    and not has_function_privilege('anon', oid, 'EXECUTE'))
                    from pg_proc where oid in ('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure, 'public.autorizar_reembolso(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure,
                                               'public.reportar_pago(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure, 'public.registrar_corte_caja(uuid,date,text,numeric,numeric,text,uuid)'::regprocedure)),
    'G2 · misma forma y permisos (SECURITY DEFINER, VOLATILE, search_path, dueño; authenticated/service_role sí, anon no)');
  perform tests.ok((select string_agg(proname || '=' || md5(pg_get_functiondef(oid)), ',' order by proname) from pg_proc
                    where pronamespace = 'public'::regnamespace and proname in ('revisar_pago','pagar_reembolso','reversar_asiento','vender_pos','crear_pedido','_w2_asiento','_w2_op_begin','orders_guard','anular_corte_caja','efectivo_esperado','tramo_corte_caja'))
               = '_w2_asiento=1ddccce14ab994f77165597df318cca6,_w2_op_begin=7e881d23606587cfd75b21eec6810085,anular_corte_caja=431d07d3cc17a95c9ddf7e62e7a80704,crear_pedido=bee5aa3614e2b9e0327ebec6a1b38e2e,'
                 'efectivo_esperado=8ab12fb796a7e64eb3e7c093e8fb8e90,orders_guard=e88f1bb21a69f79a1d31585cbc75bf7d,pagar_reembolso=ad015dc571cab6e7f58a5754c09fa640,reversar_asiento=ac308403a981da135ff59c031171b974,'
                 'revisar_pago=238145e1eaabc925e64c55aab22cb064,tramo_corte_caja=7559ec6775f850d70f9a797885fa8b19,vender_pos=9ae71e2fbe55825514202b99d4bec03b',
    'G3 · fuera de alcance intacto: vender_pos, crear_pedido, revisar_pago, pagar_reembolso, reversar_asiento, helpers W2, guard y cortes');
  perform tests.eq((select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) from pg_policies
                    where schemaname = 'public' and tablename in ('payment_entries','payment_claims','refunds','cash_closings','orders','money_operations')),
    '7e0dff2ac0fb0839b52f02acaf324afc', 'G4 · políticas RLS del dinero y de orders intactas');

  -- ══ NEGATIVAS · POS (sin residuos) ═══════════════════════════════════════════════════════════
  execute snap into antes;
  perform tests.act_as(v_pos);
  perform tests.throws(format(q_cobro, oA, 0.01), 'NO_AUTORIZADO', 'N1 · pos no registra un cobro simbólico sobre pedido ajeno');
  perform tests.throws(format(q_cobro, oB, 100), 'NO_AUTORIZADO', 'N2 · pos no marca como pagado un pedido ajeno (cobro por el total)');
  perform tests.throws(format(q_cobro, oB, 5000), 'NO_AUTORIZADO', 'N3 · pos no registra sobrepagos');
  perform tests.throws(format(q_cobro, oCart, 100), 'NO_AUTORIZADO', 'N4 · pos no cobra ni pedidos de SU cartera (D-SEC-1: solo vender_pos)');
  perform tests.throws(format('select public.registrar_cobro(gen_random_uuid(), %L, ''efectivo'', 100, null, null, null, ''{"role":"service_role"}'')', oB), 'NO_AUTORIZADO', 'N4b · la evidencia del cliente no suplanta al webhook');
  perform tests.throws(format(q_reemb, oA, 50), 'NO_AUTORIZADO', 'N5 · pos no autoriza reembolsos de pedidos ajenos');
  perform tests.throws(format(q_reemb, oCart, 50), 'NO_AUTORIZADO', 'N5b · ni de su cartera');
  perform tests.throws(format(q_rep, oA, 100), 'NO_AUTORIZADO', 'N6 · pos no reporta pagos de pedidos ajenos');
  perform tests.throws(format(q_rep, oCart, 100), 'NO_AUTORIZADO', 'N6b · ni de su cartera (D-SECB-1)');
  perform tests.throws(format(q_rep, gen_random_uuid(), 100), 'NO_AUTORIZADO', 'N6c · ni de un pedido inexistente (mismo error)');
  perform tests.throws(format(q_corte, v_hoy, 'dia', null), 'solo puedes cerrar tu propio corte', 'N7 · pos no cierra el corte global del día');
  perform tests.throws(format(q_corte, v_hoy, 'dia', v_pos), 'solo puedes cerrar tu propio corte', 'N7b · ni el del día aunque mande su propio id');
  perform tests.throws(format(q_corte, v_hoy, 'cajero', v_pos2), 'solo puedes cerrar tu propio corte', 'N8 · pos no cierra el corte de otro cajero');
  perform tests.throws(format(q_corte, v_hoy, 'cajero', v_bill), 'solo puedes cerrar tu propio corte', 'N8b · ni el de Facturación');
  perform tests.throws(format(q_corte, v_hoy, 'cajero', null), 'solo puedes cerrar tu propio corte', 'N9 · cajero NULL rechazado');
  perform tests.throws(format(q_corte, v_hoy, 'CAJERO', v_pos), 'solo puedes cerrar tu propio corte', 'N10 · alcance con otra capitalización rechazado');
  perform tests.throws(format(q_corte, v_hoy, ' cajero', v_pos), 'solo puedes cerrar tu propio corte', 'N10b · alcance con espacios rechazado');
  perform tests.throws(format('select public.registrar_corte_caja(gen_random_uuid(), %L::date, null, 0, 0, ''x'', %L::uuid)', v_hoy, v_pos), 'solo puedes cerrar tu propio corte', 'N10c · alcance NULL rechazado');
  -- escrituras directas
  perform tests.throws(format('insert into public.payment_entries (order_id, direction, method, amount, value_date) values (%L, ''in'', ''efectivo'', 1, current_date)', oB), 'permission denied', 'N11 · pos no inserta asientos');
  perform tests.throws(format('insert into public.payment_claims (order_id, method, amount_declared) values (%L, ''efectivo'', 1)', oB), 'permission denied', 'N11 · pos no inserta declaraciones');
  perform tests.throws(format('insert into public.refunds (order_id, tipo, monto, motivo) values (%L, ''cortesia'', 1, ''x'')', oB), 'permission denied', 'N11 · pos no inserta reembolsos');
  perform tests.throws(format('insert into public.cash_closings (fecha, alcance, esperado, contado, diferencia) values (%L, ''dia'', 0, 0, 0)', v_hoy), 'permission denied', 'N11 · pos no inserta cortes');
  perform tests.throws('select public._w2_asiento(gen_random_uuid(), gen_random_uuid(), ''in'', ''efectivo'', 1, null)', 'permission denied', 'N11 · pos no llama al escritor interno del libro');
  perform tests.throws('select public.pay_order(gen_random_uuid(), ''efectivo'', ''x'')', 'permission denied', 'N11 · pos no llama al pay_order heredado');
  update public.orders set payment_status = 'paid' where id = oB;
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'N11 · pos no actualiza payment_status (sin política de UPDATE)');
  perform tests.act_as_owner();
  execute snap into despues;
  perform tests.eq(despues, antes, 'N · rechazos del pos sin residuos (asientos | declaraciones | reembolsos | cortes | operaciones | estado de pedidos)');

  -- ══ NEGATIVAS · otros actores ════════════════════════════════════════════════════════════════
  execute snap into antes;
  foreach rol in array array['warehouse','packing','driver','sin_perfil'] loop
    u := case rol when 'warehouse' then v_wh when 'packing' then v_pk when 'driver' then v_drv else v_nadie end;
    perform tests.act_as(u);
    perform tests.throws(format(q_cobro, oB, 1), 'NO_AUTORIZADO', 'N12 · ' || rol || ' no registra cobros');
    perform tests.throws(format(q_reemb, oB, 1), 'NO_AUTORIZADO', 'N12 · ' || rol || ' no autoriza reembolsos');
    perform tests.throws(format(q_rep, oB, 1), 'NO_AUTORIZADO', 'N12 · ' || rol || ' no reporta pagos');
    perform tests.throws(format(q_corte, v_hoy, 'cajero', u), 'NO_AUTORIZADO', 'N12 · ' || rol || ' no cierra cortes');
  end loop;
  perform tests.act_as(v_wh);
  perform tests.throws(format('update public.orders set payment_status = ''paid'' where id = %L', oB), 'PAGO_SOLO_POR_COMANDO', 'N13 · almacén no marca pagado editando el pedido');
  perform tests.act_as(dA);
  perform tests.throws(format(q_cobro, oA, 100), 'NO_AUTORIZADO', 'N14 · doctor no registra cobros (ni del suyo)');
  perform tests.throws(format(q_reemb, oA, 1), 'NO_AUTORIZADO', 'N14 · doctor no autoriza reembolsos');
  perform tests.throws(format(q_corte, v_hoy, 'cajero', dA), 'NO_AUTORIZADO', 'N14 · doctor no cierra cortes');
  perform tests.act_as_anon();
  perform tests.throws(format(q_cobro, oB, 1), 'permission denied', 'N15 · anon sin EXECUTE (cobro)');
  perform tests.throws(format(q_reemb, oB, 1), 'permission denied', 'N15 · anon sin EXECUTE (reembolso)');
  perform tests.throws(format(q_rep, oB, 1), 'permission denied', 'N15 · anon sin EXECUTE (reporte)');
  perform tests.throws(format(q_corte, v_hoy, 'dia', null), 'permission denied', 'N15 · anon sin EXECUTE (corte)');
  perform tests.act_as_owner();
  execute snap into despues;
  perform tests.eq(despues, antes, 'N12–N15 · rechazos sin residuos');

  -- ══ NO DIVULGACIÓN · reportar_pago ═══════════════════════════════════════════════════════════
  perform tests.act_as(dB);
  begin perform public.reportar_pago(gen_random_uuid(), oA, 'transferencia', 100, 'REF'); exception when others then e1 := sqlerrm; end;
  begin perform public.reportar_pago(gen_random_uuid(), gen_random_uuid(), 'transferencia', 100, 'REF'); exception when others then e2 := sqlerrm; end;
  perform tests.ok(e1 like 'NO_AUTORIZADO%' and e1 = e2, 'L1 · doctor: pedido ajeno e inexistente dan EXACTAMENTE el mismo error [' || coalesce(e1, '∅') || ']');
  -- el doctor dueño declara (op) y otros actores repiten el MISMO op_id con la MISMA petición
  op := gen_random_uuid();
  perform tests.act_as(dA);
  r := public.reportar_pago(op, oD, 'transferencia', 100, 'REF');
  perform tests.ok(r ->> 'status' = 'applied' and (r ->> 'saldo')::numeric = 100, 'L2 · el doctor dueño reporta su pago');
  perform tests.act_as_owner();
  execute snap into antes;
  foreach rol in array array['doctor_ajeno','pos','sin_perfil','warehouse'] loop
    u := case rol when 'doctor_ajeno' then dB when 'pos' then v_pos when 'sin_perfil' then v_nadie else v_wh end;
    perform tests.act_as(u);
    e1 := null; r := null;
    begin r := public.reportar_pago(op, oD, 'transferencia', 100, 'REF'); exception when others then e1 := sqlerrm; end;
    perform tests.ok(r is null and e1 like 'NO_AUTORIZADO%', 'L3 · ' || rol || ': repetir el op_id ajeno NO devuelve el resultado guardado (sin saldo) [' || coalesce(e1, r::text) || ']');
  end loop;
  perform tests.act_as(dB);
  e1 := null;
  begin perform public.reportar_pago(op, oC, 'transferencia', 100, 'REF'); exception when others then e1 := sqlerrm; end;
  perform tests.ok(e1 like 'OP_ID_REUTILIZADO%' and position(oD::text in e1) = 0 and position('saldo' in lower(e1)) = 0,
    'L4 · op_id ajeno sobre pedido PROPIO: rechazo de idempotencia sin datos del pedido ajeno');
  perform tests.act_as(dA);
  r := public.reportar_pago(op, oD, 'transferencia', 100, 'REF');
  perform tests.eq(r ->> 'status', 'already_applied', 'L5 · el dueño sí conserva su idempotencia (reintento = already_applied)');
  perform tests.act_as(v_bill);
  r := public.reportar_pago(op, oD, 'transferencia', 100, 'REF');
  perform tests.eq(r ->> 'status', 'already_applied', 'L5b · Facturación (autorizada sobre todo pedido) también');
  perform tests.act_as(dA);
  e1 := null;
  begin perform public.reportar_pago(op, oA, 'transferencia', 100, 'REF'); exception when others then e1 := sqlerrm; end;
  perform tests.ok(e1 like 'OP_ID_REUTILIZADO%', 'L6 · mismo op_id sobre OTRO pedido propio: rechazado, no se duplica');
  perform tests.act_as_owner();
  execute snap into despues;
  perform tests.eq(despues, antes, 'L3–L6 · repeticiones sin residuos');
  perform tests.ok((select count(*) = 1 and bool_and(declared_by = dA and status = 'reportado') from public.payment_claims where order_id = oD)
               and (select payment_status = 'pending' from public.orders where id = oD), 'L7 · reportar ≠ cobrar: una declaración en revisión, el pedido sigue sin pagar');

  -- ══ POSITIVAS · POS vende por vender_pos y arquea SU caja ════════════════════════════════════
  linea := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1));
  alloc := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 1));
  op := gen_random_uuid();
  perform tests.act_as(v_pos);
  perform tests.ok(public.vender_pos(op, 'SECB-POS1', 1, 'efectivo', null, '{}', linea, alloc), 'P1 · pos vende por vender_pos');
  perform tests.act_as(v_pos2);
  perform tests.ok(public.vender_pos(gen_random_uuid(), 'SECB-POS2', 1, 'efectivo', null, '{}', linea, alloc), 'P1b · otro pos vende por vender_pos');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 and bool_and(e.recorded_by = v_pos and e.actor_role = 'pos' and e.method = 'efectivo' and e.amount = 100 and e.direction = 'in')
                    from public.payment_entries e where e.order_id = op), 'P2 · la venta POS genera SU asiento (efectivo 100, recorded_by = el cajero)');
  perform tests.ok((select payment_status = 'paid' from public.orders where id = op), 'P2b · y queda pagada por el servidor');
  perform tests.act_as(v_admin);
  perform tests.eq(public.efectivo_esperado(v_hoy, 'cajero', v_pos), 100::numeric, 'P3 · el asiento aparece en el arqueo de SU cajero');
  perform tests.eq(public.efectivo_esperado(v_hoy, 'cajero', v_pos2), 100::numeric, 'P3b · y el del otro cajero en el suyo');
  -- corte propio
  op := gen_random_uuid();
  perform tests.act_as(v_pos);
  r := public.registrar_corte_caja(op, v_hoy, 'cajero', 0, 100, null, v_pos);
  perform tests.ok(r ->> 'status' = 'applied' and (r ->> 'esperado')::numeric = 100 and (r ->> 'diferencia')::numeric = 0, 'P4 · pos cierra SU corte de cajero (esperado 100 del servidor)');
  perform tests.eq(public.registrar_corte_caja(op, v_hoy, 'cajero', 0, 100, null, v_pos) ->> 'status', 'already_applied', 'P5 · idempotencia legítima del corte propio');
  r := public.registrar_corte_caja(gen_random_uuid(), v_hoy, 'cajero', 0, 0, null, v_pos);
  perform tests.ok(r ->> 'status' = 'applied' and (r ->> 'esperado')::numeric = 0, 'P6 · corte propio repetido: el tramo siguiente no recuenta el efectivo ya arqueado');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 2 and bool_and(cajero = v_pos and created_by = v_pos and alcance = 'cajero') from public.cash_closings where cajero = v_pos or created_by = v_pos),
    'P7 · los cortes del pos son de SU cadena (cajero = él, alcance cajero)');
  perform tests.act_as(v_admin);
  perform tests.eq(public.efectivo_esperado(v_hoy, 'cajero', v_pos2), 100::numeric, 'P8 · aislamiento: el arqueo del otro cajero sigue intacto');
  perform tests.eq(public.efectivo_esperado(v_hoy, 'dia', null), 200::numeric, 'P8b · aislamiento: el corte del día sigue intacto (no lo avanzó el pos)');
  -- un pos no recupera por idempotencia el corte de otro: Facturación cierra el de pos2 y el pos repite ese op_id
  op2 := gen_random_uuid();
  perform tests.act_as(v_bill);
  r := public.registrar_corte_caja(op2, v_hoy, 'cajero', 0, 100, null, v_pos2);
  perform tests.ok(r ->> 'status' = 'applied' and (r ->> 'esperado')::numeric = 100, 'P9 · Facturación cierra el corte de otro cajero (permiso intacto)');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.registrar_corte_caja(%L, %L::date, ''cajero'', 0, 100, null, %L::uuid)', op2, v_hoy, v_pos2), 'solo puedes cerrar tu propio corte',
    'L8 · pos no obtiene por idempotencia el corte ajeno (rechazo antes del resultado guardado)');
  perform tests.act_as(v_admin);
  r := public.registrar_corte_caja(gen_random_uuid(), v_hoy, 'dia', 0, 200, null, null);
  perform tests.ok(r ->> 'status' = 'applied' and (r ->> 'esperado')::numeric = 200, 'P10 · Dirección cierra el corte del día (permiso intacto)');

  -- ══ POSITIVAS · Facturación, Dirección, webhook, doctor ══════════════════════════════════════
  perform tests.act_as(v_bill);
  op := gen_random_uuid();
  r := public.registrar_cobro(op, oA, 'transferencia', 100);
  perform tests.ok(r ->> 'status' = 'applied' and r ->> 'payment_status' = 'paid', 'P11 · Facturación registra un cobro (pedido pagado)');
  perform tests.eq(public.registrar_cobro(op, oA, 'transferencia', 100) ->> 'status', 'already_applied', 'P12 · idempotencia legítima del cobro');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 and bool_and(recorded_by = v_bill and actor_role = 'billing') from public.payment_entries where order_id = oA), 'P12b · UN asiento, trazado al actor');
  perform tests.act_as(v_admin);
  perform tests.eq(public.registrar_cobro(gen_random_uuid(), oB, 'efectivo', 10) ->> 'payment_status', 'parcial', 'P13 · Dirección registra un cobro parcial');
  perform tests.act_as(v_bill);
  perform tests.eq(public.autorizar_reembolso(gen_random_uuid(), oA, 'correccion', 10, 'ajuste') ->> 'status', 'applied', 'P14 · Facturación autoriza un reembolso');
  perform tests.act_as(v_admin);
  perform tests.eq(public.autorizar_reembolso(gen_random_uuid(), oA, 'cortesia', 5, 'cortesía') ->> 'status', 'applied', 'P14b · Dirección autoriza un reembolso');
  perform tests.eq(public.reportar_pago(gen_random_uuid(), oC, 'transferencia', 100, 'REF-DIR') ->> 'status', 'applied', 'P15 · Dirección reporta un pago');
  perform tests.act_as(v_bill);
  perform tests.eq(public.reportar_pago(gen_random_uuid(), oS, 'transferencia', 100, 'REF-FAC') ->> 'status', 'applied', 'P15b · Facturación reporta un pago');
  perform tests.act_as_service();
  oS := null;
  perform tests.act_as_owner();
  oS := tests.order(dB, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  perform tests.act_as_service();
  r := public.registrar_cobro(gen_random_uuid(), oS, 'stripe', 100, null, 'cs_test_secb', null, 'pi_test_secb');
  perform tests.ok(r ->> 'status' = 'applied' and r ->> 'payment_status' = 'paid', 'P16 · el webhook (service_role) sigue registrando el cobro de Stripe');
  perform tests.act_as_owner();
  perform tests.ok((select bool_and(actor_role = 'service_role' and method = 'stripe') from public.payment_entries where order_id = oS), 'P16b · trazado como service_role');
  perform tests.act_as(dB);
  perform tests.eq(public.reportar_pago(gen_random_uuid(), oB, 'transferencia', 90, 'REF-DOC') ->> 'status', 'applied', 'P17 · el doctor dueño reporta el saldo de su pedido');
  perform tests.act_as_owner();
end $t$;
rollback;
