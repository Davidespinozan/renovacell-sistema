#!/usr/bin/env bash
# ============================================================================
# CS-1A.1b (185) · Concurrencia REAL (sesiones psql independientes en paralelo, timeouts controlados).
#   A. abrir intento ∥ 4 cobros de 2,500 de otros canales sobre el MISMO pedido → nunca cobrado_neto + reservas > total.
#   B. 5 cobros parciales a la vez contra un pedido con reserva total → 0 asientos, 5 RESERVA_ACTIVA.
#   C. 5 aperturas de intento a la vez → 1 created, 4 existing (mismo id).
#   D. contabilizar ∥ registro manual con la misma referencia → UN asiento; el intento queda posted.
#   E. DEADLOCK: revisar_pago (pedido → declaración) ∥ cs_intento_abrir ∥ registrar_cobro, 3 rondas → sin deadlock.
#   F. vender_pos (crea su pedido) ∥ aperturas de intento en otros pedidos → sin deadlock ni error.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
nodead() { if grep -qiE 'deadlock|lock_timeout|statement_timeout|canceling' "$@"; then echo "FAIL: interbloqueo/timeout: $(cat "$@" | tr '\n' ' ' | cut -c1-220)"; FAILED=1; return 1; fi; return 0; }
TO="set lock_timeout = '15s'; set statement_timeout = '30s';"
as() { echo "$TO select tests.act_as(tests.id('$1'));"; }
SVC="$TO select tests.act_as_service();"

"${P[@]}" -c "do \$\$ declare dr uuid := tests.user('doctor'); ad uuid := tests.user('admin'); bi uuid := tests.user('billing'); po uuid := tests.user('pos'); p uuid := tests.product(100); i int; begin
  delete from tests.ctx where key like 'cs1b_%';
  perform tests.stock(p, 'CS1B-C', 500);
  insert into tests.ctx values ('cs1b_doc', dr), ('cs1b_adm', ad), ('cs1b_bil', bi), ('cs1b_pos', po), ('cs1b_prod', p);
  for i in 1..6 loop
    insert into tests.ctx values ('cs1b_a' || i, tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 100))));   -- 10,000
  end loop;
  insert into tests.ctx values ('cs1b_b', tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 100))));
  insert into tests.ctx values ('cs1b_c', tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 100))));
  insert into tests.ctx values ('cs1b_d', tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 100))));
  for i in 1..3 loop
    insert into tests.ctx values ('cs1b_e' || i, tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 100))));
  end loop;
  for i in 1..3 loop
    insert into tests.ctx values ('cs1b_f' || i, tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 100))));
  end loop;
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-200)"; exit 1; }

# ── A) abrir intento ∥ cobros de otros canales (6 pedidos, ambos órdenes de llegada posibles)
for k in 1 2 3 4 5 6; do
  ("${P[@]}" -c "$(as cs1b_doc) select public.cs_intento_abrir(tests.id('cs1b_a$k'), 'test') ->> 'status'" > "$T/ai$k.out" 2>&1) &
  for j in 1 2; do ("${P[@]}" -c "$(as cs1b_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs1b_a$k'), 'efectivo', 2500) ->> 'status'" > "$T/ac$k$j.out" 2>&1) & done
  for j in 3 4; do ("${P[@]}" -c "$(as cs1b_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs1b_a$k'), 'transferencia', 2500) ->> 'status'" > "$T/ac$k$j.out" 2>&1) & done   # Σ = total: sin reservas nunca hay sobrepago; con reserva, lo que sobre se rechaza
done; wait
nodead "$T"/ai*.out "$T"/ac*.out && echo "PASS: A · apertura ∥ cobros sin deadlock ni timeout"
check "A · INVARIANTE en los 6 pedidos: cobrado_neto + reservas activas ≤ total" "select bool_and(d.cobrado_neto + d.reservas_activas <= d.total) from public.v_order_disponible d where d.order_id in (select val from tests.ctx where key like 'cs1b_a%')"
check "A · toda reserva creada = saldo vigente al abrir (nunca mayor que total − cobrado)" "select bool_and(a.amount <= d.total - d.cobrado_neto or not public._cs_estado_activo(a.status)) from public.card_payment_attempts a join public.v_order_disponible d on d.order_id = a.order_id where a.order_id in (select val from tests.ctx where key like 'cs1b_a%')"
check "A · cada rechazo fue RESERVA_ACTIVA o SIN_SALDO (nunca otro error)" "select $(cat "$T"/ai*.out "$T"/ac*.out | grep -ciE 'ERROR' ) = $(cat "$T"/ai*.out "$T"/ac*.out | grep -ciE 'RESERVA_ACTIVA|SIN_SALDO')"
check "A · ningún pedido con sobrepago" "select not bool_or(m.sobrepago) from public.v_order_money m where m.order_id in (select val from tests.ctx where key like 'cs1b_a%')"

# ── B) reserva total activa, 5 cobros parciales a la vez
"${P[@]}" -c "$(as cs1b_doc) select public.cs_intento_abrir(tests.id('cs1b_b'), 'test') ->> 'status'" > "$T/b0.out" 2>&1
for i in 1 2 3 4 5; do ("${P[@]}" -c "$(as cs1b_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs1b_b'), 'efectivo', 1000) ->> 'status'" > "$T/b$i.out" 2>&1) & done; wait
nodead "$T"/b*.out && echo "PASS: B · 5 cobros concurrentes contra reserva total sin deadlock"
check "B · 0 asientos" "select count(*) = 0 from public.payment_entries where order_id = tests.id('cs1b_b')"
check "B · 5 RESERVA_ACTIVA" "select $(cat "$T"/b1.out "$T"/b2.out "$T"/b3.out "$T"/b4.out "$T"/b5.out | grep -c 'RESERVA_ACTIVA') = 5"

# ── C) 5 aperturas simultáneas del mismo pedido
for i in 1 2 3 4 5; do ("${P[@]}" -c "$(as cs1b_doc) select public.cs_intento_abrir(tests.id('cs1b_c'), 'test') ->> 'status'" > "$T/c$i.out" 2>&1) & done; wait
nodead "$T"/c*.out && echo "PASS: C · 5 aperturas sin deadlock"
check "C · un solo intento" "select count(*) = 1 from public.card_payment_attempts where order_id = tests.id('cs1b_c')"
check "C · 1 created + 4 existing" "select $(cat "$T"/c*.out | grep -c '^created$') = 1 and $(cat "$T"/c*.out | grep -c '^existing$') = 4"

# ── D) contabilizar ∥ registro manual con la misma referencia
"${P[@]}" -c "$(as cs1b_doc) select public.cs_intento_abrir(tests.id('cs1b_d'), 'test') ->> 'attempt_id'" > "$T/d0.out" 2>&1
DID=$(tail -n1 "$T/d0.out")
"${P[@]}" -c "$SVC select public.cs_intento_avanzar('$DID','tokenized'); select public.cs_intento_avanzar('$DID','auth_setup'); select public.cs_intento_avanzar('$DID','auth_pending'); select public.cs_intento_avanzar('$DID','auth_validated'); select public.cs_intento_avanzar('$DID','authz_sent'); select public.cs_intento_avanzar('$DID','captured','{\"cs_payment_id\":\"PAY-CONC-D\"}') ->> 'status'" > "$T/d1.out" 2>&1
for i in 1 2 3; do ("${P[@]}" -c "$SVC select public.cs_intento_contabilizar('$DID') ->> 'status'" > "$T/dc$i.out" 2>&1) & done
for i in 1 2; do ("${P[@]}" -c "$(as cs1b_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs1b_d'), 'tarjeta', 10000, null, 'PAY-CONC-D') ->> 'status'" > "$T/dm$i.out" 2>&1) & done
wait
nodead "$T"/dc*.out "$T"/dm*.out && echo "PASS: D · contabilizar ∥ manual sin deadlock"
check "D · UN solo asiento con la referencia" "select count(*) = 1 from public.payment_entries where external_ref = 'PAY-CONC-D'"
check "D · el intento quedó posted y enlazado al asiento" "select a.status = 'posted' and a.entry_id = (select id from public.payment_entries where external_ref = 'PAY-CONC-D') from public.card_payment_attempts a where a.id = '$DID'"
check "D · pedido pagado sin sobrepago" "select estado_pago = 'paid' and not sobrepago from public.v_order_money where order_id = tests.id('cs1b_d')"

# ── E) revisar_pago (pedido → declaración) ∥ cs_intento_abrir ∥ registrar_cobro: sin deadlock, invariante
for k in 1 2 3; do
  CL=$("${P[@]}" -c "$(as cs1b_doc) select public.reportar_pago(gen_random_uuid(), tests.id('cs1b_e$k'), 'transferencia', 3000, 'E$k') ->> 'claim_id'" | tail -n1)
  ("${P[@]}" -c "$(as cs1b_bil) select public.revisar_pago(gen_random_uuid(), '$CL', 'verificar') ->> 'status'" > "$T/ev$k.out" 2>&1) &
  ("${P[@]}" -c "$(as cs1b_doc) select public.cs_intento_abrir(tests.id('cs1b_e$k'), 'test') ->> 'status'" > "$T/ei$k.out" 2>&1) &
  ("${P[@]}" -c "$(as cs1b_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs1b_e$k'), 'efectivo', 2000) ->> 'status'" > "$T/ec$k.out" 2>&1) &
done; wait
nodead "$T"/ev*.out "$T"/ei*.out "$T"/ec*.out && echo "PASS: E · tres canales a la vez, 3 rondas, sin deadlock"
check "E · invariante en los 3 pedidos" "select bool_and(d.cobrado_neto + d.reservas_activas <= d.total) from public.v_order_disponible d where d.order_id in (select val from tests.ctx where key like 'cs1b_e%')"
check "E · solo errores RESERVA_ACTIVA/SIN_SALDO" "select $(cat "$T"/ev*.out "$T"/ei*.out "$T"/ec*.out | grep -ciE 'ERROR') = $(cat "$T"/ev*.out "$T"/ei*.out "$T"/ec*.out | grep -ciE 'RESERVA_ACTIVA|SIN_SALDO')"

# ── F) vender_pos (crea su propio pedido y asiento) ∥ aperturas en otros pedidos
for k in 1 2 3; do
  ("${P[@]}" -c "$TO select tests.act_as_owner(); select tests.venta_pos(tests.id('cs1b_pos'), 150, 'efectivo')" > "$T/fv$k.out" 2>&1) &
  ("${P[@]}" -c "$(as cs1b_doc) select public.cs_intento_abrir(tests.id('cs1b_f$k'), 'test') ->> 'status'" > "$T/fi$k.out" 2>&1) &
done; wait
nodead "$T"/fv*.out "$T"/fi*.out && echo "PASS: F · ventas de mostrador ∥ aperturas sin deadlock"
check "F · 3 ventas POS pagadas y 3 intentos creados" "select (select count(*) from public.card_payment_attempts where order_id in (select val from tests.ctx where key like 'cs1b_f%') and status = 'created') = 3 and $(cat "$T"/fi*.out | grep -c '^created$') = 3 and $(grep -ciE 'ERROR' "$T"/fv*.out | awk -F: '{s+=$2} END {print s+0}') = 0"

"${P[@]}" -c "delete from tests.ctx where key like 'cs1b_%'" >/dev/null
exit $FAILED
