#!/usr/bin/env bash
# ============================================================================
# CS-1A.7 · Concurrencia REAL del cierre manual (sesiones psql en paralelo):
#   A. 3 operadores cierran el MISMO desconocido a la vez → 1 applied + 2 already; un solo evento de cierre.
#   B. cierre manual ∥ resolución a captured (otro operador encontró la transacción) → gana exactamente uno; nunca ambos.
#   C. cierre manual ∥ cobros de otro canal → o el cobro entra DESPUÉS de liberar la reserva, o es RESERVA_ACTIVA; nunca sobrepago.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
nodead() { if grep -qiE 'deadlock|lock_timeout|statement_timeout|canceling' "$@"; then echo "FAIL: interbloqueo/timeout: $(cat "$@" | tr '\n' ' ' | cut -c1-220)"; FAILED=1; return 1; fi; return 0; }
TO="set lock_timeout = '15s'; set statement_timeout = '30s';"
as() { echo "$TO select tests.act_as(tests.id('$1'));"; }
A3DS='{"cs_auth_reference_id":"ref","cs_auth_transaction_id":"tx","cs_auth_status":"AUTHENTICATION_SUCCESSFUL"}'
CONSULTA="jsonb_build_object('consultado_en', clock_timestamp(), 'por_id', '{\"realizada\":true,\"resultado\":\"no_encontrada\"}'::jsonb, 'por_referencia', '{\"realizada\":true,\"transacciones\":0}'::jsonb, 'business_center_revisado', true)"
CERRAR() { echo "select public.cs_intento_cerrar_manual(tests.id('$1'), 'Cliente y Business Center sin cargo; cierre tras 25 h', $CONSULTA) ->> 'status'"; }

"${P[@]}" -c "do \$\$ declare dr uuid := tests.user('doctor'); ad uuid := tests.user('admin'); bi uuid := tests.user('billing'); p uuid := tests.product(100); o uuid; a uuid; k text; begin
  delete from tests.ctx where key like 'cs7_%';
  insert into tests.ctx values ('cs7_doc', dr), ('cs7_adm', ad), ('cs7_bil', bi);
  foreach k in array array['a','b','c'] loop
    o := tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 10)));   -- 1,000
    perform tests.act_as(dr); a := (public.cs_intento_abrir(o, 'test') ->> 'attempt_id')::uuid; perform tests.act_as_service();
    perform public.cs_intento_avanzar(a, 'tokenized'); perform public.cs_intento_avanzar(a, 'auth_setup'); perform public.cs_intento_avanzar(a, 'auth_pending');
    perform public.cs_intento_avanzar(a, 'auth_validated', '$A3DS'::jsonb); perform public.cs_intento_avanzar(a, 'authz_sent');
    perform public.cs_intento_avanzar(a, 'authorized', jsonb_build_object('cs_payment_id', 'PAY-C7-' || k));
    perform public.cs_intento_avanzar(a, 'unknown_requires_reconciliation', '{\"error\":\"captura: timeout\"}');
    perform tests.act_as_owner();
    update public.card_payment_attempts set cs_request_sent_at = clock_timestamp() - interval '25 hours', status_at = clock_timestamp() - interval '25 hours' where id = a;
    insert into tests.ctx values ('cs7_o' || k, o), ('cs7_i' || k, a);
  end loop;
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-240)"; exit 1; }

# ── A) 3 cierres simultáneos del mismo desconocido
for i in 1 2 3; do ("${P[@]}" -c "$(as cs7_bil) $(CERRAR cs7_ia)" > "$T/a$i.out" 2>&1) & done; wait
nodead "$T"/a*.out && echo "PASS: A · 3 cierres simultáneos sin deadlock"
check "A · 1 applied + 2 already" "select $(cat "$T"/a*.out | grep -c '^applied$') = 1 and $(cat "$T"/a*.out | grep -c '^already$') = 2"
check "A · un solo evento de cierre y reserva liberada" "select (select count(*) from public.card_payment_attempt_events where attempt_id = tests.id('cs7_ia') and to_status = 'failed_safe_to_retry') = 1 and public.cs_reservas_activas(tests.id('cs7_oa')) = 0"

# ── B) cierre manual ∥ resolución a captured con hechos del proveedor
("${P[@]}" -c "$(as cs7_adm) $(CERRAR cs7_ib)" > "$T/bc.out" 2>&1) &
("${P[@]}" -c "$(as cs7_bil) select public.cs_intento_avanzar(tests.id('cs7_ib'), 'captured', '{\"cs_payment_id\":\"PAY-C7-b\",\"evidencia\":\"[billing] consulta: bill aprobada\",\"proveedor\":{\"autorizacion\":{\"estado\":\"aprobada\",\"id\":\"PAY-C7-b\"},\"captura\":{\"estado\":\"aprobada\",\"id\":\"PAY-C7-b\"}}}') ->> 'status'" > "$T/br.out" 2>&1) &
wait
nodead "$T/bc.out" "$T/br.out" && echo "PASS: B · cierre ∥ resolución sin deadlock"
check "B · exactamente uno ganó (applied) y el otro fue rechazado por estado" "select ($(cat "$T/bc.out" "$T/br.out" | grep -c '^applied$')) = 1 and ($(cat "$T/bc.out" "$T/br.out" | grep -ciE 'ESTADO_INVALIDO|TRANSICION_INVALIDA')) = 1"
check "B · estado final coherente: failed_safe_to_retry sin asiento, o captured" "select (status = 'failed_safe_to_retry' and not exists (select 1 from public.payment_entries where order_id = tests.id('cs7_ob'))) or status = 'captured' from public.card_payment_attempts where id = tests.id('cs7_ib')"
check "B · un solo evento de salida de desconocido" "select count(*) = 1 from public.card_payment_attempt_events where attempt_id = tests.id('cs7_ib') and from_status = 'unknown_requires_reconciliation'"

# ── C) cierre manual ∥ 2 cobros de otro canal de 500 (Σ = total: el ledger no rechaza por sí solo; sin reserva ambos caben, con reserva ninguno)
("${P[@]}" -c "$(as cs7_adm) $(CERRAR cs7_ic)" > "$T/cc.out" 2>&1) &
for i in 1 2; do ("${P[@]}" -c "$(as cs7_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('cs7_oc'), 'efectivo', 500) ->> 'status'" > "$T/cm$i.out" 2>&1) & done
wait
nodead "$T/cc.out" "$T"/cm*.out && echo "PASS: C · cierre ∥ cobros sin deadlock"
check "C · cierre aplicado" "select $(grep -c '^applied$' "$T/cc.out") = 1 and status = 'failed_safe_to_retry' from public.card_payment_attempts where id = tests.id('cs7_ic')"
check "C · como máximo dos cobros y nunca sobrepago" "select (select count(*) from public.payment_entries where order_id = tests.id('cs7_oc')) <= 2 and not (select sobrepago from public.v_order_money where order_id = tests.id('cs7_oc'))"
check "C · todo rechazo fue RESERVA_ACTIVA (el cobro solo entra con la reserva ya liberada)" "select $(cat "$T"/cm*.out | grep -ciE 'ERROR') = $(cat "$T"/cm*.out | grep -c 'RESERVA_ACTIVA')"

"${P[@]}" -c "delete from tests.ctx where key like 'cs7_%'" >/dev/null
exit $FAILED
