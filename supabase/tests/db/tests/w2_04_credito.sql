-- W2 · OBJETIVO CENTRAL: se surte a crédito SIN falsificar payment_status ni orders.status.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse');
  v_doc uuid := tests.user('doctor'); v_p uuid := tests.product();
  v_o uuid; v_o2 uuid; v_op uuid; v_m record; v_r jsonb;
begin
  perform tests.stock(v_p, 'W2-CR', 50);
  v_o  := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2))); -- 200
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));

  -- Autoriza SOLO Dirección (D-W2-1)
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.autorizar_credito(gen_random_uuid(), %L, %L, ''x'')', v_o, public.hoy_local() + 30),
    'NO_AUTORIZADO', 'facturación no autoriza crédito');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.autorizar_credito(gen_random_uuid(), %L, %L, ''x'')', v_o, public.hoy_local() + 30),
    'NO_AUTORIZADO', 'almacén no autoriza crédito');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.autorizar_credito(gen_random_uuid(), %L, %L, ''  '')', v_o, public.hoy_local() + 30),
    'MOTIVO_REQUERIDO', 'el crédito requiere motivo');
  perform tests.throws(format('select public.autorizar_credito(gen_random_uuid(), %L, null, ''x'')', v_o),
    'VENCIMIENTO_REQUERIDO', 'el crédito requiere due_date explícita');
  perform tests.throws(format('select public.autorizar_credito(gen_random_uuid(), %L, %L, ''x'')', v_o, public.hoy_local() - 1),
    'VENCIMIENTO_PASADO', 'el vencimiento no puede ser anterior a hoy');

  -- Autorización válida
  v_op := tests.op();
  v_r := public.autorizar_credito(v_op, v_o, public.hoy_local() + 30, 'cliente de confianza, contra-pedido');
  perform tests.eq((v_r ->> 'liberado')::boolean, true, 'el crédito LIBERA para surtir');
  perform tests.eq(v_r ->> 'payment_status', 'pending', 'OBJETIVO 4: el crédito NO toca payment_status');
  perform tests.eq(public.autorizar_credito(v_op, v_o, public.hoy_local() + 30, 'cliente de confianza, contra-pedido') ->> 'status',
    'already_applied', 'autorización idempotente');
  perform tests.throws(format('select public.autorizar_credito(gen_random_uuid(), %L, %L, ''otra'')', v_o, public.hoy_local() + 10),
    'CREDITO_YA_AUTORIZADO', 'una sola autorización vigente por pedido');
  perform tests.act_as_owner();
  perform tests.eq((select payment_status from public.orders where id = v_o), 'pending',
    'OBJETIVO 2+4: payment_status sigue siendo pending (situación financiera REAL)');
  perform tests.eq((select status from public.orders where id = v_o), 'pending_payment',
    'OBJETIVO 4: orders.status NO se falsifica a paid');
  perform tests.eq((select granted_by is not null and reason is not null and due_date is not null
                      from public.credit_grants where order_id = v_o), true,
    'D-W2-1: la autorización guarda actor, motivo y vencimiento');

  -- SURTIR A CRÉDITO (objetivo 3)
  perform tests.act_as(v_wh);
  perform tests.eq(public.surtir_pedido(tests.op(), v_o, tests.alloc(v_o)) ->> 'status', 'applied',
    'OBJETIVO 3: se surte con crédito autorizado y SIN cobro');
  perform tests.act_as_owner();
  perform tests.eq((select status from public.orders where id = v_o), 'packed', 'el pedido avanza a empacado');
  perform tests.eq((select payment_status from public.orders where id = v_o), 'pending',
    'OBJETIVO 2: tras surtir a crédito el pedido sigue financieramente pendiente');
  select * into v_m from public.v_order_money where order_id = v_o;
  perform tests.eq(v_m.saldo, 200::numeric, 'queda la cuenta por cobrar íntegra');
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = v_o), 0,
    'F-1: surtir a crédito NO inventa un asiento de dinero');

  -- Sin crédito ni cobro no se surte
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o2, tests.alloc(v_o2)),
    'PEDIDO_NO_LIBERADO', 'sin cobro ni crédito no se surte');

  -- Revocar el crédito quita la liberación
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.revocar_credito(gen_random_uuid(), %L, ''x'')', v_o),
    'NO_AUTORIZADO', 'facturación no revoca crédito');
  perform tests.act_as(v_admin);
  perform tests.eq(public.autorizar_credito(tests.op(), v_o2, public.hoy_local() + 5, 'prueba') ->> 'liberado', 'true',
    'crédito al segundo pedido');
  perform tests.eq((public.revocar_credito(tests.op(), v_o2, 'el cliente no cumplió') ->> 'liberado')::boolean, false,
    'revocar quita la liberación');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o2, tests.alloc(v_o2)),
    'PEDIDO_NO_LIBERADO', 'tras revocar ya no se surte');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.revocar_credito(gen_random_uuid(), %L, ''x'')', v_o2),
    'SIN_CREDITO_VIGENTE', 'no se revoca dos veces');

  -- Cobrar después: la cuenta por cobrar se cierra por el LIBRO
  perform tests.act_as(v_bill);
  perform tests.eq(public.registrar_cobro(tests.op(), v_o, 'transferencia', 200) ->> 'payment_status', 'paid',
    'al cobrar el contra-pedido, la proyección pasa a paid');
  perform tests.act_as_owner();
  select * into v_m from public.v_order_money where order_id = v_o;
  perform tests.eq(v_m.saldo, 0::numeric, 'saldo liquidado');

end
$t$;
set constraints all immediate;
rollback;
