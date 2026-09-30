-- W2 · El LIBRO es append-only comprobable, y las resoluciones se escriben UNA vez.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doc uuid := tests.user('doctor'); v_p uuid := tests.product();
  v_o uuid; v_claim uuid; v_entry uuid; v_grant uuid; v_cierre uuid; v_refund uuid;
begin
  perform tests.stock(v_p, 'W2-AO', 20);
  v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  v_claim := tests.reportar(v_o);
  perform tests.act_as(v_admin);
  perform public.revisar_pago(tests.op(), v_claim, 'verificar');
  select id into v_entry from public.payment_entries where order_id = v_o limit 1;
  v_grant := (public.autorizar_credito(tests.op(), tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1))), public.hoy_local() + 30, 'x') ->> 'grant_id')::uuid;
  v_refund := (public.autorizar_reembolso(tests.op(), v_o, 'correccion', 5, 'prueba') ->> 'refund_id')::uuid;
  perform public.registrar_corte_caja(tests.op(), public.hoy_local(), 'dia', 0, 0);
  select id into v_cierre from public.cash_closings limit 1;
  perform tests.act_as_owner();

  -- 1) El libro: inmutable incluso para el DUEÑO de la tabla
  perform tests.throws(format('update public.payment_entries set amount = amount + 1 where id = %L', v_entry),
    'LEDGER_APPEND_ONLY', 'payment_entries: UPDATE bloqueado (dueño)');
  perform tests.throws('delete from public.payment_entries', 'LEDGER_APPEND_ONLY', 'payment_entries: DELETE bloqueado (dueño)');
  perform tests.throws_any('truncate public.payment_entries', array['LEDGER_APPEND_ONLY','cannot truncate'], 'payment_entries: TRUNCATE bloqueado');
  perform tests.throws('update public.money_operations set result = ''{}''', 'LEDGER_APPEND_ONLY', 'money_operations: UPDATE bloqueado');
  perform tests.throws('delete from public.money_operations', 'LEDGER_APPEND_ONLY', 'money_operations: DELETE bloqueado');

  -- 2) Declaración: identidad inmutable, resolución una sola vez
  perform tests.throws(format('update public.payment_claims set amount_declared = 1 where id = %L', v_claim),
    'LEDGER_APPEND_ONLY', 'payment_claims: el monto declarado es inmutable');
  perform tests.throws(format('delete from public.payment_claims where id = %L', v_claim),
    'LEDGER_APPEND_ONLY', 'payment_claims: DELETE bloqueado');
  perform tests.throws(format('update public.payment_claims set status = ''rechazado'' where id = %L', v_claim),
    'DECLARACION_YA_RESUELTA', 'payment_claims: la resolución se escribe una sola vez');

  -- 3) Crédito: concesión inmutable, revocación una sola vez
  perform tests.throws(format('update public.credit_grants set due_date = due_date + 1 where id = %L', v_grant),
    'LEDGER_APPEND_ONLY', 'credit_grants: la concesión es inmutable');
  perform tests.throws(format('delete from public.credit_grants where id = %L', v_grant),
    'LEDGER_APPEND_ONLY', 'credit_grants: DELETE bloqueado');

  -- 4) Corte de caja: ni edición ni borrado (D-W2-7)
  perform tests.throws(format('update public.cash_closings set contado = 999 where id = %L', v_cierre),
    'LEDGER_APPEND_ONLY', 'cash_closings: UPDATE bloqueado');
  perform tests.throws(format('delete from public.cash_closings where id = %L', v_cierre),
    'LEDGER_APPEND_ONLY', 'cash_closings: DELETE bloqueado');

  -- 5) Reembolso autorizado: sigue append-only (comportamiento previo preservado)
  perform tests.throws(format('update public.refunds set monto = 1 where id = %L', v_refund),
    'inmutables', 'refunds: sigue append-only (sin cambios respecto a antes de W2)');

  -- 6) Escape administrativo: misma semántica que los ledgers de W1.
  --    Se usa un asiento SIN declaración que lo referencie (la FK protege al resto).
  perform tests.act_as(v_admin);
  v_entry := (public.registrar_cobro(tests.op(), v_o, 'efectivo', 1) ->> 'entry_id')::uuid;
  perform tests.act_as_owner();
  begin
    perform set_config('renovacell.purge', 'on', true);
    delete from public.payment_entries where id = v_entry;
    perform tests.ok(not exists (select 1 from public.payment_entries where id = v_entry),
      'renovacell.purge permite la purga administrativa deliberada (libro)');
    raise exception 'rollback_sentinel';
  exception when others then
    if sqlerrm <> 'rollback_sentinel' then raise; end if;
  end;
  perform set_config('renovacell.purge', '', true);
  perform tests.ok(exists (select 1 from public.payment_entries where id = v_entry), 'sin purge el asiento sigue ahí');
end
$t$;
set constraints all immediate;
rollback;
