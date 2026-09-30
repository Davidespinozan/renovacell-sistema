-- W2 · Cobros: parciales y anticipos (D-W2-2), sobrepago (D-W2-4), fecha valor (F-11).
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos');
  v_wh uuid := tests.user('warehouse'); v_doc uuid := tests.user('doctor'); v_p uuid := tests.product();
  v_o uuid; v_o2 uuid; v_op uuid; v_m record;
begin
  perform tests.stock(v_p, 'W2-CO', 50);
  v_o  := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 3)));  -- 300
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));  -- 100

  -- Roles
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.registrar_cobro(gen_random_uuid(), %L, ''efectivo'', 100)', v_o),
    'NO_AUTORIZADO', 'almacén no registra cobros');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.registrar_cobro(gen_random_uuid(), %L, ''efectivo'', 100)', v_o),
    'NO_AUTORIZADO', 'el doctor no registra cobros');

  -- ANTICIPO / PARCIAL (D-W2-2)
  perform tests.act_as(v_pos);
  v_op := tests.op();
  perform tests.eq(public.registrar_cobro(v_op, v_o, 'efectivo', 120) ->> 'payment_status', 'parcial',
    'anticipo de 120 sobre 300 ⇒ parcial');
  perform tests.eq(public.registrar_cobro(v_op, v_o, 'efectivo', 120) ->> 'status', 'already_applied',
    'cobro idempotente con el mismo op_id');
  perform tests.throws(format('select public.registrar_cobro(%L, %L, ''efectivo'', 999)', v_op, v_o),
    'OP_ID_REUTILIZADO', 'mismo op_id con otro monto ⇒ rechazo');
  perform tests.act_as_owner();
  select * into v_m from public.v_order_money where order_id = v_o;
  perform tests.eq(v_m.cobrado_neto, 120::numeric, 'cobrado_neto = 120');
  perform tests.eq(v_m.saldo, 180::numeric, 'saldo = 180');
  perform tests.ok(not v_m.liberado, 'F-7: un anticipo NO libera para surtir');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o, tests.alloc(v_o)),
    'PEDIDO_NO_LIBERADO', 'no se surte con cobro parcial');

  -- Completar el cobro ⇒ paid + liberado
  perform tests.act_as(v_bill);
  perform tests.eq(public.registrar_cobro(tests.op(), v_o, 'transferencia', 180) ->> 'payment_status', 'paid',
    '120 + 180 = 300 ⇒ paid');
  perform tests.act_as_owner();
  select * into v_m from public.v_order_money where order_id = v_o;
  perform tests.ok(v_m.liberado, 'cobro suficiente ⇒ liberado');
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = v_o), 2, 'dos asientos de ingreso');

  -- SOBREPAGO (D-W2-4): se registra y queda como EXCEPCIÓN
  perform tests.act_as(v_bill);
  perform tests.eq((public.registrar_cobro(tests.op(), v_o2, 'transferencia', 150) ->> 'sobrepago')::boolean, true,
    'cobrar 150 sobre 100 ⇒ sobrepago marcado');
  perform tests.act_as_owner();
  select * into v_m from public.v_order_money where order_id = v_o2;
  perform tests.eq(v_m.payment_status, 'paid', 'sobrepagado sigue siendo paid (no rompe compuertas)');
  perform tests.eq(v_m.saldo, -50::numeric, 'saldo negativo = se le debe al cliente');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_dinero() where check_id = 'D2_sobrepago'), 1,
    'D2: el sobrepago aparece como excepción hasta devolverse');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.registrar_cobro(gen_random_uuid(), %L, ''efectivo'', 10, %L)', v_o2, (public.hoy_local() + 1)::text),
    'FECHA_VALOR_FUTURA', 'F-11: no se acepta fecha valor futura');
  perform tests.throws(format('select public.registrar_cobro(gen_random_uuid(), %L, ''efectivo'', -5)', v_o2),
    'MONTO_INVALIDO', 'monto negativo rechazado');
  perform tests.act_as_owner();
  perform tests.eq((select value_date from public.payment_entries where order_id = v_o2 limit 1), public.hoy_local(),
    'F-11: la fecha valor por defecto es el día LOCAL del negocio');

  -- El webhook del proveedor (service_role) SÍ puede asentar: su notificación firmada es la evidencia.
  perform tests.act_as_service();
  perform tests.eq(public.registrar_cobro(tests.op(), v_o2, 'stripe', 5, null, 'pi_test_1') ->> 'status', 'applied',
    'service_role (webhook) registra el cobro con su referencia externa');
  perform tests.throws(format('select public.registrar_cobro(gen_random_uuid(), %L, ''stripe'', 5, null, ''pi_test_1'')', v_o2),
    'uq_entry_external_ref', 'el mismo evento del proveedor NO se asienta dos veces');
  perform tests.act_as_owner();
  perform tests.eq((select actor_role from public.payment_entries where external_ref = 'pi_test_1'), 'service_role',
    'el asiento del webhook queda atribuido a service_role');
end
$t$;
set constraints all immediate;
rollback;
