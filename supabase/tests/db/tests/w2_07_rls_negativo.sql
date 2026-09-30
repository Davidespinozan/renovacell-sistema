-- W2 · F-4: NADIE escribe el dinero directo. Ni Dirección.
begin;
do $t$
declare
  v_roles text[] := array['admin','doctor','pos','warehouse','packing','billing','driver','comm'];
  v_role text; v_u uuid; v_admin uuid := tests.user('admin'); v_doc uuid := tests.user('doctor');
  v_p uuid := tests.product(); v_o uuid; v_claim uuid; v_entry uuid; v_ref uuid;
begin
  perform tests.stock(v_p, 'W2-RL', 20);
  v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)), 'paid');
  select id into v_entry from public.payment_entries where order_id = v_o limit 1;
  perform tests.act_as(v_admin);
  v_ref := (public.autorizar_reembolso(tests.op(), v_o, 'correccion', 10, 'x') ->> 'refund_id')::uuid;
  perform tests.act_as_owner();

  foreach v_role in array v_roles loop
    v_u := tests.user(v_role);
    perform tests.act_as(v_u);
    -- F-4: los campos financieros del pedido, fuera del alcance de TODOS.
    -- Aserción fuerte: el valor NO cambia (da igual si frena el trigger o la RLS).
    perform tests.sin_efecto(format('update public.orders set payment_status = ''refunded'' where id = %L', v_o),
      format('select payment_status from public.orders where id = %L', v_o), 'paid',
      v_role || ': no puede escribir payment_status');
    perform tests.sin_efecto(format('update public.orders set payment_ref = ''HACK'' where id = %L', v_o),
      format('select coalesce(payment_ref, ''<null>'') from public.orders where id = %L', v_o), '<null>',
      v_role || ': no puede escribir payment_ref');
    perform tests.sin_efecto(format('update public.orders set payment_method = ''efectivo'' where id = %L', v_o),
      format('select payment_method from public.orders where id = %L', v_o), 'transferencia',
      v_role || ': no puede escribir payment_method');
    perform tests.sin_efecto(format('update public.orders set stripe_payment_id = ''pi_hack'' where id = %L', v_o),
      format('select coalesce(stripe_payment_id, ''<null>'') from public.orders where id = %L', v_o), '<null>',
      v_role || ': no puede escribir stripe_payment_id');
    -- El libro y sus tablas: sin escritura para nadie
    perform tests.throws(format($s$insert into public.payment_entries (id, order_id, direction, method, amount, actor_role)
      values (gen_random_uuid(), %L, 'in', 'efectivo', 999, 'x')$s$, v_o),
      'permission denied', v_role || ': no inserta asientos');
    perform tests.throws(format('update public.payment_entries set amount = 1 where id = %L', v_entry),
      'permission denied', v_role || ': no edita asientos');
    perform tests.throws(format($s$insert into public.payment_claims (id, order_id, method, amount_declared)
      values (gen_random_uuid(), %L, 'transferencia', 1)$s$, v_o),
      'permission denied', v_role || ': no inserta declaraciones');
    perform tests.throws(format($s$insert into public.credit_grants (id, order_id, due_date, reason)
      values (gen_random_uuid(), %L, current_date + 30, 'hack')$s$, v_o),
      'permission denied', v_role || ': no inserta créditos');
    perform tests.throws($s$insert into public.cash_closings (fecha, alcance, esperado, contado, diferencia, fondo)
      values (current_date, 'dia', 0, 999, 999, 0)$s$,
      'permission denied', v_role || ': no inserta cortes de caja');
    perform tests.throws('delete from public.cash_closings', 'permission denied', v_role || ': no borra cortes de caja');
    perform tests.throws(format('select public.pay_order(%L, ''registrado'', ''ADM'')', v_o),
      'permission denied', v_role || ': pay_order revocado (ya no se finge un pago)');
    perform tests.throws('select public._w2_trusted(true)', 'permission denied', v_role || ': helper interno no ejecutable');
    -- D-W2-CASH-CUTOFF: la aritmética del tramo es del servidor y no se consulta desde fuera de caja
    perform tests.throws('select public._w2_corte_cola(''dia'', null)', 'permission denied',
      v_role || ': no lee la cadena de cortes por el helper');
    perform tests.throws('select public._w2_corte_desde(current_date, ''dia'', null)', 'permission denied',
      v_role || ': no calcula el inicio del tramo');
    perform tests.throws('select public._w2_efectivo_tramo(now() - interval ''1 day'', now(), ''dia'', null)', 'permission denied',
      v_role || ': no suma el efectivo de un tramo a mano');
    perform tests.throws(format('select public._w2_asiento(gen_random_uuid(), %L, ''in'', ''efectivo'', 1, current_date)', v_o),
      'permission denied', v_role || ': no puede escribir en el libro por el helper');
    perform tests.act_as_owner();
  end loop;

  -- El efectivo en caja NO es información para todos (D-W2-CASH-CUTOFF)
  perform tests.act_as(v_doc);
  perform tests.throws('select public.efectivo_esperado(public.hoy_local(), ''dia'', null)', 'NO_AUTORIZADO',
    'doctor: no consulta el efectivo esperado de la caja');
  perform tests.throws('select public.tramo_corte_caja(public.hoy_local(), ''dia'', null)', 'NO_AUTORIZADO',
    'doctor: no consulta el tramo del corte');
  perform tests.act_as(tests.user('warehouse'));
  perform tests.throws('select public.efectivo_esperado(public.hoy_local(), ''dia'', null)', 'NO_AUTORIZADO',
    'almacén: no consulta el efectivo esperado de la caja');
  perform tests.act_as_owner();

  -- El doctor tampoco fabrica su declaración en el JSON del pedido (D-W2-6: sin espejo)
  perform tests.act_as(v_doc);
  perform tests.sin_efecto(format($s$update public.orders
      set shipping_meta = jsonb_set(coalesce(shipping_meta, '{}'), '{transfer}', '{"reported":true}') where id = %L$s$, v_o),
    format('select coalesce(shipping_meta -> ''transfer'', ''null''::jsonb)::text from public.orders where id = %L', v_o),
    'null', 'doctor: no fabrica transfer en shipping_meta (D-W2-6: sin espejo)');

  -- anon: nada
  perform tests.act_as_anon();
  perform tests.throws(format('select public.registrar_cobro(gen_random_uuid(), %L, ''efectivo'', 1)', v_o),
    'permission denied', 'anon: no registra cobros');
  perform tests.throws(format('select public.autorizar_credito(gen_random_uuid(), %L, current_date + 1, ''x'')', v_o),
    'permission denied', 'anon: no autoriza crédito');
  perform tests.throws('select * from public.payment_entries', 'permission denied', 'anon: no lee el libro');

  -- Lecturas legítimas que deben seguir funcionando
  perform tests.act_as(v_admin);
  perform tests.ok((select count(*) from public.v_order_money where order_id = v_o) = 1, 'Dirección lee v_order_money');
  perform tests.ok((select count(*) from public.payment_entries where order_id = v_o) >= 1, 'Dirección lee el libro');
  perform tests.act_as(v_doc);
  perform tests.ok((select count(*) from public.payment_claims) >= 0, 'el doctor puede consultar sus declaraciones');
  perform tests.act_as_owner();
end
$t$;
set constraints all immediate;
rollback;
