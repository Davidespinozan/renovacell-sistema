#!/usr/bin/env bash
# ============================================================================
# W2 · Concurrencia REAL del dinero: dos sesiones en paralelo. La sesión A retiene
# sus locks (pg_sleep antes del COMMIT) y la B arranca dentro de esa ventana.
# Se verifica el estado CONFIRMADO en la BD, no la salida.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
sql()   { "${P[@]}" -v ON_ERROR_STOP=1 -c "$1"; }
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
has()   { if grep -q "$2" "$3"; then echo "PASS: $1"; else echo "FAIL: $1 (salida: $(tr '\n' ' ' < "$3" | cut -c1-200))"; FAILED=1; fi; }
race() {
  ("${P[@]}" -c "begin; $1; select pg_sleep(1.5); commit;" > "$T/a.out" 2>&1) &
  sleep 0.4
  ("${P[@]}" -c "begin; $2; commit;" > "$T/b.out" 2>&1) &
  wait
}

# ── 1) Verificar la MISMA declaración dos veces en paralelo
sql "do \$\$ declare v_p uuid := tests.product(); v_doc uuid := tests.user('doctor'); v_o uuid; begin
  perform tests.stock(v_p, 'W2C-1', 20);
  v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  insert into tests.ctx values ('m1_bill', tests.user('billing')), ('m1_o', v_o), ('m1_claim', tests.reportar(v_o));
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('m1_bill')); select public.revisar_pago(gen_random_uuid(), tests.id('m1_claim'), 'verificar') ->> 'status'"
race "$CMD" "$CMD"
has "m1: A verifica la declaración" "^applied$" "$T/a.out"
has "m1: B en paralelo NO vuelve a verificar" "already_verified\|DECLARACION_YA_RESUELTA\|already_applied" "$T/b.out"
check "m1: UN solo asiento por la declaración" "select count(*) = 1 from public.payment_entries where order_id = tests.id('m1_o')"
check "m1: cobrado_neto = 200 (no 400)" "select cobrado_neto = 200 from public.v_order_money where order_id = tests.id('m1_o')"

# ── 2) Mismo op_id de cobro en paralelo
sql "do \$\$ declare v_p uuid := tests.product(); v_o uuid; begin
  perform tests.stock(v_p, 'W2C-2', 20);
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 3)));
  insert into tests.ctx values ('m2_bill', tests.user('billing')), ('m2_o', v_o), ('m2_op', gen_random_uuid());
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('m2_bill')); select public.registrar_cobro(tests.id('m2_op'), tests.id('m2_o'), 'transferencia', 300) ->> 'status'"
race "$CMD" "$CMD"
has "m2: A aplica el cobro" "^applied$" "$T/a.out"
has "m2: B con el mismo op_id ⇒ already_applied" "^already_applied$" "$T/b.out"
check "m2: el dinero entró UNA vez (300, no 600)" "select cobrado_neto = 300 from public.v_order_money where order_id = tests.id('m2_o')"
check "m2: un solo asiento y una sola operación" "select (select count(*) from public.payment_entries where order_id = tests.id('m2_o')) = 1 and (select count(*) from public.money_operations where op_id = tests.id('m2_op')) = 1"

# ── 3) Pagar el MISMO reembolso dos veces en paralelo (F-6)
sql "do \$\$ declare v_p uuid := tests.product(); v_o uuid; v_admin uuid := tests.user('admin'); v_ref uuid; begin
  perform tests.stock(v_p, 'W2C-3', 20);
  v_o := tests.order(tests.user('doctor'), 'delivered', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)), 'paid');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_ref := (public.autorizar_reembolso(gen_random_uuid(), v_o, 'devolucion', 100, 'concurrencia') ->> 'refund_id')::uuid;
  insert into tests.ctx values ('m3_admin', v_admin), ('m3_o', v_o), ('m3_ref', v_ref);
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('m3_admin')); select public.pagar_reembolso(gen_random_uuid(), tests.id('m3_ref'), 'transferencia') ->> 'status'"
race "$CMD" "$CMD"
has "m3: B no paga el reembolso por segunda vez" "REEMBOLSO_YA_PAGADO\|uq_entry_refund_pagado\|duplicate key" "$T/b.out"
check "m3: F-6 un solo egreso por reembolso" "select count(*) = 1 from public.payment_entries where refund_id = tests.id('m3_ref') and reversal_of is null"
check "m3: cobrado_neto = 100 (200 − 100)" "select cobrado_neto = 100 from public.v_order_money where order_id = tests.id('m3_o')"

# ── 4) Cobro concurrente con la CANCELACIÓN del pedido (F-9)
sql "do \$\$ declare v_p uuid := tests.product(); v_o uuid; begin
  perform tests.stock(v_p, 'W2C-4', 20);
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  insert into tests.ctx values ('m4_admin', tests.user('admin')), ('m4_o', v_o);
end \$\$;" >/dev/null
race "select tests.act_as(tests.id('m4_admin')); select public.cancelar_pedido(gen_random_uuid(), tests.id('m4_o'), 'carrera') ->> 'status'" \
     "select tests.act_as(tests.id('m4_admin')); select public.registrar_cobro(gen_random_uuid(), tests.id('m4_o'), 'transferencia', 100) ->> 'status'"
has "m4: la cancelación aplica" "^applied$" "$T/a.out"
has "m4: F-9 el cobro que llegó igual se REGISTRA" "^applied$" "$T/b.out"
check "m4: queda como excepción, no como dinero perdido" "select count(*) = 1 from (select set_config('request.jwt.claims', json_build_object('sub', tests.id('m4_admin'), 'role', 'authenticated')::text, true)) s, public.conciliar_dinero() c where c.check_id = 'D5_cancelado_con_dinero' and c.entidad_id = tests.id('m4_o')"

# ── 5) Autorizar crédito mientras Almacén intenta surtir
sql "do \$\$ declare v_p uuid := tests.product(); v_o uuid; begin
  perform tests.stock(v_p, 'W2C-5', 20);
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  insert into tests.ctx values ('m5_admin', tests.user('admin')), ('m5_wh', tests.user('warehouse')), ('m5_o', v_o);
end \$\$;" >/dev/null
race "select tests.act_as(tests.id('m5_admin')); select public.autorizar_credito(gen_random_uuid(), tests.id('m5_o'), public.hoy_local() + 30, 'carrera') ->> 'status'" \
     "select tests.act_as(tests.id('m5_wh')); select public.surtir_pedido(gen_random_uuid(), tests.id('m5_o'), tests.alloc(tests.id('m5_o'))) ->> 'status'"
has "m5: el crédito se autoriza" "^applied$" "$T/a.out"
has "m5: surtir espera el lock y decide con el estado REAL" "applied\|PEDIDO_NO_LIBERADO" "$T/b.out"
check "m5: si se surtió, fue con crédito y sin falsificar el pago" "select case when (select status from public.orders where id = tests.id('m5_o')) = 'packed' then (select payment_status = 'pending' from public.orders where id = tests.id('m5_o')) else true end"
check "m5: nunca se inventó un asiento de dinero" "select count(*) = 0 from public.payment_entries where order_id = tests.id('m5_o')"

# ── 6) Dos cobros con el MISMO external_ref (webhook duplicado de Stripe)
sql "do \$\$ declare v_p uuid := tests.product(); v_o uuid; begin
  perform tests.stock(v_p, 'W2C-6', 20);
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  insert into tests.ctx values ('m6_bill', tests.user('billing')), ('m6_o', v_o);
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('m6_bill')); select public.registrar_cobro(gen_random_uuid(), tests.id('m6_o'), 'stripe', 100, null, 'pi_DUPLICADO') ->> 'status'"
race "$CMD" "$CMD"
has "m6: el segundo evento con el mismo external_ref se rechaza" "uq_entry_external_ref\|duplicate key" "$T/b.out"
check "m6: un solo asiento por referencia del proveedor" "select count(*) = 1 from public.payment_entries where external_ref = 'pi_DUPLICADO'"

# ── 7) D-W2-CASH-CUTOFF · dos cortes SIMULTÁNEOS del mismo alcance
# Ambas sesiones leen el mismo límite vigente y quieren reclamar el tramo siguiente.
# Solo una puede: el cerrojo de aviso serializa y el índice de cadena es el respaldo.
sql "do \$\$ declare v_p uuid := tests.product(); v_o uuid; begin
  perform tests.stock(v_p, 'W2C-7', 20);
  v_o := tests.order(tests.user('doctor'), 'delivered', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  insert into tests.ctx values ('m7_bill', tests.user('billing')), ('m7_o', v_o);
  perform tests.act_as(tests.user('billing'));
  perform public.registrar_cobro(gen_random_uuid(), v_o, 'efectivo', 100);
  perform tests.act_as_owner();
end \$\$;" >/dev/null
CMD="select tests.act_as(tests.id('m7_bill')); select public.registrar_corte_caja(gen_random_uuid(), public.hoy_local(), 'dia', 0, 100) ->> 'esperado'"
race "$CMD" "$CMD"
has "m7: A cierra el tramo con el esperado del servidor" "^100$" "$T/a.out"
has "m7: B en paralelo NO vuelve a arquear el mismo efectivo" "MOTIVO_REQUERIDO\|uq_cierre_cadena\|TRAMO_VACIO\|deadlock" "$T/b.out"
check "m7: UN solo corte vigente del día" "select count(*) = 1 from public.cash_closings where alcance = 'dia' and voids_closing_id is null"
check "m7: el efectivo se arqueó UNA vez (100, no 200)" "select coalesce(sum(esperado), 0) = 100 from public.cash_closings where alcance = 'dia'"
check "m7: ningún tramo traslapado tras la carrera" "select count(*) = 0 from public.cash_closings a, public.cash_closings b where a.id <> b.id and a.alcance = b.alcance and a.cajero is not distinct from b.cajero and a.voids_closing_id is null and b.voids_closing_id is null and a.corte_desde < b.corte_hasta and b.corte_desde < a.corte_hasta"
check "m7: la cadena quedó lineal (ningún predecesor repetido)" "select count(*) = 0 from public.cash_closings a join public.cash_closings b on a.prev_closing_id = b.prev_closing_id and a.id <> b.id where a.prev_closing_id is not null"

# ── conciliación global tras las carreras
check "global: sin errores de conciliación de dinero tras las carreras" "select count(*) = 0 from (select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role_id = 'admin' limit 1), 'role', 'authenticated')::text, true)) s, public.conciliar_dinero() c where c.severidad = 'error'"

exit $FAILED
