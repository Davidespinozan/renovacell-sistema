-- W2 · Conciliación del dinero: un ciclo sano da 0 errores; la corrupción se detecta.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse');
  v_doc uuid := tests.user('doctor'); v_p uuid := tests.product();
  v_o uuid; v_o2 uuid; v_ref uuid; v_claim uuid; v_g uuid;
begin
  perform tests.stock(v_p, 'W2-CN', 50);

  -- Ciclo sano completo: declarar → verificar → surtir → devolver → reembolsar
  v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  v_claim := tests.reportar(v_o);
  perform tests.act_as(v_bill);
  perform public.revisar_pago(tests.op(), v_claim, 'verificar');
  perform tests.act_as(v_wh);
  perform public.surtir_pedido(tests.op(), v_o, tests.alloc(v_o));
  perform tests.act_as(v_bill);
  v_ref := (public.autorizar_reembolso(tests.op(), v_o, 'devolucion', 50, 'producto devuelto') ->> 'refund_id')::uuid;
  perform public.pagar_reembolso(tests.op(), v_ref, 'transferencia');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_dinero() where severidad = 'error'), 0,
    'ciclo completo ⇒ 0 errores de conciliación');

  -- D1: proyección desalineada con el libro (se fuerza con el escape confiable)
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  update public.orders set payment_status = 'paid' where id = v_o;
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_dinero() where check_id = 'D1_proyeccion_vs_libro' and entidad_id = v_o), 1,
    'D1 detecta que payment_status no coincide con el libro');
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  update public.orders set payment_status = 'parcial' where id = v_o;
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_dinero() where check_id = 'D1_proyeccion_vs_libro'), 0,
    'corregida la proyección, D1 se limpia');

  -- D3: egreso mayor que lo autorizado (inserción directa como dueño)
  v_o2 := tests.order(v_doc, 'delivered', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)), 'paid');
  perform tests.act_as(v_bill);
  v_ref := (public.autorizar_reembolso(tests.op(), v_o2, 'correccion', 20, 'x') ->> 'refund_id')::uuid;
  perform tests.act_as_owner();
  insert into public.payment_entries (id, order_id, refund_id, direction, method, amount, actor_role)
  values (gen_random_uuid(), v_o2, v_ref, 'out', 'efectivo', 80, 'owner');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_dinero() where check_id = 'D3_egreso_sin_autorizacion' and entidad_id = v_o2), 1,
    'D3 detecta que se devolvió más de lo autorizado');

  -- D6: asiento colgado de una declaración NO verificada
  perform tests.act_as_owner();
  insert into public.payment_claims (id, order_id, method, amount_declared, status)
  values (gen_random_uuid(), v_o2, 'transferencia', 10, 'reportado') returning id into v_claim;
  insert into public.payment_entries (id, order_id, claim_id, direction, method, amount, actor_role)
  values (gen_random_uuid(), v_o2, v_claim, 'in', 'transferencia', 10, 'owner');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_dinero() where check_id = 'D6_declaracion_vs_asiento' and entidad_id = v_claim), 1,
    'D6 detecta asiento con declaración sin verificar');

  -- D7: crédito vencido con saldo
  perform tests.act_as_owner();
  v_o2 := tests.order(v_doc, 'delivered', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  insert into public.credit_grants (id, order_id, due_date, reason, granted_by, granted_at)
  values (gen_random_uuid(), v_o2, public.hoy_local() - 3, 'crédito viejo', v_admin, now() - interval '30 days')
  returning id into v_g;
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_dinero() where check_id = 'D7_credito_vencido' and entidad_id = v_o2), 1,
    'D7: crédito vencido con saldo aparece en cobranza');
  perform tests.eq((select count(*)::int from public.conciliar_dinero() where check_id = 'D9_entregado_sin_cobrar' and entidad_id = v_o2), 1,
    'D9: entregado a crédito y sin cobrar queda visible');

  -- Solo Dirección concilia
  perform tests.act_as(v_wh);
  perform tests.throws('select * from public.conciliar_dinero()', 'NO_AUTORIZADO', 'almacén no concilia dinero');
  perform tests.act_as_owner();
end
$t$;
set constraints all immediate;
rollback;
