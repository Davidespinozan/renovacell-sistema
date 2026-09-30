#!/usr/bin/env bash
# ============================================================================
# W2 · N2 debe ABORTAR si existe un pedido declarado "pagado" SIN asiento que lo
# respalde (F-1) — exactamente el estado en el que estaba producción antes de la
# base limpia. Base aparte del mismo cluster desechable; nunca producción.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
BIN="${PSQL_BIN%psql}"
P=("${PSQL_BIN:-psql}" -X -q -At -v ON_ERROR_STOP=1 -d w2_precheck)
FAILED=0
W2=("$ROOT"/supabase/migrations/20261013120000_w2_n1_schema.sql "$ROOT"/supabase/migrations/20261013120100_w2_n2_constraints.sql
    "$ROOT"/supabase/migrations/20261013120200_w2_n3_commands.sql "$ROOT"/supabase/migrations/20261013120300_w2_n4_authority.sql)

"${BIN}dropdb" --if-exists w2_precheck >/dev/null 2>&1
"${BIN}createdb" w2_precheck || { echo "FAIL: createdb"; exit 1; }
"${P[@]}" -f "$HERE/00_supabase_shim.sql" >/dev/null 2>&1 || { echo "FAIL: shim"; exit 1; }
for m in "$ROOT"/supabase/migrations/*.sql; do
  b=$(basename "$m")
  case "$b" in 20260930120000_*|20261001120000_*|20261003120000_*|20261004120000_*) continue;; esac
  [[ "$b" > "20261013000000" ]] && continue
  "${P[@]}" -f "$m" >/dev/null 2>&1 || { echo "FAIL: migración previa $b"; exit 1; }
done

# Pedido "pagado" SIN respaldo: el patrón markPaid → pay_order('registrado','ADM').
"${P[@]}" -c "
  insert into public.products (id, sku, name, price) values ('00000000-0000-0000-0000-0000000000a1', 'SKU-W2', 'x', 100);
  insert into public.orders (id, external_ref, status, payment_status, payment_method, total)
    values ('00000000-0000-0000-0000-0000000000b2', 'FAKE-PAID', 'packed', 'paid', 'registrado', 100);" >/dev/null 2>&1 \
  || { echo "FAIL: fixture"; exit 1; }

if "${P[@]}" -f "${W2[0]}" >/dev/null 2>&1; then
  echo "PASS: N1 (aditivo) aplica aunque existan pedidos previos"
else echo "FAIL: N1 no aplicó"; FAILED=1; fi

out=$("${P[@]}" -f "${W2[1]}" 2>&1); rc=$?
if [ $rc -ne 0 ] && grep -q "W2_N2_PRECONDICION" <<<"$out"; then
  echo "PASS: N2 ABORTA ante un pedido 'pagado' sin asiento [$(grep -o 'W2_N2_PRECONDICION[^.]*' <<<"$out" | head -1)]"
else echo "FAIL: N2 no abortó: $out"; FAILED=1; fi

n=$("${P[@]}" -c "select count(*) from pg_constraint where conname = 'ck_orders_payment_status'")
[ "$n" = "0" ] && echo "PASS: N2 no dejó constraints a medias" || { echo "FAIL: N2 aplicó parcialmente"; FAILED=1; }
n=$("${P[@]}" -c "select count(*) from public.orders where payment_status = 'paid'")
[ "$n" = "1" ] && echo "PASS: el pedido previo queda intacto" || { echo "FAIL: datos alterados"; FAILED=1; }

# Con el pedido coherente (o sin pedidos) N2–N4 aplican
"${P[@]}" -c "delete from public.orders where id = '00000000-0000-0000-0000-0000000000b2'" >/dev/null 2>&1
if "${P[@]}" -f "${W2[1]}" -f "${W2[2]}" -f "${W2[3]}" >/dev/null 2>&1; then
  echo "PASS: sin pedidos incoherentes, N2→N4 aplican (base limpia ⇒ sin backfill)"
else echo "FAIL: N2–N4 no aplicaron sobre base coherente"; FAILED=1; fi
n=$("${P[@]}" -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'pedido_liberado_para_surtir'")
[ "$n" = "1" ] && echo "PASS: la compuerta de liberación queda instalada" || { echo "FAIL: falta pedido_liberado_para_surtir"; FAILED=1; }

"${BIN}dropdb" w2_precheck >/dev/null 2>&1
exit $FAILED
