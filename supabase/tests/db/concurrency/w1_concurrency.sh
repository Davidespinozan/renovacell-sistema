#!/usr/bin/env bash
# ============================================================================
# W1 · Concurrencia REAL: dos sesiones Postgres en paralelo. La sesión A ejecuta
# el comando y retiene sus locks (pg_sleep antes de COMMIT); la sesión B arranca
# durante esa ventana. Se verifica el estado CONFIRMADO en la BD, no solo la salida.
# Lo invoca supabase/tests/db/run.sh (PGHOST/PGPORT/PGUSER ya exportados).
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT

sql()   { "${P[@]}" -v ON_ERROR_STOP=1 -c "$1"; }
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
has()   { if grep -q "$2" "$3"; then echo "PASS: $1"; else echo "FAIL: $1 (salida: $(tr '\n' ' ' < "$3" | cut -c1-200))"; FAILED=1; fi; }
# race <A-sql> <B-sql> : A retiene locks 1.5 s; B arranca a los 0.4 s
race() {
  ("${P[@]}" -c "begin; $1; select pg_sleep(1.5); commit;" > "$T/a.out" 2>&1) &
  sleep 0.4
  ("${P[@]}" -c "begin; $2; commit;" > "$T/b.out" 2>&1) &
  wait
}

# ---------------------------------------------------------------- 1) mismo op_id, recepción
sql "do \$\$ declare v_p uuid := tests.product(); v_rep uuid; begin
  insert into public.replenishments(product_id, product_name, qty, unit_cost, kind) values (v_p, 'P', 100, 10, 'compra') returning id into v_rep;
  insert into tests.ctx values ('c1_wh', tests.user('warehouse')), ('c1_p', v_p), ('c1_rep', v_rep), ('c1_op', gen_random_uuid());
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('c1_wh')); select public.recibir_lote(p_op_id => tests.id('c1_op'), p_product => tests.id('c1_p'), p_lote => 'CC1', p_caducidad => current_date + 100, p_cantidad => 60, p_replenishment_id => tests.id('c1_rep')) ->> 'status'"
race "$CMD" "$CMD"
has "c1: sesión A aplica la recepción" "^applied$" "$T/a.out"
has "c1: sesión B (mismo op_id, en paralelo) ⇒ already_applied" "^already_applied$" "$T/b.out"
check "c1: stock sumado UNA vez (60)" "select quantity = 60 from public.lots where product_id = tests.id('c1_p')"
check "c1: una recepción, un registro de operación" "select (select count(*) from public.purchase_receipts where replenishment_id = tests.id('c1_rep')) = 1 and (select count(*) from public.inventory_operations where op_id = tests.id('c1_op')) = 1"

# ---------------------------------------------------------------- 2) dos recepciones distintas, misma orden
sql "do \$\$ declare v_p uuid := tests.product(); v_rep uuid; begin
  insert into public.replenishments(product_id, product_name, qty, unit_cost, kind) values (v_p, 'P', 100, 10, 'compra') returning id into v_rep;
  insert into tests.ctx values ('c2_wh', tests.user('warehouse')), ('c2_p', v_p), ('c2_rep', v_rep);
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('c2_wh')); select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => tests.id('c2_p'), p_lote => 'CC2', p_caducidad => current_date + 100, p_cantidad => 60, p_replenishment_id => tests.id('c2_rep')) ->> 'status'"
race "$CMD" "$CMD"
has "c2: B espera el lock de la orden y ve el acumulado ⇒ RECEPCION_EXCEDE_PENDIENTE" "RECEPCION_EXCEDE_PENDIENTE" "$T/b.out"
check "c2: acumulado nunca supera lo pedido (60/100)" "select received_qty = 60 and status = 'parcial' from public.replenishments where id = tests.id('c2_rep')"

# ---------------------------------------------------------------- 3) surtido doble del mismo pedido (op distintos)
sql "do \$\$ declare v_p uuid := tests.product(); v_l uuid; v_o uuid; begin
  v_l := tests.stock(v_p, 'CC3', 10);
  v_o := tests.order(tests.user('doctor'), 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 4)), 'paid');
  insert into tests.ctx values ('c3_wh', tests.user('warehouse')), ('c3_l', v_l), ('c3_o', v_o);
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('c3_wh')); select public.surtir_pedido(gen_random_uuid(), tests.id('c3_o'), tests.alloc(tests.id('c3_o'))) ->> 'status'"
race "$CMD" "$CMD"
has "c3: B ⇒ PEDIDO_YA_SURTIDO (sin doble consumo)" "PEDIDO_YA_SURTIDO" "$T/b.out"
check "c3: el lote se descontó UNA vez (10 → 6)" "select quantity = 6 from public.lots where id = tests.id('c3_l')"
check "c3: una sola salida en kardex" "select count(*) = 1 from public.inventory_movements where order_id = tests.id('c3_o')"

# ---------------------------------------------------------------- 4) surtidos cruzados sobre los mismos 2 lotes (sin deadlock)
sql "do \$\$ declare v_p uuid := tests.product(); v_l1 uuid; v_l2 uuid; v_x uuid; v_y uuid; v_d uuid := tests.user('doctor'); begin
  v_l1 := tests.stock(v_p, 'CC4-A', 10, current_date + 50); v_l2 := tests.stock(v_p, 'CC4-B', 10, current_date + 60);
  v_x := tests.order(v_d, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 4)), 'paid');
  v_y := tests.order(v_d, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 4)), 'paid');
  insert into tests.ctx values ('c4_wh', tests.user('warehouse')), ('c4_l1', v_l1), ('c4_l2', v_l2), ('c4_x', v_x), ('c4_y', v_y);
end \$\$;" >/dev/null
A="select tests.act_as(tests.id('c4_wh')); select public.surtir_pedido(gen_random_uuid(), tests.id('c4_x'), jsonb_build_array(
  jsonb_build_object('order_item_id', (select id from public.order_items where order_id = tests.id('c4_x')), 'lot_id', tests.id('c4_l1'), 'qty', 2),
  jsonb_build_object('order_item_id', (select id from public.order_items where order_id = tests.id('c4_x')), 'lot_id', tests.id('c4_l2'), 'qty', 2))) ->> 'status'"
B="select tests.act_as(tests.id('c4_wh')); select public.surtir_pedido(gen_random_uuid(), tests.id('c4_y'), jsonb_build_array(
  jsonb_build_object('order_item_id', (select id from public.order_items where order_id = tests.id('c4_y')), 'lot_id', tests.id('c4_l2'), 'qty', 2),
  jsonb_build_object('order_item_id', (select id from public.order_items where order_id = tests.id('c4_y')), 'lot_id', tests.id('c4_l1'), 'qty', 2))) ->> 'status'"
race "$A" "$B"
has "c4: A aplica" "^applied$" "$T/a.out"
has "c4: B (orden inverso de lotes) aplica sin deadlock" "^applied$" "$T/b.out"
check "c4: ambos lotes 10 → 6" "select (select quantity from public.lots where id = tests.id('c4_l1')) = 6 and (select quantity from public.lots where id = tests.id('c4_l2')) = 6"

# ---------------------------------------------------------------- 5) venta POS con el mismo order_id en paralelo
sql "do \$\$ declare v_p uuid := tests.product(120); v_l uuid; begin
  v_l := tests.stock(v_p, 'CC5', 10);
  insert into tests.ctx values ('c5_pos', tests.user('pos')), ('c5_p', v_p), ('c5_l', v_l), ('c5_o', gen_random_uuid());
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('c5_pos')); select public.vender_pos(tests.id('c5_o'), 'POS-CC5', 1, 'efectivo', null, '{}',
  jsonb_build_array(jsonb_build_object('product_id', tests.id('c5_p'), 'qty', 3)),
  jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', tests.id('c5_l'), 'qty', 3)))"
race "$CMD" "$CMD"
has "c5: A ⇒ true" "^t$" "$T/a.out"
has "c5: B (reintento en paralelo) ⇒ true, idempotente" "^t$" "$T/b.out"
check "c5: una venta, stock descontado una vez (10 → 7)" "select (select count(*) from public.orders where id = tests.id('c5_o')) = 1 and (select quantity from public.lots where id = tests.id('c5_l')) = 7"

# ---------------------------------------------------------------- 6) devoluciones en paralelo contra el mismo tope
sql "do \$\$ declare v_p uuid := tests.product(); v_l uuid; v_o uuid; begin
  v_l := tests.stock(v_p, 'CC6', 10);
  v_o := tests.packed_order(tests.user('doctor'), jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 5)));
  perform tests.force_status(v_o, 'delivered');
  insert into tests.ctx values ('c6_wh', tests.user('warehouse')), ('c6_l', v_l), ('c6_o', v_o);
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('c6_wh')); select public.recibir_devolucion(gen_random_uuid(), tests.id('c6_o'), jsonb_build_array(jsonb_build_object('lot_id', tests.id('c6_l'), 'qty', 3, 'inspection', 'ok'))) ->> 'status'"
race "$CMD" "$CMD"
has "c6: B ⇒ DEVOLUCION_EXCEDE_SURTIDO (3 + 3 > 5)" "DEVOLUCION_EXCEDE_SURTIDO" "$T/b.out"
check "c6: devuelto total 3 ≤ surtido 5" "select sum(qty) = 3 from public.stock_return_lines where order_id = tests.id('c6_o')"

# ---------------------------------------------------------------- 7) disposición doble de la misma línea
sql "do \$\$ declare v_p uuid := tests.product(); v_l uuid; v_o uuid; v_wh uuid := tests.user('warehouse'); v_r jsonb; begin
  v_l := tests.stock(v_p, 'CC7', 10);
  v_o := tests.packed_order(tests.user('doctor'), jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 4)));
  perform tests.force_status(v_o, 'delivered');
  perform set_config('request.jwt.claims', json_build_object('sub', v_wh, 'role', 'authenticated')::text, true);
  v_r := public.recibir_devolucion(gen_random_uuid(), v_o, jsonb_build_array(jsonb_build_object('lot_id', v_l, 'qty', 2, 'inspection', 'ok')));
  insert into tests.ctx values ('c7_admin', tests.user('admin')), ('c7_l', v_l),
    ('c7_line', (select id from public.stock_return_lines where return_id = (v_r ->> 'return_id')::uuid));
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('c7_admin')); select public.disponer_devolucion(gen_random_uuid(), jsonb_build_array(jsonb_build_object('line_id', tests.id('c7_line'), 'disposition', 'vendible'))) ->> 'status'"
race "$CMD" "$CMD"
has "c7: B ⇒ LINEA_YA_DISPUESTA" "LINEA_YA_DISPUESTA" "$T/b.out"
check "c7: un solo reingreso (6 + 2 = 8)" "select quantity = 8 from public.lots where id = tests.id('c7_l')"
check "c7: un solo movimiento para la línea" "select count(*) = 1 from public.inventory_movements where return_line_id = tests.id('c7_line')"

# ---------------------------------------------------------------- 8) cancelar vs crear guía (ambos órdenes)
sql "do \$\$ declare v_p uuid := tests.product(); v_d uuid := tests.user('doctor'); begin
  perform tests.stock(v_p, 'CC8', 20);
  insert into tests.ctx values ('c8_admin', tests.user('admin')),
    ('c8_a', tests.packed_order(v_d, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)))),
    ('c8_b', tests.packed_order(v_d, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1))));
end \$\$;" >/dev/null
race "select tests.act_as(tests.id('c8_admin')); select public.cancelar_pedido(gen_random_uuid(), tests.id('c8_a'), 'carrera') ->> 'status'" \
     "select tests.act_as_service(); insert into public.shipping_attempts(order_id, idempotency_key, status) values (tests.id('c8_a'), 'cc8a', 'pending')"
has "c8a: cancelación primero ⇒ la guía en paralelo se rechaza (PEDIDO_CANCELADO)" "PEDIDO_CANCELADO" "$T/b.out"
check "c8a: no quedó intento de guía sobre el pedido cancelado" "select count(*) = 0 from public.shipping_attempts where order_id = tests.id('c8_a')"
race "select tests.act_as_service(); insert into public.shipping_attempts(order_id, idempotency_key, status) values (tests.id('c8_b'), 'cc8b', 'pending')" \
     "select tests.act_as(tests.id('c8_admin')); select public.cancelar_pedido(gen_random_uuid(), tests.id('c8_b'), 'carrera') ->> 'status'"
has "c8b: guía primero ⇒ la cancelación en paralelo se bloquea (GUIA_ACTIVA)" "GUIA_ACTIVA" "$T/b.out"
check "c8b: el pedido sigue empacado" "select status = 'packed' from public.orders where id = tests.id('c8_b')"

# ---------------------------------------------------------------- 9) confirmación doble del reingreso
sql "do \$\$ declare v_p uuid := tests.product(); v_l uuid; v_o uuid; v_r jsonb; v_admin uuid := tests.user('admin'); begin
  v_l := tests.stock(v_p, 'CC9', 10);
  v_o := tests.packed_order(tests.user('doctor'), jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 3)));
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_r := public.cancelar_pedido(gen_random_uuid(), v_o, 'carrera de reingreso');
  insert into tests.ctx values ('c9_wh', tests.user('warehouse')), ('c9_l', v_l), ('c9_ret', (v_r ->> 'return_id')::uuid);
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('c9_wh')); select public.confirmar_reingreso(gen_random_uuid(), tests.id('c9_ret'), (select jsonb_agg(jsonb_build_object('line_id', id, 'estado', 'ok')) from public.stock_return_lines where return_id = tests.id('c9_ret'))) ->> 'status'"
race "$CMD" "$CMD"
has "c9: B ⇒ rechazo (reingreso ya confirmado)" "REINGRESO_YA_CONFIRMADO\|REINGRESO_INCOMPLETO" "$T/b.out"
check "c9: reingreso exactamente una vez (7 → 10)" "select quantity = 10 from public.lots where id = tests.id('c9_l')"

# ---------------------------------------------------------------- conciliación global tras las carreras
check "global: conciliación sin errores tras todas las carreras" "select count(*) = 0 from (select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role_id = 'admin' limit 1), 'role', 'authenticated')::text, true)) s, public.conciliar_inventario() c where c.severidad = 'error'"

exit $FAILED
