-- W2 · Declaración de pago: reportar ≠ cobrar (F-3) + idempotencia por op_id (F-12).
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse');
  v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor'); v_p uuid := tests.product();
  v_o uuid; v_o2 uuid; v_claim uuid; v_op uuid; v_r jsonb; v_banco uuid;
begin
  perform tests.stock(v_p, 'W2-CL', 50);
  v_o  := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));  -- total 200
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  insert into public.company_bank_accounts (bank_name, beneficiary_name, active, is_default, display_order)
  values ('Banco Prueba', 'Renovacell', true, false, 9) returning id into v_banco;

  -- Reportar NO mueve dinero
  perform tests.act_as(v_doc);
  v_op := tests.op();
  v_r := public.reportar_pago(v_op, v_o, 'transferencia', 200, 'REF-1', v_banco, 'proofs/x.jpg');
  v_claim := (v_r ->> 'claim_id')::uuid;
  perform tests.eq(v_r ->> 'status', 'applied', 'el doctor reporta su pago');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = v_o), 0, 'F-3: reportar NO crea asiento');
  perform tests.eq((select payment_status from public.orders where id = v_o), 'pending', 'F-3: reportar NO cambia payment_status');

  -- Idempotencia del reporte
  perform tests.act_as(v_doc);
  perform tests.eq(public.reportar_pago(v_op, v_o, 'transferencia', 200, 'REF-1', v_banco, 'proofs/x.jpg') ->> 'status',
    'already_applied', 'mismo op_id ⇒ already_applied');
  perform tests.throws(format('select public.reportar_pago(%L, %L, ''transferencia'', 999)', v_op, v_o),
    'OP_ID_REUTILIZADO', 'mismo op_id con otro contenido ⇒ rechazo');
  perform tests.throws(format('select public.reportar_pago(gen_random_uuid(), %L, ''transferencia'', 200)', v_o),
    'DECLARACION_ABIERTA', 'una sola declaración abierta por pedido');
  perform tests.act_as(v_doc2);
  perform tests.throws(format('select public.reportar_pago(gen_random_uuid(), %L, ''transferencia'', 100)', v_o2),
    'NO_AUTORIZADO', 'un doctor no reporta pagos de otro');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.reportar_pago(gen_random_uuid(), %L, ''transferencia'', 0)', v_o2),
    'MONTO_INVALIDO', 'monto cero rechazado');
  perform tests.throws(format('select public.reportar_pago(gen_random_uuid(), %L, ''bitcoin'', 10)', v_o2),
    'METODO_INVALIDO', 'método inválido rechazado');
  perform tests.throws(format('select public.reportar_pago(gen_random_uuid(), %L, ''transferencia'', 10, null, gen_random_uuid())', v_o2),
    'CUENTA_INVALIDA', 'cuenta bancaria inexistente rechazada');

  -- Revisar: solo Dirección/Facturación
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.revisar_pago(gen_random_uuid(), %L, ''verificar'')', v_claim),
    'NO_AUTORIZADO', 'almacén no verifica pagos');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.revisar_pago(gen_random_uuid(), %L, ''verificar'')', v_claim),
    'NO_AUTORIZADO', 'el doctor no verifica su propio pago');

  -- Rechazar exige motivo; luego se puede volver a reportar
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.revisar_pago(gen_random_uuid(), %L, ''rechazar'')', v_claim),
    'MOTIVO_REQUERIDO', 'el rechazo necesita motivo');
  v_op := tests.op();
  perform tests.eq(public.revisar_pago(v_op, v_claim, 'rechazar', null, null, 'comprobante ilegible') ->> 'resultado',
    'rechazado', 'Facturación rechaza la declaración');
  perform tests.eq(public.revisar_pago(v_op, v_claim, 'rechazar', null, null, 'comprobante ilegible') ->> 'status',
    'already_applied', 'rechazo idempotente');
  perform tests.throws(format('select public.revisar_pago(gen_random_uuid(), %L, ''verificar'')', v_claim),
    'DECLARACION_RECHAZADA', 'no se verifica una declaración rechazada');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = v_o), 0, 'rechazar NO crea asiento');

  -- Nuevo reporte tras el rechazo → verificar CREA el asiento
  perform tests.act_as(v_doc);
  v_claim := (public.reportar_pago(tests.op(), v_o, 'transferencia', 200, 'REF-2') ->> 'claim_id')::uuid;
  perform tests.act_as(v_bill);
  v_op := tests.op();
  v_r := public.revisar_pago(v_op, v_claim, 'verificar');
  perform tests.eq(v_r ->> 'resultado', 'verificado', 'verificar tras un nuevo reporte');
  perform tests.eq(v_r ->> 'payment_status', 'paid', 'la proyección financiera pasa a paid');
  perform tests.eq(public.revisar_pago(v_op, v_claim, 'verificar') ->> 'status', 'already_applied', 'verificación idempotente');
  perform tests.throws(format('select public.revisar_pago(gen_random_uuid(), %L, ''rechazar'', null, null, ''x'')', v_claim),
    'YA_VERIFICADO', 'no se rechaza un pago ya verificado');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = v_o and direction = 'in'), 1,
    'la verificación crea EXACTAMENTE un asiento');
  perform tests.eq((select entry_id is not null from public.payment_claims where id = v_claim), true,
    'la declaración queda ligada a su asiento');
  perform tests.eq((select cobrado_neto from public.v_order_money where order_id = v_o), 200::numeric, 'cobrado_neto = 200');

  -- Monto verificado distinto al declarado: manda el verificado
  perform tests.act_as(v_doc);
  v_claim := (public.reportar_pago(tests.op(), v_o2, 'transferencia', 100, 'REF-3') ->> 'claim_id')::uuid;
  perform tests.act_as(v_bill);
  perform tests.eq((public.revisar_pago(tests.op(), v_claim, 'verificar', 60) ->> 'monto')::numeric, 60::numeric,
    'el monto VERIFICADO manda sobre el declarado');
  perform tests.act_as_owner();
  perform tests.eq((select estado_pago from public.v_order_money where order_id = v_o2), 'parcial',
    'verificar de menos deja el pedido en parcial');
end
$t$;
set constraints all immediate;
rollback;
