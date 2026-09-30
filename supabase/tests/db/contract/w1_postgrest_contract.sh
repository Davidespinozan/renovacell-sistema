#!/usr/bin/env bash
# W1 · Contrato PostgREST real. Requiere POSTGREST_BIN (PostgREST v14.5 = producción; ver README).
# Sin binario ⇒ se reporta OMITIDO (no pasa en silencio).
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
BIN="${PSQL_BIN%psql}"
if [ -z "${POSTGREST_BIN:-}" ] || [ ! -x "$POSTGREST_BIN" ]; then echo "SKIPPED: POSTGREST_BIN no definido (contrato PostgREST NO probado)"; exit 3; fi
DB=w1_contract; PORT_API=54340; SECRET="w1-contract-local-secret-0123456789abcdef"
P=("${PSQL_BIN}" -X -q -At -v ON_ERROR_STOP=1 -d $DB)
"${BIN}dropdb" --if-exists $DB >/dev/null 2>&1; "${BIN}createdb" $DB || exit 1
"${P[@]}" -f "$HERE/00_supabase_shim.sql" >/dev/null 2>&1 || { echo "FAIL: shim"; exit 1; }
for m in "$ROOT"/supabase/migrations/*.sql; do
  case "$(basename "$m")" in 20260930120000_*|20261001120000_*|20261003120000_*|20261004120000_*) continue;; esac
  "${P[@]}" -f "$m" >/dev/null 2>&1 || { echo "FAIL: migración $(basename "$m")"; exit 1; }
done
"${P[@]}" -f "$HERE/01_helpers.sql" >/dev/null 2>&1 || { echo "FAIL: helpers"; exit 1; }
"${P[@]}" -c "do \$\$ begin create role authenticator login noinherit; exception when duplicate_object then null; end \$\$; grant anon, authenticated, service_role to authenticator;" >/dev/null
one() { "${P[@]}" -c "$1" | head -1; }
ADMIN=$(one "select tests.user('admin')"); WH=$(one "select tests.user('warehouse')"); POS=$(one "select tests.user('pos')")
PROD=$(one "select tests.product(150)")
REP=$(one "insert into public.replenishments (product_id, product_name, qty, unit_cost, kind) values ('$PROD', 'P', 10, 20, 'compra') returning id")
O1=$(one "select tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', '$PROD'::uuid, 'qty', 2)))")
O2=$(one "select tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', '$PROD'::uuid, 'qty', 1)))")
P2=$(one "select tests.product(80)"); one "select tests.stock('$P2', 'CT-G', 5)" >/dev/null
O3=$(one "select tests.packed_order(tests.user('doctor'), jsonb_build_array(jsonb_build_object('product_id', '$P2'::uuid, 'qty', 1)))")
ATT=$(one "insert into public.shipping_attempts (order_id, idempotency_key, status) values ('$O3', 'ct', 'succeeded') returning id")
DOC=$(one "select tests.user('doctor')")
OM=$(one "select tests.order('$DOC', 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', '$PROD'::uuid, 'qty', 2)))")
OC=$(one "select tests.order('$DOC', 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', '$P2'::uuid, 'qty', 1)))")
one "select tests.stock('$P2', 'CT-C', 10)" >/dev/null
CTX=$(printf '{"admin":"%s","wh":"%s","pos":"%s","prod":"%s","rep":"%s","order":"%s","order2":"%s","attempt":"%s","doc":"%s","omoney":"%s","ocred":"%s"}' "$ADMIN" "$WH" "$POS" "$PROD" "$REP" "$O1" "$O2" "$ATT" "$DOC" "$OM" "$OC")
SOCK=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${PGHOST}")
cat > /tmp/w1_pgrst.conf.$$ <<CONF
db-uri = "postgres://authenticator@/${DB}?host=${SOCK}&port=${PGPORT}"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
jwt-secret = "${SECRET}"
server-port = ${PORT_API}
server-host = "127.0.0.1"
CONF
"$POSTGREST_BIN" /tmp/w1_pgrst.conf.$$ > /tmp/w1_pgrst.log.$$ 2>&1 & PID=$!
for i in $(seq 1 80); do [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT_API}/")" = "200" ] && break; sleep 0.25; done
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT_API}/")" = "200" ] || { echo "FAIL: PostgREST no quedó listo"; tail -5 /tmp/w1_pgrst.log.$$; kill $PID; exit 1; }
PGRST_URL="http://127.0.0.1:${PORT_API}" PGRST_JWT_SECRET="$SECRET" W1_CTX="$CTX" node "$HERE/contract/w1_postgrest_contract.mjs"; rc=$?
kill $PID 2>/dev/null; wait $PID 2>/dev/null; rm -f /tmp/w1_pgrst.conf.$$ /tmp/w1_pgrst.log.$$
"${BIN}dropdb" $DB >/dev/null 2>&1
exit $rc
