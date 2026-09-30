-- W2 · F-9: el dinero que llegó se registra SIEMPRE, incluso sobre un pedido cancelado.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing');
  v_doc uuid := tests.user('doctor'); v_p uuid := tests.product();
  v_o uuid; v_o2 uuid; v_r jsonb; v_ref uuid; v_m record;
begin
  perform tests.stock(v_p, 'W2-PT', 50);

  -- 1) Cancelado SIN dinero: lo puede cancelar el doctor
  v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2))); -- 200
  perform tests.act_as(v_doc);
  v_r := public.cancelar_pedido(tests.op(), v_o);
  perform tests.eq(v_r ->> 'refund_review', 'no_aplica', 'cancelado sin dinero ⇒ sin reembolso que revisar');

  -- 2) PAGO TARDÍO: el dinero llega después de cancelar
  perform tests.act_as(v_bill);
  v_r := public.registrar_cobro(tests.op(), v_o, 'transferencia', 200, null, 'SPEI-TARDIO');
  perform tests.eq(v_r ->> 'status', 'applied', 'F-9: el cobro tardío SE REGISTRA (no se niega la realidad)');
  perform tests.eq((v_r ->> 'sobre_pedido_cancelado')::boolean, true, 'queda marcado que cayó sobre un pedido cancelado');
  perform tests.act_as_owner();
  select * into v_m from public.v_order_money where order_id = v_o;
  perform tests.eq(v_m.cobrado_neto, 200::numeric, 'el dinero queda en el libro');
  perform tests.eq(v_m.saldo, 0::numeric, 'saldo 0: el pedido estaba cancelado pero el dinero entró');
  perform tests.eq((select status from public.orders where id = v_o), 'cancelled', 'el pedido sigue cancelado');

  -- 3) La conciliación lo levanta como EXCEPCIÓN hasta resolverlo
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_dinero()
                     where check_id = 'D5_cancelado_con_dinero' and entidad_id = v_o), 1,
    'D5: cancelado con dinero cobrado y sin reembolso autorizado');
  v_ref := (public.autorizar_reembolso(tests.op(), v_o, 'devolucion', 200, 'pago tardío sobre pedido cancelado') ->> 'refund_id')::uuid;
  perform tests.eq((select count(*)::int from public.conciliar_dinero()
                     where check_id = 'D5_cancelado_con_dinero' and entidad_id = v_o), 0,
    'al autorizar el reembolso la excepción D5 se cierra');
  perform tests.eq((select count(*)::int from public.conciliar_dinero()
                     where check_id = 'D4_reembolso_pendiente' and entidad_id = v_o), 1,
    'D-W2-3: queda como reembolso PENDIENTE hasta que salga el dinero');
  perform public.pagar_reembolso(tests.op(), v_ref, 'transferencia');
  perform tests.eq((select count(*)::int from public.conciliar_dinero()
                     where entidad_id = v_o and severidad in ('error','alerta')), 0,
    'pagado el reembolso, el pedido queda sin excepciones');
  perform tests.act_as_owner();
  perform tests.eq((select payment_status from public.orders where id = v_o), 'refunded',
    'la proyección refleja el reembolso íntegro');

  -- 4) Cancelar un pedido YA COBRADO exige Dirección y deja reembolso por revisar (D-W2-3)
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)), 'paid');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L)', v_o2),
    'CANCELACION_REQUIERE_DIRECCION', 'el doctor no cancela un pedido ya cobrado');
  perform tests.act_as(v_admin);
  v_r := public.cancelar_pedido(tests.op(), v_o2, 'el cliente desistió tras pagar');
  perform tests.eq(v_r ->> 'money_signal', 'pago_registrado', 'money_signal sale del LIBRO (sin espejo en el JSON)');
  perform tests.eq(v_r ->> 'refund_review', 'pendiente_revision', 'D-W2-3: reembolso pendiente de revisión, NO automático');
  perform tests.eq((v_r ->> 'cobrado_neto')::numeric, 100::numeric, 'la cancelación reporta el dinero realmente cobrado');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = v_o2 and direction = 'out'), 0,
    'cancelar NO afirma que el dinero se devolvió');
end
$t$;
set constraints all immediate;
rollback;
