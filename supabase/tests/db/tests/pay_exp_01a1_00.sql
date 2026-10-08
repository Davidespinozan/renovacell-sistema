-- PAY-EXP-01A-1 (133) · revisar_pago con orden canónico de bloqueos (pedido → declaración) + índice único de asiento
-- original por declaración. Mismo contrato: idempotencia, rechazo con motivo, parcial, pago tardío (F-9), permisos,
-- atomicidad. La concurrencia real va en concurrency/pay_exp_01a1_concurrency.sh (sesiones independientes).
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos');
  v_doc uuid := tests.user('doctor'); v_p uuid := tests.product();
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; op uuid; r jsonb; r2 jsonb; d text; n int; e1 uuid;
begin
  perform tests.stock(v_p, 'P1A1', 100);
  o1 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));   -- 200
  o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));   -- 200 (parcial)
  o3 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));   -- 200 (cancelado con declaración)
  o4 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));   -- 100 (atomicidad)

  -- ══ 0 · estructura: orden de bloqueos, índice y permisos ══
  d := pg_get_functiondef('public.revisar_pago(uuid,uuid,text,numeric,date,text)'::regprocedure);
  perform tests.ok(position('perform 1 from public.orders where id = v_order for update;' in d) > 0
                   and position('perform 1 from public.orders where id = v_order for update;' in d) < position('select * into v_c from public.payment_claims where id = p_claim_id for update;' in d),
                   '0 · el pedido se bloquea ANTES que la declaración');
  perform tests.ok(position('where id = v_c.order_id for update' in d) = 0, '0 · ya no hay bloqueo del pedido después de la declaración');
  perform tests.ok(exists (select 1 from pg_indexes where indexname = 'uq_entry_claim_original' and indexdef like 'CREATE UNIQUE INDEX%claim_id%reversal_of IS NULL%'), '0 · índice único parcial (originales)');
  perform tests.ok(has_function_privilege('authenticated', 'public.revisar_pago(uuid,uuid,text,numeric,date,text)', 'execute')
                   and not has_function_privilege('anon', 'public.revisar_pago(uuid,uuid,text,numeric,date,text)', 'execute'), '0 · permisos intactos (authenticated sí, anon no)');

  -- ══ 1 · verificar crea UN asiento; segunda verificación y reintento no duplican ══
  perform tests.act_as(v_doc);
  c1 := (public.reportar_pago(tests.op(), o1, 'transferencia', 200, 'REF-1') ->> 'claim_id')::uuid;
  perform tests.act_as(v_bill);
  op := tests.op();
  r := public.revisar_pago(op, c1, 'verificar');
  perform tests.eq(r ->> 'status', 'applied', '1 · verificado');
  perform tests.eq(r ->> 'payment_status', 'paid', '1 · pedido pagado');
  r2 := public.revisar_pago(op, c1, 'verificar');
  perform tests.eq(r2 ->> 'status', 'already_applied', '1 · reintento con el MISMO op_id: idempotente');
  perform tests.eq(r2 ->> 'entry_id', r ->> 'entry_id', '1 · mismo asiento en el reintento');
  r2 := public.revisar_pago(tests.op(), c1, 'verificar');
  perform tests.eq(r2 ->> 'status', 'already_verified', '1 · otro revisor: ya verificado');
  perform tests.throws(format('select public.revisar_pago(%L, %L, ''rechazar'', null, null, ''x'')', tests.op(), c1), 'YA_VERIFICADO', '1 · no se rechaza lo verificado');
  perform tests.act_as_service();
  perform tests.eq((select count(*)::int from public.payment_entries where claim_id = c1), 1, '1 · un solo asiento por la declaración');

  -- ══ 2 · rechazo con motivo; rechazada no se verifica; reintento idempotente ══
  perform tests.act_as(v_doc);
  c2 := (public.reportar_pago(tests.op(), o2, 'transferencia', 100, 'REF-2') ->> 'claim_id')::uuid;
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.revisar_pago(%L, %L, ''rechazar'')', tests.op(), c2), 'MOTIVO_REQUERIDO', '2 · rechazo exige motivo');
  op := tests.op();
  perform tests.eq(public.revisar_pago(op, c2, 'rechazar', null, null, 'no llegó') ->> 'resultado', 'rechazado', '2 · rechazado');
  perform tests.eq(public.revisar_pago(op, c2, 'rechazar', null, null, 'no llegó') ->> 'status', 'already_applied', '2 · reintento idempotente');
  perform tests.throws(format('select public.revisar_pago(%L, %L, ''verificar'')', tests.op(), c2), 'DECLARACION_RECHAZADA', '2 · rechazada no se verifica');

  -- ══ 3 · pago parcial: 100 de 200 → parcial; segunda declaración → pagado; un asiento por declaración ══
  perform tests.act_as(v_doc);
  c3 := (public.reportar_pago(tests.op(), o2, 'transferencia', 100, 'REF-3') ->> 'claim_id')::uuid;
  perform tests.act_as(v_bill);
  perform tests.eq(public.revisar_pago(tests.op(), c3, 'verificar') ->> 'payment_status', 'parcial', '3 · parcial');
  perform tests.act_as(v_doc);
  c4 := (public.reportar_pago(tests.op(), o2, 'transferencia', 100, 'REF-4') ->> 'claim_id')::uuid;
  perform tests.act_as(v_bill);
  perform tests.eq(public.revisar_pago(tests.op(), c4, 'verificar') ->> 'payment_status', 'paid', '3 · completado');
  perform tests.act_as_service();
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = o2 and reversal_of is null), 2, '3 · dos asientos, uno por declaración');

  -- ══ 4 · pedido cancelado con declaración previa: la declaración sigue abierta y verificarla registra el dinero (F-9) ══
  perform tests.act_as(v_doc);
  c5 := (public.reportar_pago(tests.op(), o3, 'transferencia', 200, 'REF-5') ->> 'claim_id')::uuid;
  perform tests.act_as(v_admin);
  r := public.cancelar_pedido(tests.op(), o3, 'cliente desistió');
  perform tests.eq(r ->> 'money_signal', 'pago_reportado_en_revision', '4 · cancelación con señal de declaración');
  perform tests.act_as_service();
  perform tests.eq((select status from public.payment_claims where id = c5), 'reportado', '4 · la declaración NO se cerró en silencio');
  perform tests.act_as(v_bill);
  perform tests.eq(public.revisar_pago(tests.op(), c5, 'verificar') ->> 'resultado', 'verificado', '4 · el dinero que sí llegó se reconoce');
  perform tests.act_as_service();
  perform tests.eq((select status from public.orders where id = o3), 'cancelled', '4 · el pedido sigue cancelado');
  perform tests.act_as(v_admin);
  perform tests.ok(exists (select 1 from public.conciliar_dinero() x where x.check_id = 'D5_cancelado_con_dinero' and x.entidad_id = o3), '4 · D5 lo detecta');

  -- ══ 5 · permisos ══
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.revisar_pago(%L, %L, ''verificar'')', tests.op(), c5), 'NO_AUTORIZADO', '5 · el doctor no revisa');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.revisar_pago(%L, %L, ''verificar'')', tests.op(), c5), 'NO_AUTORIZADO', '5 · almacén no revisa');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.revisar_pago(%L, %L, ''verificar'')', tests.op(), c5), 'NO_AUTORIZADO', '5 · ventas no revisa');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.revisar_pago(%L, %L, ''verificar'')', tests.op(), c5), 'permission denied', '5 · anónimo sin EXECUTE');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.revisar_pago(%L, %L, ''verificar'')', tests.op(), gen_random_uuid()), 'DECLARACION_INEXISTENTE', '5 · declaración inexistente');

  -- ══ 6 · atomicidad: un fallo a mitad (fecha valor futura) no deja asiento, ni declaración resuelta, ni operación ══
  perform tests.act_as(v_doc);
  c4 := (public.reportar_pago(tests.op(), o4, 'transferencia', 100, 'REF-6') ->> 'claim_id')::uuid;
  perform tests.act_as(v_bill);
  op := tests.op();
  perform tests.throws(format('select public.revisar_pago(%L, %L, ''verificar'', null, %L)', op, c4, current_date + 30), 'FECHA_VALOR_FUTURA', '6 · falla a mitad');
  perform tests.act_as_service();
  perform tests.ok((select status from public.payment_claims where id = c4) = 'reportado'
                   and not exists (select 1 from public.payment_entries where claim_id = c4)
                   and not exists (select 1 from public.money_operations where op_id = op), '6 · sin efectos parciales');

  -- ══ 7 · segunda barrera: el índice impide un segundo asiento ORIGINAL de la misma declaración; las reversas no ══
  e1 := (select id from public.payment_entries where claim_id = c1);
  perform tests.throws(format('select public._w2_asiento(gen_random_uuid(), %L, ''in'', ''transferencia'', 200, public.hoy_local(), %L)', o1, c1), 'uq_entry_claim_original', '7 · un segundo asiento original de la declaración se rechaza');
  perform public._w2_asiento(gen_random_uuid(), o1, 'out', 'transferencia', 200, public.hoy_local(), c1, null, null, null, null, e1, 'reversa de prueba');
  perform tests.eq((select count(*)::int from public.payment_entries where claim_id = c1), 2, '7 · la reversa (reversal_of) no choca con el índice');
end $t$;
rollback;
