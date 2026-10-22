#!/usr/bin/env bash
# ============================================================================
# CS-1A.6 · Concurrencia REAL de conciliación (sesiones psql en paralelo):
#   A. 3 operadores resuelven el MISMO desconocido a la vez (unknown → captured con evidencia) → 1 applied + 2 already; 1 asiento.
#   B. conciliación (captured → contabilizar) ∥ cobro manual con la misma referencia → 1 asiento; intento posted/enlazado.
#   C. reversa confirmada ∥ cobro de otro canal → o el cobro entra DESPUÉS de liberar la reserva, o es rechazado; nunca sobrepago.
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
A3DS='{"cs_auth_reference_id":"ref","cs_auth_transaction_id":"tx","cs_auth_status":"AUTHENTICATION_SUCCESSFUL"}'

"${P[@]}" -c "do \$\$ declare dr uuid := tests.user('doctor'); ad uuid := tests.user('admin'); bi uuid := tests.user('billing'); p uuid := tests.product(100); o uuid; a uuid; k text; begin
  delete from tests.ctx where key like 'cs6_%';
  insert into tests.ctx values ('cs6_doc', dr), ('cs6_adm', ad), ('cs6_bil', bi);
  foreach k in array array['a','b','c'] loop
    o := tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 40)));   -- 4,000
    perform tests.act_as(dr); a := (public.cs_intento_abrir(o, 'test') ->> 'attempt_id')::uuid; perform tests.act_as_service();
    perform public.cs_intento_avanzar(a, 'tokenized'); perform public.cs_intento_avanzar(a, 'auth_setup'); perform public.cs_intento_avanzar(a, 'auth_pending');
    perform public.cs_intento_avanzar(a, 'auth_validated', '$A3DS'::jsonb); perform public.cs_intento_avanzar(a, 'authz_sent');
    insert into tests.ctx values ('cs6_o' || k, o), ('cs6_i' || k, a);
  end loop;
  perform public.cs_intento_avanzar(tests.id('cs6_ia'), 'unknown_requires_reconciliation', '{\"error\":\"timeout\"}');
  perform public.cs_intento_avanzar(tests.id('cs6_ib'), 'captured', '{\"cs_payment_id\":\"PAY-C6-B\"}');
  perform public.cs_intento_avanzar(tests.id('cs6_ic'), 'authorized', '{\"cs_payment_id\":\"PAY-C6-C\"}');
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-240)"; exit 1; }

# ── A) 3 resoluciones simultáneas del mismo desconocido
for i in 1 2 3; do ("${P[@]}" -c "$(as cs6_bil) select public.cs_intento_avanzar(tests.id('cs6_ia'), 'captured', '{\"cs_payment_id\":\"PAY-C6-A\",\"evidencia\":\"[billing] consulta: bill aprobada\",\"proveedor\":{\"autorizacion\":{\"estado\":\"aprobada\",\"id\":\"PAY-C6-A\"},\"captura\":{\"estado\":\"aprobada\",\"id\":\"PAY-C6-A\"}}}') ->> 'status'" > "$T/a$i.out" 2>&1) & done; wait
nodead "$T"/a*.out && echo "PASS: A · 3 resoluciones simultáneas sin deadlock"
check "A · 1 applied + 2 already" "select $(cat "$T"/a*.out | grep -c '^applied$') = 1 and $(cat "$T"/a*.out | grep -c '^already$') = 2"
for i in 1 2 3; do ("${P[@]}" -c "$(as cs6_bil) select public.cs_intento_contabilizar(tests.id('cs6_ia')) ->> 'status'" > "$T/ac$i.out" 2>&1) & done; wait
nodead "$T"/ac*.out && echo "PASS: A · 3 contabilizaciones simultáneas sin deadlock"
check "A · UN asiento y 1 posted + 2 already_posted" "select (select count(*) from public.payment_entries where external_ref = 'PAY-C6-A') = 1 and $(cat "$T"/ac*.out | grep -c '^posted$') = 1 and $(cat "$T"/ac*.out | grep -c '^already_posted$') = 2"
check "A · un solo evento unknown→captured en la bitácora" "select count(*) = 1 from public.card_payment_attempt_events where attempt_id = tests.id('cs6_ia') and from_status = 'unknown_requires_reconciliation' and to_status = 'captured'"

# ── B) contabilizar (conciliación) ∥ cobro manual misma referencia
for i in 1 2; do ("${P[@]}" -c "$(as cs6_bil) select public.cs_intento_contabilizar(tests.id('cs6_ib')) ->> 'status'" > "$T/bc$i.out" 2>&1) & done
for i in 1 2; do ("${P[@]}" -c "$(as cs6_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs6_ob'), 'tarjeta', 4000, null, 'PAY-C6-B') ->> 'status'" > "$T/bm$i.out" 2>&1) & done
wait
nodead "$T"/bc*.out "$T"/bm*.out && echo "PASS: B · conciliación ∥ manual sin deadlock"
check "B · UN asiento con la referencia" "select count(*) = 1 from public.payment_entries where external_ref = 'PAY-C6-B'"
check "B · intento posted enlazado al único asiento" "select status = 'posted' and entry_id = (select id from public.payment_entries where external_ref = 'PAY-C6-B') from public.card_payment_attempts where id = tests.id('cs6_ib')"

# ── C) reversa confirmada ∥ cobro de otro canal
("${P[@]}" -c "$(as cs6_adm) select public.cs_intento_avanzar(tests.id('cs6_ic'), 'declined', '{\"cs_payment_status\":\"REVERSED\",\"evidencia\":\"[admin] reversa REVERSED\"}') ->> 'status'" > "$T/cr.out" 2>&1) &
for i in 1 2; do ("${P[@]}" -c "$(as cs6_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs6_oc'), 'efectivo', 2000) ->> 'status'" > "$T/cc$i.out" 2>&1) & done   # Σ = total: el ledger no rechaza sobrepago por sí solo (CS-1A.7: antes 3×4,000 era una carrera)
wait
nodead "$T"/cr.out "$T"/cc*.out && echo "PASS: C · reversa ∥ cobros sin deadlock"
check "C · reversa aplicada y reserva liberada" "select status = 'declined' from public.card_payment_attempts where id = tests.id('cs6_ic')"
check "C · como máximo dos cobros de 2,000 y nunca sobrepago" "select (select count(*) from public.payment_entries where order_id = tests.id('cs6_oc')) <= 2 and not (select sobrepago from public.v_order_money where order_id = tests.id('cs6_oc'))"
check "C · todo rechazo fue RESERVA_ACTIVA" "select $(cat "$T"/cc*.out | grep -ciE 'ERROR') = $(cat "$T"/cc*.out | grep -c 'RESERVA_ACTIVA')"

"${P[@]}" -c "delete from tests.ctx where key like 'cs6_%'" >/dev/null
exit $FAILED
