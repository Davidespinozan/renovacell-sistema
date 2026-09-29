#!/usr/bin/env bash
# ============================================================================
# W1 · ENSAYO LOCAL DE P4 (nunca producción). Base aparte del cluster desechable con
# datos CON LA FORMA de producción y los MISMOS ids del manifiesto (valores sintéticos).
#   0) M1–M4 en UNA transacción con los datos de prueba presentes ⇒ aborta y NO deja M1
#   1) base limpia con una fila real nueva ⇒ aborta sin tocar nada
#   2) base limpia ⇒ purga exacta 13 filas, archivo 13, maestros idénticos, bitácora +1
#   3) re-ejecución ⇒ aborta
#   4) M1–M4 en UNA transacción ⇒ aplica; conciliación 0 errores
#   5) base limpia después de W1 ⇒ aborta
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
BIN="${PSQL_BIN%psql}"
P=("${PSQL_BIN:-psql}" -X -q -At -v ON_ERROR_STOP=1 -d w1_rehearsal)
FAILED=0
ok()   { echo "PASS: $1"; }
bad()  { echo "FAIL: $1"; FAILED=1; }
val()  { "${P[@]}" -c "$1" 2>&1; }
W1=("$ROOT"/supabase/migrations/20261012120000_w1_m1_schema.sql "$ROOT"/supabase/migrations/20261012120100_w1_m2_constraints.sql
    "$ROOT"/supabase/migrations/20261012120200_w1_m3_commands.sql "$ROOT"/supabase/migrations/20261012120300_w1_m4_authority.sql)
# El paquete REAL de P4 (generado verbatim de M1–M4), con su propio BEGIN/COMMIT; sin -1.
"$ROOT/supabase/ops/build_w1_p4_bundle.sh" >/dev/null
apply_w1() { "${P[@]}" -f "$ROOT/supabase/ops/w1_p4_apply.sql" 2>&1; }

"${BIN}dropdb" --if-exists w1_rehearsal >/dev/null 2>&1
"${BIN}createdb" w1_rehearsal || { echo "FAIL: createdb"; exit 1; }
"${P[@]}" -f "$HERE/00_supabase_shim.sql" >/dev/null 2>&1 || { echo "FAIL: shim"; exit 1; }
for m in "$ROOT"/supabase/migrations/*.sql; do
  b=$(basename "$m")
  case "$b" in 20260930120000_*|20261001120000_*|20261003120000_*|20261004120000_*) continue;; esac
  [[ "$b" > "20261012000000" ]] && continue
  "${P[@]}" -f "$m" >/dev/null 2>&1 || { echo "FAIL: migración previa $b"; exit 1; }
done

# Historial de migraciones como en Supabase (el bundle P4 registra M1–M4 en la misma transacción).
"${P[@]}" -c "create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)" >/dev/null
# Datos con la forma de producción: ids EXACTOS del manifiesto, valores sintéticos (sin PII).
"${P[@]}" >/dev/null 2>&1 <<'SQL' || { echo "FAIL: fixture"; exit 1; }
insert into auth.users (id, email) values ('0d000000-0000-4000-8000-000000000001', 'doctor@fixture.local');
insert into public.customers (id, full_name, profile_id, source)
  values ('0c000000-0000-4000-8000-000000000001', 'Doctor Fixture', '0d000000-0000-4000-8000-000000000001', 'portal');
insert into public.products (id, sku, name, price) values
  ('0a000000-0000-4000-8000-000000000001', 'SER-001', 'Fixture 1', 100), ('0a000000-0000-4000-8000-000000000002', 'SER-002', 'Fixture 2', 100),
  ('0a000000-0000-4000-8000-000000000003', 'MED-002', 'Fixture 3', 100), ('0a000000-0000-4000-8000-000000000004', 'KEEP-1', 'Maestro', 100);
insert into public.product_costs (product_id, unit_cost) values ('0a000000-0000-4000-8000-000000000004', 10);
insert into public.lots (id, product_id, lot_code, expiry_date, quantity, location) values
  ('eeeccd41-96e7-4579-a06a-2e165253d052', '0a000000-0000-4000-8000-000000000001', '234234233', '2026-11-07', 10, 'Culiacán'),
  ('99655e42-07b3-4651-ace3-e0503cd1063b', '0a000000-0000-4000-8000-000000000002', 'adasda', '2026-11-20', 0, 'Culiacán'),
  ('ddc5941d-1c59-4f44-96ba-75db5060e7eb', '0a000000-0000-4000-8000-000000000003', 'dsfsdfsdfsd', '2026-09-10', 12, 'Culiacán');
insert into public.inventory_movements (id, lot_id, change, reason, reference) values
  ('c59e431c-e1d6-4a48-a058-4f54396641c1', 'eeeccd41-96e7-4579-a06a-2e165253d052', 12, 'entrada', '234234233'),
  ('3de29637-29f2-4656-8dab-deaf72165635', 'eeeccd41-96e7-4579-a06a-2e165253d052', -2, 'surtido', 'S565051'),
  ('d9f0b3b2-b377-4910-969b-9c9c9db858d4', '99655e42-07b3-4651-ace3-e0503cd1063b', 10, 'entrada', 'adasda'),
  ('1f35aacd-be3e-4c89-b579-f8867c1fc8cb', '99655e42-07b3-4651-ace3-e0503cd1063b', -10, 'surtido', 'S958883'),
  ('d5705b77-3978-4431-9710-420a8d8394ff', 'ddc5941d-1c59-4f44-96ba-75db5060e7eb', 12, 'entrada', 'dsfsdfsdfsd');
insert into public.orders (id, external_ref, doctor_id, customer_id, total, status, payment_method, payment_status) values
  ('01812c70-82ff-4479-87bc-0757ab9f592b', 'QA-DHL-E2E', null, null, 1, 'packed', 'transferencia', 'pending'),
  ('826cad23-1290-406b-9eb2-2fd6e1a180fe', 'S565051', '0d000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001', 4800, 'packed', 'registrado', 'paid'),
  ('52d58834-336c-4c4a-a3df-84ba2bc99506', 'S958883', '0d000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001', 3150, 'packed', 'registrado', 'paid');
insert into public.order_items (id, order_id, product_id, lot_id, qty, unit_price) values
  ('8d775ab6-cc5b-4b9e-8959-652be6e61bfd', '826cad23-1290-406b-9eb2-2fd6e1a180fe', '0a000000-0000-4000-8000-000000000001', 'eeeccd41-96e7-4579-a06a-2e165253d052', 2, 2400),
  ('97288a3b-159a-447e-b5c2-33514562f6a1', '52d58834-336c-4c4a-a3df-84ba2bc99506', '0a000000-0000-4000-8000-000000000002', '99655e42-07b3-4651-ace3-e0503cd1063b', 10, 315);
insert into public.audit_logs (action, resource_type) values ('fixture', 'app');
SQL
masters() { val "select (select count(*) from public.products)||'|'||(select count(*) from public.product_costs)||'|'||(select count(*) from public.profiles)||'|'||(select count(*) from auth.users)||'|'||(select count(*) from public.customers)||'|'||(select count(*) from public.price_lists)"; }
M0=$(masters); A0=$(val "select count(*) from public.audit_logs")

# 0) M1–M4 atómico con datos de prueba presentes ⇒ debe abortar en M2 y NO dejar M1
out=$(apply_w1); if grep -q "W1_M2_PRECONDICION" <<<"$out" && [ "$(val "select to_regclass('public.inventory_operations') is null")" = "t" ]; then
  ok "paquete P4 (M1–M4) aborta completo, sin M1 a medias, mientras existan datos pre-W1"; else bad "M1–M4 atómico: $out"; fi
[ "$(val "select count(*) from supabase_migrations.schema_migrations")" = "0" ] && ok "tras el aborto el historial NO registra M1–M4" || bad "historial registró migraciones abortadas"

# 1) fila REAL nueva ⇒ base limpia aborta sin tocar nada
val "insert into public.orders (id, external_ref, status, payment_status, total) values ('0e000000-0000-4000-8000-000000000001', 'REAL-1', 'pending_payment', 'pending', 10)" >/dev/null
out=$("${P[@]}" -f "$ROOT/supabase/ops/w1_base_limpia.sql" 2>&1)
if grep -q "W1_BASE_LIMPIA_ABORT: orders no coincide" <<<"$out" && [ "$(val "select count(*) from public.orders")" = "4" ] \
   && [ "$(val "select to_regnamespace('w1_archive') is null")" = "t" ]; then
  ok "fila nueva fuera del manifiesto ⇒ aborta, nada borrado, sin archivo"; else bad "manifiesto no protegió: $out"; fi
val "delete from public.orders where id = '0e000000-0000-4000-8000-000000000001'" >/dev/null

# 2) ejecución válida (la fila de prueba del paso 1 disparó el trigger de auditoría: se re-toma la base)
A0=$(val "select count(*) from public.audit_logs")
out=$("${P[@]}" -f "$ROOT/supabase/ops/w1_base_limpia.sql" 2>&1)
if grep -q "W1_BASE_LIMPIA_OK" <<<"$out"; then ok "base limpia ejecuta y confirma"; else bad "base limpia falló: $out"; fi
[ "$(val "select (select count(*) from public.orders)+(select count(*) from public.order_items)+(select count(*) from public.lots)+(select count(*) from public.inventory_movements)")" = "0" ] \
  && ok "operativos en 0 (pedidos, renglones, lotes, kardex)" || bad "quedaron operativos"
[ "$(val "select (select count(*) from w1_archive.orders)||'/'||(select count(*) from w1_archive.order_items)||'/'||(select count(*) from w1_archive.lots)||'/'||(select count(*) from w1_archive.inventory_movements)")" = "3/2/3/5" ] \
  && ok "archivo exacto 3/2/3/5 (13 filas)" || bad "archivo incorrecto"
[ "$(masters)" = "$M0" ] && ok "maestros idénticos ($M0: productos|costos|perfiles|auth|customers|listas)" || bad "maestros cambiaron: $M0 → $(masters)"
[ "$(val "select count(*) from public.audit_logs")" = "$((A0 + 1))" ] && ok "bitácora +1 (constancia append-only)" || bad "bitácora"
[ "$(val "select has_schema_privilege('anon','w1_archive','USAGE') or has_schema_privilege('authenticated','w1_archive','USAGE') or has_schema_privilege('service_role','w1_archive','USAGE')")" = "f" ] \
  && ok "w1_archive inaccesible para anon/authenticated/service_role" || bad "archivo expuesto"
[ "$(val "select current_setting('renovacell.purge', true) is distinct from 'on'")" = "t" ] && ok "renovacell.purge no persiste fuera de la transacción" || bad "purge persistió"
[ "$(val "select count(*) from public.customers where id = '0c000000-0000-4000-8000-000000000001'")" = "1" ] && ok "el customer del doctor ligado a los pedidos de prueba se conserva" || bad "customer borrado"

# 3) re-ejecución ⇒ aborta
out=$("${P[@]}" -f "$ROOT/supabase/ops/w1_base_limpia.sql" 2>&1)
grep -q "W1_BASE_LIMPIA_ABORT: el esquema w1_archive ya existe" <<<"$out" && ok "re-ejecución rechazada (no destruye datos futuros)" || bad "re-ejecución: $out"

# 4) M1–M4 en UNA transacción ⇒ aplica; conciliación 0
t0=$(date +%s)
out=$(apply_w1); rc=$?; t1=$(date +%s)
if [ $rc -eq 0 ] && [ "$(val "select to_regclass('public.inventory_operations') is not null")" = "t" ]; then ok "M1–M4 aplican en una transacción tras la base limpia ($((t1 - t0)) s local)"; else bad "M1–M4 no aplicaron: $out"; fi
[ "$(val "select convalidated from pg_constraint where conname = 'lots_quantity_nonneg'")" = "t" ] && ok "M2 validó lots_quantity_nonneg" || bad "M2 validación"
v=$("${P[@]}" -f "$ROOT/supabase/ops/w1_p4_verify.sql" 2>&1)
if grep -q "W1_VERIFY: 25/25 OK" <<<"$v"; then ok "verificación posterior (solo lectura): 25/25 OK"; else bad "verificación: $(grep -E '\|f$|W1_VERIFY' <<<"$v")"; fi
[ "$(val "select count(*) from pg_policies where tablename = 'lots' and policyname = 'lots_write_warehouse'")" = "0" ] && ok "M4 cerró escrituras directas (lots_write_warehouse eliminada)" || bad "M4"
c=$(val "select count(*) from (select set_config('request.jwt.claims', json_build_object('sub', '0d000000-0000-4000-8000-000000000009', 'role', 'authenticated')::text, true)) s, public.conciliar_inventario() c where c.severidad = 'error'" 2>&1)
# conciliar exige admin: se crea uno y se reintenta
val "insert into auth.users (id, email) values ('0d000000-0000-4000-8000-000000000009', 'admin@fixture.local'); select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); update public.profiles set role_id = 'admin' where id = '0d000000-0000-4000-8000-000000000009'" >/dev/null 2>&1
c=$(val "select count(*) from (select set_config('request.jwt.claims', json_build_object('sub', '0d000000-0000-4000-8000-000000000009', 'role', 'authenticated')::text, true)) s, public.conciliar_inventario() c where c.severidad = 'error'")
[ "$c" = "0" ] && ok "conciliación ejecuta tras M4: 0 errores" || bad "conciliación: $c"

# 5) base limpia después de W1 ⇒ aborta
out=$("${P[@]}" -f "$ROOT/supabase/ops/w1_base_limpia.sql" 2>&1)
grep -q "W1_BASE_LIMPIA_ABORT: W1 ya está aplicado" <<<"$out" && ok "base limpia se niega a correr con W1 aplicado" || bad "post-W1: $out"

"${BIN}dropdb" w1_rehearsal >/dev/null 2>&1
exit $FAILED
