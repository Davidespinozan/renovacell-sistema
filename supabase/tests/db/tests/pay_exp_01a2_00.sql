-- PAY-EXP-01A-2 (134) · revision_economica: un caso por pedido, incidencias con entrada/salida verificables, montos de
-- v_order_money, resolución solo con evidencia, permisos (Dirección/Facturación) y cero efectos secundarios.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse');
  v_doc uuid := tests.user('doctor'); v_p uuid := tests.product();
  oSin uuid; oTarde uuid; oDecl uuid; oVerif uuid; oRech uuid; oParcial uuid; oDevol uuid; oStripe uuid; oPend uuid; oNormal uuid; oVigDecl uuid; oAutTotal uuid;
  c uuid; cV uuid; cR uuid; r jsonb; k jsonb; ref1 uuid; ref2 uuid; antes jsonb; despues jsonb; n int;
begin
  perform tests.stock(v_p, 'P1A2', 500);
  oSin     := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));   -- 100
  oTarde   := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));   -- 100
  oDecl    := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));   -- 200
  oVerif   := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));   -- 200
  oRech    := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));   -- 200
  oParcial := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));   -- 200
  oDevol   := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));   -- 200
  oStripe  := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));   -- 100
  oPend    := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));   -- 100
  oVigDecl := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));   -- vigente con declaración abierta
  oAutTotal:= tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));   -- cancelado, reembolso total autorizado sin pagar
  oNormal  := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));   -- 100 (sin incidencia)

  -- Escenarios
  perform tests.act_as(v_doc);
  perform public.cancelar_pedido(tests.op(), oSin, null);                                                     -- cancelado sin dinero
  perform public.cancelar_pedido(tests.op(), oTarde, null);
  perform tests.act_as(v_admin);
  perform public.registrar_cobro(tests.op(), oTarde, 'transferencia', 100, null, 'SPEI-TARDIO');               -- pago tardío (F-9)
  perform tests.act_as(v_doc);
  perform public.reportar_pago(tests.op(), oDecl, 'transferencia', 200, 'D-1');
  cV := (public.reportar_pago(tests.op(), oVerif, 'transferencia', 200, 'V-1') ->> 'claim_id')::uuid;
  cR := (public.reportar_pago(tests.op(), oRech, 'transferencia', 200, 'R-1') ->> 'claim_id')::uuid;
  perform tests.act_as(v_admin);
  perform public.cancelar_pedido(tests.op(), oDecl, 'cliente desistió');                                     -- declaración abierta en cancelado
  perform public.cancelar_pedido(tests.op(), oVerif, 'cliente desistió');
  perform public.cancelar_pedido(tests.op(), oRech, 'cliente desistió');
  perform tests.act_as(v_bill);
  perform public.revisar_pago(tests.op(), cV, 'verificar');                                 -- verificada tras cancelar → dinero
  perform public.revisar_pago(tests.op(), cR, 'rechazar', null, null, 'no llegó');          -- rechazada → resuelto
  perform tests.act_as(v_admin);
  perform public.registrar_cobro(tests.op(), oParcial, 'transferencia', 200, null, 'SPEI-P');                -- cobrado antes de cancelar
  perform public.cancelar_pedido(tests.op(), oParcial, 'error de captura');
  ref1 := (public.autorizar_reembolso(tests.op(), oParcial, 'correccion', 120, 'devolver parte') ->> 'refund_id')::uuid;   -- 120 autorizado, 80 sin autorizar
  perform public.registrar_cobro(tests.op(), oDevol, 'transferencia', 200, null, 'SPEI-D');                  -- pedido NO cancelado con devolución
  ref2 := (public.autorizar_reembolso(tests.op(), oDevol, 'devolucion', 50, 'producto dañado') ->> 'refund_id')::uuid;
  perform tests.act_as_service();
  update public.orders set stripe_payment_id = 'cs_test_sin_libro' where id = oStripe;                     -- señal Stripe sin dinero en el libro
  perform tests.act_as(v_admin);
  perform public.cancelar_pedido(tests.op(), oStripe, 'cliente desistió');
  perform public.registrar_cobro(tests.op(), oPend, 'transferencia', 100, null, 'SPEI-PEND');                -- cobrado y cancelado: luego se devuelve todo
  perform public.cancelar_pedido(tests.op(), oPend, 'cliente desistió');
  c := (public.autorizar_reembolso(tests.op(), oPend, 'correccion', 100, 'devolución total') ->> 'refund_id')::uuid;
  perform public.pagar_reembolso(tests.op(), c, 'transferencia', null, 'SPEI-DEV', null);

  perform tests.act_as(v_doc);
  perform public.reportar_pago(tests.op(), oVigDecl, 'transferencia', 100, 'VIG-1');
  perform tests.act_as(v_admin);
  perform public.registrar_cobro(tests.op(), oAutTotal, 'transferencia', 100, null, 'SPEI-AT');
  perform public.cancelar_pedido(tests.op(), oAutTotal, 'cliente desistió');
  perform public.autorizar_reembolso(tests.op(), oAutTotal, 'correccion', 100, 'devolución total');

  -- Instantánea para "sin efectos secundarios"
  perform tests.act_as_service();
  antes := jsonb_build_object('o', (select count(*) from public.orders), 'c', (select count(*) from public.payment_claims), 'e', (select count(*) from public.payment_entries),
                              'r', (select count(*) from public.refunds), 'x', (select count(*) from public.order_cancellations), 'm', (select count(*) from public.money_operations),
                              'cs', (select string_agg(id::text || status, ',' order by id) from public.payment_claims));

  perform tests.act_as(v_bill);
  r := public.revision_economica();
  -- ══ 1 · cancelado sin dinero y pedido normal: no son casos ══
  perform tests.ok(not exists (select 1 from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid in (oSin, oNormal, oVigDecl)), '1 · cancelado sin dinero, pedido normal y declaración en pedido VIGENTE fuera (eso es Pagos por validar)');
  k := (select x from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oAutTotal);
  perform tests.eq(k -> 'incidencias', '["reembolso_autorizado_pendiente"]'::jsonb, '1b · reembolso total autorizado sin pagar: solo pendiente de pago (no "sin autorizar")');
  -- ══ 2 · pago tardío sobre cancelado → dinero_sin_reembolso_autorizado (100) ══
  k := (select x from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oTarde);
  perform tests.eq(k ->> 'incidencia_principal', 'dinero_sin_reembolso_autorizado', '2 · pago tardío');
  perform tests.eq((k -> 'montos' ->> 'sin_reembolso_autorizado')::numeric, 100::numeric, '2 · monto 100');
  perform tests.eq(k -> 'cancelacion' ->> 'refund_review', 'no_aplica', '2 · cancelado antes del dinero (no_aplica) y aun así aparece por el dinero');
  -- ══ 3 · declaración abierta en cancelado ══
  k := (select x from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oDecl);
  perform tests.eq(k -> 'incidencias', '["declaracion_abierta_en_cancelado"]'::jsonb, '3 · solo la declaración abierta');
  perform tests.eq(k -> 'declaraciones' -> 0 ->> 'estado', 'reportado', '3 · evidencia: declaración reportada');
  -- ══ 4 · verificada tras cancelar: sale de "declaración", entra "dinero" (200) ══
  k := (select x from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oVerif);
  perform tests.eq(k -> 'incidencias', '["dinero_sin_reembolso_autorizado"]'::jsonb, '4 · verificada → dinero sin reembolso');
  perform tests.eq(jsonb_array_length(k -> 'asientos'), 1, '4 · evidencia: un asiento');
  -- ══ 5 · rechazada tras cancelar: sin incidencias → no está entre los abiertos; sí como resuelto con evidencia ══
  perform tests.ok(not exists (select 1 from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oRech), '5 · rechazada: no abierta');
  k := (select x from jsonb_array_elements(public.revision_economica(true) -> 'casos') x where (x ->> 'order_id')::uuid = oRech);
  perform tests.eq(k ->> 'estado_caso', 'resuelto', '5 · resuelto con evidencia');
  perform tests.ok(k -> 'evidencia_resolucion' ? 'declaraciones_rechazadas', '5 · evidencia: declaración rechazada');
  -- ══ 6 · varias señales en un pedido: UN caso con dinero (80) + reembolso pendiente (120) ══
  perform tests.eq((select count(*)::int from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oParcial), 1, '6 · un solo caso por pedido');
  k := (select x from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oParcial);
  perform tests.eq(k -> 'incidencias', '["dinero_sin_reembolso_autorizado", "reembolso_autorizado_pendiente"]'::jsonb, '6 · dos incidencias, un caso');
  perform tests.ok((k -> 'montos' ->> 'sin_reembolso_autorizado')::numeric = 80 and (k -> 'montos' ->> 'reembolso_pendiente')::numeric = 120, '6 · 80 sin autorizar + 120 por pagar');
  -- ══ 7 · reembolso autorizado en pedido NO cancelado (devolución) ══
  k := (select x from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oDevol);
  perform tests.eq(k -> 'incidencias', '["reembolso_autorizado_pendiente"]'::jsonb, '7 · solo reembolso pendiente');
  perform tests.ok(k ->> 'estado_pedido' <> 'cancelled' and k -> 'cancelacion' = 'null'::jsonb, '7 · pedido vigente, sin cancelación');
  -- ══ 8 · señal Stripe sin dinero en el libro: no hay evidencia verificable → abierto ══
  k := (select x from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oStripe);
  perform tests.eq(k -> 'incidencias', '["cancelacion_sin_evidencia"]'::jsonb, '8 · Stripe no verificable queda abierto');
  -- ══ 9 · cobrado, cancelado y devuelto por completo (pagado): resuelto con evidencia de reembolso pagado ══
  perform tests.ok(not exists (select 1 from jsonb_array_elements(r -> 'casos') x where (x ->> 'order_id')::uuid = oPend), '9 · devuelto: no abierto');
  k := (select x from jsonb_array_elements(public.revision_economica(true) -> 'casos') x where (x ->> 'order_id')::uuid = oPend);
  perform tests.ok(k ->> 'estado_caso' = 'resuelto' and k -> 'evidencia_resolucion' ? 'reembolsos_pagados' and (k -> 'reembolsos' -> 0 ->> 'pagado')::boolean, '9 · resuelto: reembolso pagado');
  -- ══ 10 · montos idénticos a v_order_money ══
  perform tests.act_as_service();
  perform tests.ok((select bool_and((x -> 'montos' ->> 'cobrado_neto')::numeric = m.cobrado_neto and (x -> 'montos' ->> 'reembolso_pendiente')::numeric = m.reembolso_pendiente
                                     and (x -> 'montos' ->> 'saldo')::numeric = m.saldo)
                      from jsonb_array_elements(r -> 'casos') x join public.v_order_money m on m.order_id = (x ->> 'order_id')::uuid), '10 · montos = v_order_money');
  -- ══ 11 · resumen coherente ══
  perform tests.eq((r -> 'resumen' ->> 'abiertos')::int, jsonb_array_length(r -> 'casos'), '11 · abiertos = casos devueltos');
  perform tests.eq((r -> 'resumen' ->> 'abiertos')::int, 7, '11 · 7 casos abiertos (tarde, decl, verif, parcial, devol, stripe, autorizado total)');
  perform tests.eq((r -> 'resumen' -> 'por_incidencia' ->> 'dinero_sin_reembolso_autorizado')::int, 3, '11 · 3 con dinero sin autorizar');
  perform tests.ok(r -> 'resumen' ->> 'stripe_anomalias' like 'no_disponible%', '11 · Stripe declarado como no disponible');
  -- ══ 12 · sin efectos secundarios ══
  despues := jsonb_build_object('o', (select count(*) from public.orders), 'c', (select count(*) from public.payment_claims), 'e', (select count(*) from public.payment_entries),
                                'r', (select count(*) from public.refunds), 'x', (select count(*) from public.order_cancellations), 'm', (select count(*) from public.money_operations),
                                'cs', (select string_agg(id::text || status, ',' order by id) from public.payment_claims));
  perform tests.eq(despues, antes, '12 · la lectura no cambió nada');
  perform tests.ok((select provolatile = 's' and prosecdef and 'search_path=public' = any (proconfig) from pg_proc where oid = 'public.revision_economica(boolean)'::regprocedure), '12 · STABLE, SECURITY DEFINER, search_path fijo');
  -- ══ 13 · permisos ══
  perform tests.act_as(v_admin);
  perform tests.ok(jsonb_array_length(public.revision_economica() -> 'casos') = 7, '13 · Dirección lee');
  perform tests.act_as(v_doc);
  perform tests.throws('select public.revision_economica()', 'NO_AUTORIZADO', '13 · doctor rechazado');
  perform tests.act_as(v_pos);
  perform tests.throws('select public.revision_economica()', 'NO_AUTORIZADO', '13 · ventas rechazado');
  perform tests.act_as(v_wh);
  perform tests.throws('select public.revision_economica()', 'NO_AUTORIZADO', '13 · almacén rechazado');
  perform tests.act_as_anon();
  perform tests.throws('select public.revision_economica()', 'permission denied', '13 · anónimo sin EXECUTE');
end $t$;
rollback;
