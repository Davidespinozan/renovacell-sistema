#!/usr/bin/env bash
# ============================================================================
# W2-C · Concurrencia REAL de la custodia: dos sesiones en paralelo. La sesión A
# retiene sus locks (pg_sleep antes del COMMIT) y la B arranca dentro de esa ventana.
# Se verifica el estado CONFIRMADO en la BD, no la salida.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
sql()   { "${P[@]}" -v ON_ERROR_STOP=1 -c "$1"; }
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
# grep -E: en BRE de BSD un `$` a media expresión es un carácter literal y la
# alternancia nunca empata. Con ERE el ancla funciona en cualquier posición.
has()   { if grep -Eq "$2" "$3"; then echo "PASS: $1"; else echo "FAIL: $1 (salida: $(tr '\n' ' ' < "$3" | cut -c1-200))"; FAILED=1; fi; }
race() {
  ("${P[@]}" -c "begin; $1; select pg_sleep(1.5); commit;" > "$T/a.out" 2>&1) &
  sleep 0.4
  ("${P[@]}" -c "begin; $2; commit;" > "$T/b.out" 2>&1) &
  wait
}

# Errores de conciliación que ya dejaron otras pruebas en esta misma base (p. ej. pedidos de prueba "entregados" sin
# kardex de W2): lo que se verifica aquí es que las carreras de custodia no agreguen ninguno.
INV0=$("${P[@]}" -c "select tests.conciliacion_errores()" | tail -1)

# ── 1) Dos ENTREGAS simultáneas del mismo lote: juntas exceden lo disponible
sql "do \$\$ declare v_p uuid := tests.product(); v_lot uuid; begin
  v_lot := tests.stock(v_p, 'W2CC-1', 10);
  insert into tests.ctx values ('w2cc1_wh', tests.user('warehouse')), ('w2cc1_lot', v_lot),
    ('w2cc1_a', tests.custodia('vendedor', tests.user('pos', 'c1a@test.local'))),
    ('w2cc1_b', tests.custodia('vendedor', tests.user('pos', 'c1b@test.local')));
end \$\$;" >/dev/null
race "select tests.act_as(tests.id('w2cc1_wh')); select public.entregar_custodia(gen_random_uuid(), tests.id('w2cc1_a'), jsonb_build_array(jsonb_build_object('lot_id', tests.id('w2cc1_lot'), 'qty', 7))) ->> 'status'" \
     "select tests.act_as(tests.id('w2cc1_wh')); select public.entregar_custodia(gen_random_uuid(), tests.id('w2cc1_b'), jsonb_build_array(jsonb_build_object('lot_id', tests.id('w2cc1_lot'), 'qty', 7))) ->> 'status'"
has "c1: A entrega 7" "^applied$" "$T/a.out"
has "c1: B en paralelo NO sobrecompromete el lote" "DISPONIBILIDAD_INSUFICIENTE|deadlock|could not serialize" "$T/b.out"
check "c1: en custodia 7, no 14" "select public.custody_held(tests.id('w2cc1_lot')) = 7"
check "c1: la existencia propia sigue intacta (10)" "select quantity = 10 from public.lots where id = tests.id('w2cc1_lot')"
check "c1: disponible 3" "select disponible = 3 from public.v_stock_disponible where lot_id = tests.id('w2cc1_lot')"

# ── 2) Mismo op_id de entrega en paralelo ⇒ una sola entrega
sql "do \$\$ declare v_p uuid := tests.product(); v_lot uuid; begin
  v_lot := tests.stock(v_p, 'W2CC-2', 10);
  insert into tests.ctx values ('w2cc2_wh', tests.user('warehouse')), ('w2cc2_lot', v_lot), ('w2cc2_op', gen_random_uuid()),
    ('w2cc2_cus', tests.custodia('vendedor', tests.user('pos', 'c2@test.local')));
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('w2cc2_wh')); select public.entregar_custodia(tests.id('w2cc2_op'), tests.id('w2cc2_cus'), jsonb_build_array(jsonb_build_object('lot_id', tests.id('w2cc2_lot'), 'qty', 4))) ->> 'status'"
race "$CMD" "$CMD"
has "c2: A aplica la entrega" "^applied$" "$T/a.out"
has "c2: B con el mismo op_id no entrega otra vez" "already_applied|duplicate key|custody_operations_pkey" "$T/b.out"
check "c2: en custodia 4, no 8" "select public.custody_held(tests.id('w2cc2_lot')) = 4"
check "c2: una sola operación registrada" "select count(*) = 1 from public.custody_operations where op_id = tests.id('w2cc2_op')"

# ── 3) VENTA de custodia y SURTIDO de almacén peleando por el mismo lote
sql "do \$\$ declare v_p uuid := tests.product(150); v_lot uuid; v_o uuid; v_pos uuid := tests.user('pos', 'c3@test.local'); begin
  v_lot := tests.stock(v_p, 'W2CC-3', 6);
  insert into tests.ctx values ('w2cc3_pos', v_pos), ('w2cc3_wh', tests.user('warehouse')), ('w2cc3_lot', v_lot),
    ('w2cc3_cus', tests.custodia('vendedor', v_pos));
  perform tests.entregar(tests.id('w2cc3_cus'), v_lot, 4);
  v_o := tests.order(tests.user('doctor'), 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  perform tests.cobrar(v_o);
  insert into tests.ctx values ('w2cc3_o', v_o), ('w2cc3_item', (select id from public.order_items where order_id = v_o));
end \$\$;" >/dev/null
race "select tests.act_as(tests.id('w2cc3_pos')); select public.vender_pos(gen_random_uuid(), 'POS-C3', 1, 'efectivo', null, '{}', jsonb_build_array(jsonb_build_object('product_id', (select product_id from public.lots where id = tests.id('w2cc3_lot')), 'qty', 4)), jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', tests.id('w2cc3_lot'), 'qty', 4)), false, null, null, null, tests.id('w2cc3_cus'))::text" \
     "select tests.act_as(tests.id('w2cc3_wh')); select public.surtir_pedido(gen_random_uuid(), tests.id('w2cc3_o'), jsonb_build_array(jsonb_build_object('order_item_id', tests.id('w2cc3_item'), 'lot_id', tests.id('w2cc3_lot'), 'qty', 2))) ->> 'status'"
has "c3: la venta de custodia se aplica" "^true$" "$T/a.out"
has "c3: el surtido en paralelo respeta lo que quedaba disponible" "^applied$|CUSTODIA_EN_PODER|INVENTARIO_INSUFICIENTE" "$T/b.out"
check "c3: la existencia nunca queda negativa" "select quantity >= 0 from public.lots where id = tests.id('w2cc3_lot')"
check "c3: la custodia nunca queda negativa" "select public.custody_held(tests.id('w2cc3_lot')) >= 0"
check "c3: existencia = Σ kardex (I-04 de W1)" "select tests.kardex_ok(tests.id('w2cc3_lot'))"

# ── 4) Dos VENTAS simultáneas del mismo saldo de custodia
sql "do \$\$ declare v_p uuid := tests.product(150); v_lot uuid; v_pos uuid := tests.user('pos', 'c4@test.local'); begin
  v_lot := tests.stock(v_p, 'W2CC-4', 10);
  insert into tests.ctx values ('w2cc4_pos', v_pos), ('w2cc4_lot', v_lot), ('w2cc4_prod', v_p),
    ('w2cc4_cus', tests.custodia('vendedor', v_pos));
  perform tests.entregar(tests.id('w2cc4_cus'), v_lot, 3);
end \$\$;" >/dev/null
VENTA="select tests.act_as(tests.id('w2cc4_pos')); select public.vender_pos(gen_random_uuid(), 'POS-C4', 1, 'efectivo', null, '{}', jsonb_build_array(jsonb_build_object('product_id', tests.id('w2cc4_prod'), 'qty', 3)), jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', tests.id('w2cc4_lot'), 'qty', 3)), false, null, null, null, tests.id('w2cc4_cus'))::text"
race "$VENTA" "$VENTA"
has "c4: A vende las 3 de su saldo" "^true$" "$T/a.out"
has "c4: B no vuelve a vender el mismo saldo" "CUSTODIA_SALDO_INSUFICIENTE|deadlock|could not serialize" "$T/b.out"
check "c4: el saldo de custodia quedó en 0, no en −3" "select public.custody_held(tests.id('w2cc4_lot')) = 0"
check "c4: se descontaron 3 unidades, no 6" "select quantity = 7 from public.lots where id = tests.id('w2cc4_lot')"
check "c4: un solo pedido de esa venta" "select count(*) = 1 from public.custody_lines where lot_id = tests.id('w2cc4_lot') and kind = 'venta'"

# ── 5) PÉRDIDA y DEVOLUCIÓN simultáneas del mismo saldo
sql "do \$\$ declare v_p uuid := tests.product(); v_lot uuid; v_pos uuid := tests.user('pos', 'c5@test.local'); begin
  v_lot := tests.stock(v_p, 'W2CC-5', 10);
  insert into tests.ctx values ('w2cc5_wh', tests.user('warehouse')), ('w2cc5_lot', v_lot),
    ('w2cc5_cus', tests.custodia('vendedor', v_pos));
  perform tests.entregar(tests.id('w2cc5_cus'), v_lot, 2);
end \$\$;" >/dev/null
race "select tests.act_as(tests.id('w2cc5_wh')); select public.registrar_perdida_custodia(gen_random_uuid(), tests.id('w2cc5_cus'), 'faltante', jsonb_build_array(jsonb_build_object('lot_id', tests.id('w2cc5_lot'), 'qty', 2)), 'conteo') ->> 'status'" \
     "select tests.act_as(tests.id('w2cc5_wh')); select public.devolver_de_custodia(gen_random_uuid(), tests.id('w2cc5_cus'), jsonb_build_array(jsonb_build_object('lot_id', tests.id('w2cc5_lot'), 'qty', 2, 'inspection', 'ok'))) ->> 'status'"
has "c5: la pérdida se aplica" "^applied$" "$T/a.out"
has "c5: la devolución en paralelo no duplica el saldo" "CUSTODIA_SALDO_INSUFICIENTE|deadlock|could not serialize|^applied$" "$T/b.out"
check "c5: el saldo no queda negativo" "select public.custody_held(tests.id('w2cc5_lot')) >= 0"
check "c5: existencia = Σ kardex" "select tests.kardex_ok(tests.id('w2cc5_lot'))"

# ── conciliación global tras las carreras
check "global: custodia sin errores de conciliación tras las carreras" "select count(*) = 0 from (select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role_id = 'admin' limit 1), 'role', 'authenticated')::text, true)) s, public.conciliar_custodia() c where c.severidad = 'error'"
check "global: las carreras de custodia no dejan errores nuevos de inventario" "select tests.conciliacion_errores() = $INV0"

exit $FAILED
