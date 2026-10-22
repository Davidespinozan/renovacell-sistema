#!/usr/bin/env bash
# ============================================================================
# CS-1A.5 · Concurrencia REAL (sesiones psql en paralelo) del camino de cobro:
#   A. 5 "pagar" simultáneos del mismo intento (authz_sent) → exactamente 1 applied, 4 already (una sola llamada al banco).
#   B. 5 contabilizaciones simultáneas del mismo intento captured → 1 asiento, 1 'posted' nuevo + 4 'already_posted'.
#   C. contabilizar ∥ cobro manual con la misma referencia → 1 asiento (ledger) y el intento posted/enlazado.
#   D. desconocido ∥ cobros de otros canales → 0 asientos ajenos mientras la reserva se conserva.
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

"${P[@]}" -c "do \$\$ declare dr uuid := tests.user('doctor'); ad uuid := tests.user('admin'); p uuid := tests.product(100); o uuid; a uuid; k text; begin
  delete from tests.ctx where key like 'cs5_%';
  insert into tests.ctx values ('cs5_doc', dr), ('cs5_adm', ad);
  foreach k in array array['a','b','c','d'] loop
    o := tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 50)));   -- 5,000
    perform tests.act_as(dr);
    a := (public.cs_intento_abrir(o, 'test') ->> 'attempt_id')::uuid;
    perform tests.act_as_service();
    perform public.cs_intento_avanzar(a, 'tokenized'); perform public.cs_intento_avanzar(a, 'auth_setup'); perform public.cs_intento_avanzar(a, 'auth_pending');
    perform public.cs_intento_avanzar(a, 'auth_validated', '$A3DS'::jsonb);
    insert into tests.ctx values ('cs5_o' || k, o), ('cs5_i' || k, a);
  end loop;
  -- B y C: ya enviados, autorizados y capturados
  perform public.cs_intento_avanzar(tests.id('cs5_ib'), 'authz_sent'); perform public.cs_intento_avanzar(tests.id('cs5_ib'), 'authorized', '{\"cs_payment_id\":\"PAY-CONC-B\"}'); perform public.cs_intento_avanzar(tests.id('cs5_ib'), 'captured');
  perform public.cs_intento_avanzar(tests.id('cs5_ic'), 'authz_sent'); perform public.cs_intento_avanzar(tests.id('cs5_ic'), 'authorized', '{\"cs_payment_id\":\"PAY-CONC-C\"}'); perform public.cs_intento_avanzar(tests.id('cs5_ic'), 'captured');
  -- D: desconocido
  perform public.cs_intento_avanzar(tests.id('cs5_id'), 'authz_sent'); perform public.cs_intento_avanzar(tests.id('cs5_id'), 'unknown_requires_reconciliation', '{\"error\":\"timeout\"}');
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-240)"; exit 1; }

# ── A) 5 "pagar" simultáneos = 5 authz_sent
for i in 1 2 3 4 5; do ("${P[@]}" -c "$SVC select public.cs_intento_avanzar(tests.id('cs5_ia'), 'authz_sent') ->> 'status'" > "$T/a$i.out" 2>&1) & done; wait
nodead "$T"/a*.out && echo "PASS: A · 5 envíos simultáneos sin deadlock"
check "A · exactamente 1 applied y 4 already (una sola llamada al banco)" "select $(cat "$T"/a*.out | grep -c '^applied$') = 1 and $(cat "$T"/a*.out | grep -c '^already$') = 4"
check "A · el intento quedó en authz_sent con sello de envío" "select status = 'authz_sent' and cs_request_sent_at is not null from public.card_payment_attempts where id = tests.id('cs5_ia')"

# ── B) 5 contabilizaciones simultáneas
for i in 1 2 3 4 5; do ("${P[@]}" -c "$SVC select public.cs_intento_contabilizar(tests.id('cs5_ib')) ->> 'status'" > "$T/b$i.out" 2>&1) & done; wait
nodead "$T"/b*.out && echo "PASS: B · 5 contabilizaciones sin deadlock"
check "B · UN asiento" "select count(*) = 1 from public.payment_entries where external_ref = 'PAY-CONC-B'"
check "B · 1 posted + 4 already_posted" "select $(cat "$T"/b*.out | grep -c '^posted$') = 1 and $(cat "$T"/b*.out | grep -c '^already_posted$') = 4"
check "B · pedido pagado sin sobrepago" "select estado_pago = 'paid' and not sobrepago from public.v_order_money where order_id = tests.id('cs5_ob')"

# ── C) contabilizar ∥ registro manual con la misma referencia
for i in 1 2 3; do ("${P[@]}" -c "$SVC select public.cs_intento_contabilizar(tests.id('cs5_ic')) ->> 'status'" > "$T/cc$i.out" 2>&1) & done
for i in 1 2; do ("${P[@]}" -c "$(as cs5_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs5_oc'), 'tarjeta', 5000, null, 'PAY-CONC-C') ->> 'status'" > "$T/cm$i.out" 2>&1) & done
wait
nodead "$T"/cc*.out "$T"/cm*.out && echo "PASS: C · contabilizar ∥ manual sin deadlock"
check "C · UN asiento con la referencia" "select count(*) = 1 from public.payment_entries where external_ref = 'PAY-CONC-C'"
check "C · intento posted y enlazado" "select status = 'posted' and entry_id = (select id from public.payment_entries where external_ref = 'PAY-CONC-C') from public.card_payment_attempts where id = tests.id('cs5_ic')"

# ── D) desconocido ∥ otros canales
for i in 1 2 3 4; do ("${P[@]}" -c "$(as cs5_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs5_od'), 'efectivo', 1000) ->> 'status'" > "$T/d$i.out" 2>&1) & done; wait
nodead "$T"/d*.out && echo "PASS: D · cobros contra desconocido sin deadlock"
check "D · 0 asientos: la reserva del desconocido se conserva" "select count(*) = 0 from public.payment_entries where order_id = tests.id('cs5_od')"
check "D · 4 RESERVA_ACTIVA" "select $(cat "$T"/d*.out | grep -c 'RESERVA_ACTIVA') = 4"

"${P[@]}" -c "delete from tests.ctx where key like 'cs5_%'" >/dev/null
exit $FAILED
