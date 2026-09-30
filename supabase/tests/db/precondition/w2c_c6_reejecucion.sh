#!/usr/bin/env bash
# ============================================================================
# W2-C · C6 debe ser IDEMPOTENTE y FALLAR CERRADO.
#   1. Segunda ejecución con el legacy ya eliminado ⇒ no-op (already_applied).
#   2. Con una fila legacy ⇒ ABORTA y no borra nada.
#   3. Sin la arquitectura nueva ⇒ ABORTA (no se destruye lo viejo sin lo nuevo).
#   4. Con una vista dependiente ⇒ ABORTA (el cleanup no sería seguro).
# Base aparte del mismo cluster desechable; nunca producción.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
BIN="${PSQL_BIN%psql}"
DB=w2c_c6check
P=("${PSQL_BIN:-psql}" -X -q -At -d $DB)
C6="$ROOT/supabase/migrations/20261015120000_w2c_c6_legacy_cleanup.sql"
SNAP="$ROOT/supabase/rollback/w2c/00_w2_snapshot.sql"
FAILED=0
ok(){ echo "PASS: $1"; }
no(){ echo "FAIL: $1 ($2)"; FAILED=1; }

"${BIN}dropdb" --if-exists $DB >/dev/null 2>&1
"${BIN}createdb" $DB || { echo "FAIL: createdb"; exit 1; }
"${P[@]}" -v ON_ERROR_STOP=1 -f "$HERE/00_supabase_shim.sql" >/dev/null 2>&1 || { echo "FAIL: shim"; exit 1; }
for m in "$ROOT"/supabase/migrations/*.sql; do
  b=$(basename "$m")
  case "$b" in 20260930120000_*|20261001120000_*|20261003120000_*|20261004120000_*) continue;; esac
  "${P[@]}" -v ON_ERROR_STOP=1 -f "$m" >/dev/null 2>&1 || { echo "FAIL: migración $b"; exit 1; }
done

# El set completo ya incluye C6, así que el legacy debe estar fuera y la custodia dentro.
n=$("${P[@]}" -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('events','consignment_stock')")
[ "$n" = "0" ] && ok "tras aplicar todas las migraciones el legacy no existe" || no "el legacy sigue ahí" "$n"
n=$("${P[@]}" -c "select (to_regclass('public.custody_lines') is not null)::text")
[ "$n" = "true" ] && ok "la custodia nueva quedó instalada" || no "falta la custodia nueva" "$n"

# ── 1) SEGUNDA ejecución: no-op limpio ────────────────────────────────────────
out=$("${P[@]}" -v ON_ERROR_STOP=1 -f "$C6" 2>&1); rc=$?
if [ $rc -eq 0 ] && grep -q "already_applied" <<<"$out"; then
  ok "re-ejecución ⇒ no-op (already_applied), sin error"
else no "la re-ejecución no fue un no-op limpio" "rc=$rc out=$(tr '\n' ' ' <<<"$out" | cut -c1-160)"; fi
n=$("${P[@]}" -c "select (to_regclass('public.custody_lines') is not null and to_regclass('public.custodies') is not null and to_regclass('public.custody_operations') is not null and to_regclass('public.v_stock_disponible') is not null)::text")
[ "$n" = "true" ] && ok "la re-ejecución NO eliminó nada de la arquitectura nueva" || no "la re-ejecución dañó la custodia" "$n"

# ── 2) Con HISTORIA legacy: aborta sin borrar ─────────────────────────────────
"${P[@]}" -c "create table public.events (id uuid primary key default gen_random_uuid(), name text not null,
  status text default 'activo', members jsonb default '[]'::jsonb, items jsonb default '[]'::jsonb);
  insert into public.events (name) values ('historia real');" >/dev/null 2>&1
out=$("${P[@]}" -v ON_ERROR_STOP=1 -f "$C6" 2>&1); rc=$?
if [ $rc -ne 0 ] && grep -q "W2C_C6_PRECONDICION: events tiene 1 fila" <<<"$out"; then
  ok "con una fila legacy ⇒ ABORTA y lo dice con el conteo"
else no "no abortó ante historia legacy" "rc=$rc out=$(tr '\n' ' ' <<<"$out" | cut -c1-160)"; fi
n=$("${P[@]}" -c "select count(*) from public.events")
[ "$n" = "1" ] && ok "la fila legacy sigue intacta (no se borró nada)" || no "se perdió la fila legacy" "$n"

# ── 4) Con una VISTA dependiente: aborta ──────────────────────────────────────
"${P[@]}" -c "delete from public.events; create view public.v_probe_legacy as select id from public.events;" >/dev/null 2>&1
out=$("${P[@]}" -v ON_ERROR_STOP=1 -f "$C6" 2>&1); rc=$?
if [ $rc -ne 0 ] && grep -q "dependen todavía de las tablas legacy" <<<"$out"; then
  ok "con una vista dependiente ⇒ ABORTA (el cleanup no sería seguro)"
else no "no detectó la dependencia" "rc=$rc out=$(tr '\n' ' ' <<<"$out" | cut -c1-160)"; fi
"${P[@]}" -c "drop view public.v_probe_legacy;" >/dev/null 2>&1

# ── Camino feliz: sin filas ni dependencias, limpia de verdad ─────────────────
out=$("${P[@]}" -v ON_ERROR_STOP=1 -f "$C6" 2>&1); rc=$?
if [ $rc -eq 0 ] && grep -q "W2C_C6: applied" <<<"$out"; then
  ok "sin historia ni dependencias ⇒ limpia y lo reporta"
else no "no limpió el legacy recreado" "rc=$rc out=$(tr '\n' ' ' <<<"$out" | cut -c1-160)"; fi
n=$("${P[@]}" -c "select count(*) from information_schema.tables where table_schema='public' and table_name = 'events'")
[ "$n" = "0" ] && ok "events eliminado" || no "events sigue ahí" "$n"

# ── 3) Sin la arquitectura nueva: aborta antes de tocar nada ──────────────────
"${BIN}dropdb" --if-exists ${DB}_bare >/dev/null 2>&1
"${BIN}createdb" ${DB}_bare >/dev/null 2>&1
PB=("${PSQL_BIN:-psql}" -X -q -At -d ${DB}_bare)
"${PB[@]}" -v ON_ERROR_STOP=1 -f "$HERE/00_supabase_shim.sql" >/dev/null 2>&1
"${PB[@]}" -c "create table public.events (id uuid primary key default gen_random_uuid(), name text not null);" >/dev/null 2>&1
out=$("${PB[@]}" -v ON_ERROR_STOP=1 -f "$C6" 2>&1); rc=$?
if [ $rc -ne 0 ] && grep -q "falta la custodia nueva" <<<"$out"; then
  ok "sin la arquitectura nueva ⇒ ABORTA (no se destruye lo viejo sin lo nuevo)"
else no "no exigió la arquitectura nueva" "rc=$rc out=$(tr '\n' ' ' <<<"$out" | cut -c1-160)"; fi
n=$("${PB[@]}" -c "select count(*) from information_schema.tables where table_schema='public' and table_name='events'")
[ "$n" = "1" ] && ok "sin arquitectura nueva no borró el legacy" || no "borró el legacy sin red" "$n"

"${BIN}dropdb" ${DB}_bare >/dev/null 2>&1
"${BIN}dropdb" $DB >/dev/null 2>&1
exit $FAILED
