#!/usr/bin/env bash
# ============================================================================
# W1 · M2 debe ABORTAR sobre datos pre-W1 (el caso de producción hoy: 3 pedidos,
# 3 lotes, 5 movimientos sin op_id). Base aparte del mismo cluster desechable:
#   shim + migraciones previas a W1 → datos tipo prod → M1 (ok) → M2 (debe fallar)
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
P=("${PSQL_BIN:-psql}" -X -q -At -v ON_ERROR_STOP=1 -d w1_precheck)
FAILED=0
"${PSQL_BIN%psql}dropdb" --if-exists w1_precheck >/dev/null 2>&1
"${PSQL_BIN%psql}createdb" w1_precheck || { echo "FAIL: createdb"; exit 1; }
"${P[@]}" -f "$HERE/00_supabase_shim.sql" >/dev/null 2>&1 || { echo "FAIL: shim"; exit 1; }
for m in "$ROOT"/supabase/migrations/*.sql; do
  b=$(basename "$m")
  case "$b" in 20260930120000_*|20261001120000_*|20261003120000_*|20261004120000_*) continue;; esac
  [[ "$b" > "20261012000000" ]] && continue
  "${P[@]}" -f "$m" >/dev/null 2>&1 || { echo "FAIL: migración previa $b"; exit 1; }
done
# Datos con la forma de producción (lotes + kardex SIN op_id, pedido empacado sin renglones)
"${P[@]}" -c "
  insert into public.products (id, sku, name, price) values ('00000000-0000-0000-0000-00000000000a', 'MED-002', 'x', 1);
  insert into public.lots (id, product_id, lot_code, expiry_date, quantity, location)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', 'dsfsdfsdfsd', '2026-09-10', 12, 'Culiacán');
  insert into public.inventory_movements (lot_id, change, reason, reference)
    values ('00000000-0000-0000-0000-0000000000b1', 12, 'entrada', 'dsfsdfsdfsd');
  insert into public.orders (id, external_ref, status, payment_status, total) values (gen_random_uuid(), 'QA-DHL-E2E', 'packed', 'pending', 1);" >/dev/null 2>&1 \
  || { echo "FAIL: datos tipo prod"; exit 1; }
if "${P[@]}" -f "$ROOT/supabase/migrations/20261012120000_w1_m1_schema.sql" >/dev/null 2>&1; then
  echo "PASS: M1 (aditivo) aplica sobre datos pre-W1"
else echo "FAIL: M1 no aplicó sobre datos pre-W1"; FAILED=1; fi
out=$("${P[@]}" -f "$ROOT/supabase/migrations/20261012120100_w1_m2_constraints.sql" 2>&1); rc=$?
if [ $rc -ne 0 ] && grep -q "W1_M2_PRECONDICION" <<<"$out"; then
  echo "PASS: M2 ABORTA sobre datos pre-W1 (exige base limpia autorizada) [$(grep -o 'W1_M2_PRECONDICION[^.]*' <<<"$out" | head -1)]"
else echo "FAIL: M2 no abortó como se esperaba: $out"; FAILED=1; fi
n=$("${P[@]}" -c "select count(*) from pg_indexes where indexname = 'uq_lots_product_code'")
if [ "$n" = "0" ]; then echo "PASS: M2 no dejó nada a medias (sin índice único)"; else echo "FAIL: M2 aplicó parcialmente"; FAILED=1; fi
n=$("${P[@]}" -c "select count(*) from public.inventory_movements")
if [ "$n" = "1" ]; then echo "PASS: el kardex pre-W1 quedó intacto"; else echo "FAIL: kardex alterado ($n)"; FAILED=1; fi
"${PSQL_BIN%psql}dropdb" w1_precheck >/dev/null 2>&1
exit $FAILED
