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
POS2=$(one "select tests.user('pos', 'contrato-pos2@test.local')")
BILL=$(one "select tests.user('billing')"); PK=$(one "select tests.user('packing')")   # SEC-C1: contratos de lectura por rol
SUSP=$(one "select tests.user('pos', 'contrato-susp@test.local')"); one "select tests.suspender('$SUSP')" >/dev/null   # SEC-C2: cuenta suspendida
CUST=$(one "insert into public.customers (full_name, email, source, profile_id) values ('Tercero Contrato', 'tercero-contrato@test.local', 'portal', '$DOC') returning id")   # SEC-C2b: cliente titular "tercero" (ligado a la cuenta del doctor)
# SEC-C3: doctor con contacto y cédula, cartera VALIDADA con un pos propio, y un chofer con un envío EN CURSO a ese doctor
DOC3=$(one "select tests.user('doctor', 'contrato-c3-doc@test.local')"); POS3=$(one "select tests.user('pos', 'contrato-c3-pos@test.local')")
DRV=$(one "select tests.user('driver', 'contrato-c3-drv@test.local')"); DRV2=$(one "select tests.user('driver', 'contrato-c3-drv2@test.local')")
"${P[@]}" -c "do \$\$ begin perform set_config('app.trusted', 'on', true); update public.profiles set organization = 'Clínica C3', meta = coalesce(meta, '{}'::jsonb) || '{\"phone\":\"667-C3\",\"address\":\"Calle C3\",\"city\":\"Culiacán\",\"specialty\":\"Derma\",\"cedula\":\"CED-C3\"}' where id = '$DOC3'; end \$\$;" >/dev/null || { echo "FAIL: fixture SEC-C3"; exit 1; }
one "insert into public.cc_cartera (profile_id, seller_profile_id) values ('$DOC3', '$POS3') returning 1" >/dev/null
O5=$(one "select tests.order('$DOC3', 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', '$PROD'::uuid, 'qty', 1)))")
SHPACT=$(one "insert into public.shipments (order_id, driver_id, status) values ('$O5', '$DRV', 'despachado') returning id")
# SEC-C3b: una entrega ya cerrada del mismo chofer (con su prueba) y fotos en Storage: una propia sin usar y una de OTRO chofer
O6=$(one "select tests.order('$DOC3', 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', '$PROD'::uuid, 'qty', 1)))")
SHPENT=$(one "insert into public.shipments (order_id, driver_id, status, delivered_at, proof_image_url, received_by) values ('$O6', '$DRV', 'delivered', now(), 'proofs/ct-ent.png', 'Recepción') returning id")
one "insert into storage.objects (bucket_id, name, owner, owner_id) values ('proofs', 'proofs/ct-ent.png', '$DRV', '$DRV'), ('proofs', 'proofs/ct-nueva.png', '$DRV', '$DRV'), ('proofs', 'proofs/ct-ajena.png', '$DRV2', '$DRV2') returning 1" >/dev/null
# SEC-C4-A: dos cuentas sintéticas con el MISMO teléfono; una es la cuenta del doctor de la cartera de POS3
one "insert into public.customers (full_name, email, phone, city, source, profile_id) values ('Contrato Búsqueda Uno', 'c4a-uno@test.local', '+52 667 555 0142', 'Culiacán', 'portal', '$DOC3') returning 1" >/dev/null
CUSTB=$(one "insert into public.customers (full_name, email, phone, source, seller_name) values ('Contrato Búsqueda Dos', 'c4a-dos@test.local', '6675550142', 'odoo', 'vendedor-odoo') returning id")
OM=$(one "select tests.order('$DOC', 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', '$PROD'::uuid, 'qty', 2)))")
OC=$(one "select tests.order('$DOC', 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', '$P2'::uuid, 'qty', 1)))")
one "select tests.stock('$P2', 'CT-C', 10)" >/dev/null
CTX=$(printf '{"admin":"%s","wh":"%s","pos":"%s","pos2":"%s","prod":"%s","rep":"%s","order":"%s","order2":"%s","attempt":"%s","doc":"%s","omoney":"%s","ocred":"%s","bill":"%s","pk":"%s","susp":"%s","cust":"%s","doc3":"%s","pos3":"%s","drv":"%s","drv2":"%s","shpAct":"%s","shpEnt":"%s","custB":"%s"}' "$ADMIN" "$WH" "$POS" "$POS2" "$PROD" "$REP" "$O1" "$O2" "$ATT" "$DOC" "$OM" "$OC" "$BILL" "$PK" "$SUSP" "$CUST" "$DOC3" "$POS3" "$DRV" "$DRV2" "$SHPACT" "$SHPENT" "$CUSTB")
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
