-- W1 · Protección append-only COMPROBABLE de cada ledger (nuevo y existente).
-- Se prueba como DUEÑO de la tabla (postgres): si el trigger no existiera, estas
-- escrituras pasarían. Además se prueba el privilegio de clientes y el escape
-- administrativo renovacell.purge (misma semántica que ledger_append_only).
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_doc uuid := tests.user('doctor');
  v_p uuid := tests.product(); v_lot uuid; v_o uuid; v_c jsonb; v_ret uuid; v_line uuid; v_op uuid;
begin
  v_lot := tests.stock(v_p, 'AO-1', 20);
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  perform tests.act_as(v_admin);
  v_c := public.cancelar_pedido(tests.op(), v_o, 'prueba append-only');
  v_ret := (v_c ->> 'return_id')::uuid;
  perform tests.act_as_owner();
  select id into v_line from public.stock_return_lines where return_id = v_ret limit 1;
  select op_id into v_op from public.inventory_operations limit 1;

  -- 1) Ledgers nuevos: UPDATE / DELETE bloqueados incluso para el dueño
  perform tests.throws('update public.inventory_operations set result = ''{}''', 'LEDGER_APPEND_ONLY', 'inventory_operations: UPDATE bloqueado (dueño)');
  perform tests.throws('delete from public.inventory_operations', 'LEDGER_APPEND_ONLY', 'inventory_operations: DELETE bloqueado (dueño)');
  perform tests.throws('update public.purchase_receipts set qty = qty + 1', 'LEDGER_APPEND_ONLY', 'purchase_receipts: UPDATE bloqueado (dueño)');
  perform tests.throws('delete from public.purchase_receipts', 'LEDGER_APPEND_ONLY', 'purchase_receipts: DELETE bloqueado (dueño)');
  perform tests.throws('update public.order_cancellations set reason = ''x''', 'LEDGER_APPEND_ONLY', 'order_cancellations: UPDATE bloqueado (dueño)');
  perform tests.throws('delete from public.order_cancellations', 'LEDGER_APPEND_ONLY', 'order_cancellations: DELETE bloqueado (dueño)');
  perform tests.throws('update public.stock_returns set notes = ''x''', 'LEDGER_APPEND_ONLY', 'stock_returns: UPDATE bloqueado (dueño)');
  perform tests.throws('delete from public.stock_returns', 'LEDGER_APPEND_ONLY', 'stock_returns: DELETE bloqueado (dueño)');

  -- 2) TRUNCATE (no dispara triggers de fila): trigger de sentencia o FK lo impiden
  perform tests.throws('truncate public.order_cancellations', 'LEDGER_APPEND_ONLY', 'order_cancellations: TRUNCATE bloqueado (dueño)');
  perform tests.throws_any('truncate public.inventory_operations', array['LEDGER_APPEND_ONLY','cannot truncate'], 'inventory_operations: TRUNCATE bloqueado (dueño)');
  perform tests.throws_any('truncate public.purchase_receipts', array['LEDGER_APPEND_ONLY','cannot truncate'], 'purchase_receipts: TRUNCATE bloqueado (dueño)');
  perform tests.throws_any('truncate public.stock_returns', array['LEDGER_APPEND_ONLY','cannot truncate'], 'stock_returns: TRUNCATE bloqueado (dueño)');
  perform tests.throws_any('truncate public.stock_return_lines', array['LEDGER_APPEND_ONLY','cannot truncate'], 'stock_return_lines: TRUNCATE bloqueado (dueño)');

  -- 3) stock_return_lines: solo llenado ÚNICO de inspección/disposición
  perform tests.throws('delete from public.stock_return_lines', 'LEDGER_APPEND_ONLY', 'stock_return_lines: DELETE bloqueado (dueño)');
  perform tests.throws(format('update public.stock_return_lines set qty = qty + 1 where id = %L', v_line), 'LEDGER_APPEND_ONLY', 'stock_return_lines: cantidad inmutable');
  perform tests.throws(format('update public.stock_return_lines set lot_id = gen_random_uuid() where id = %L', v_line), 'LEDGER_APPEND_ONLY', 'stock_return_lines: lote inmutable');
  update public.stock_return_lines set inspection = 'dañado', inspected_at = now() where id = v_line;
  perform tests.throws(format('update public.stock_return_lines set inspection = ''ok'' where id = %L', v_line), 'LINEA_YA_INSPECCIONADA', 'stock_return_lines: inspección se escribe una sola vez');
  update public.stock_return_lines set disposition = 'merma', disposed_at = now(), disposition_op_id = gen_random_uuid() where id = v_line;
  perform tests.throws(format('update public.stock_return_lines set disposition = ''vendible'' where id = %L', v_line), 'LINEA_YA_DISPUESTA', 'stock_return_lines: disposición se escribe una sola vez');

  -- 4) Ledgers EXISTENTES: comportamiento sin cambios
  perform tests.throws('update public.inventory_movements set change = change', 'LEDGER_APPEND_ONLY', 'inventory_movements: sigue inmutable (sin cambios)');
  perform tests.throws('delete from public.inventory_movements', 'LEDGER_APPEND_ONLY', 'inventory_movements: DELETE sigue bloqueado');
  perform tests.throws('delete from public.audit_logs', 'LEDGER_APPEND_ONLY', 'audit_logs: sigue inmutable (sin cambios)');

  -- 5) Escape administrativo renovacell.purge: misma semántica en los ledgers nuevos
  begin
    perform set_config('renovacell.purge', 'on', true);
    delete from public.order_cancellations where order_id = v_o;
    perform tests.ok(not exists (select 1 from public.order_cancellations where order_id = v_o), 'renovacell.purge permite la purga administrativa deliberada (ledger nuevo)');
    raise exception 'rollback_sentinel';
  exception when others then
    if sqlerrm <> 'rollback_sentinel' then raise; end if;
  end;
  perform set_config('renovacell.purge', '', true);
  perform tests.ok(exists (select 1 from public.order_cancellations where order_id = v_o), 'sin purge la cancelación sigue ahí (sentinela revirtió)');

  -- 6) Clientes: sin privilegio de escritura en los ledgers nuevos (cualquier rol)
  perform tests.act_as(v_admin);
  perform tests.throws('insert into public.inventory_operations(op_id, kind, actor_role, request_hash, result) values (gen_random_uuid(), ''ajuste'', ''admin'', ''x'', ''{}'')', 'permission denied', 'admin: no inserta en inventory_operations');
  perform tests.throws(format('update public.order_cancellations set reason = ''x'' where order_id = %L', v_o), 'permission denied', 'admin: no edita order_cancellations');
  perform tests.throws(format('update public.stock_return_lines set disposition = ''vendible'' where id = %L', v_line), 'permission denied', 'admin: no edita stock_return_lines directo');
  perform tests.throws('delete from public.purchase_receipts', 'permission denied', 'admin: no borra purchase_receipts');
  perform tests.act_as(v_wh);
  perform tests.throws('insert into public.stock_returns(id, order_id, origin) values (gen_random_uuid(), gen_random_uuid(), ''devolucion'')', 'permission denied', 'almacén: no inserta stock_returns directo');
  perform tests.act_as_anon();
  perform tests.throws('select * from public.inventory_operations', 'permission denied', 'anon: sin acceso al registro de operaciones');
  perform tests.act_as_owner();
end
$t$;
set constraints all immediate;
rollback;
