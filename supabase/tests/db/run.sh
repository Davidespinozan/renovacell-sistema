#!/usr/bin/env bash
# ============================================================================
# Pruebas de BD locales (W1 · RC-35): cluster Postgres DESECHABLE + emulación
# mínima de Supabase + TODAS las migraciones + archivos de prueba.
#
# Nunca toca producción: no usa `supabase --linked`, solo un cluster temporal
# en $TMPDIR que se destruye al terminar (KEEP=1 lo deja arriba para depurar).
#
# Requisitos: PostgreSQL 17 (brew install postgresql@17). Si más adelante hay
# Docker, el mismo SQL de pruebas puede correr contra `supabase start`.
#
# Uso:
#   supabase/tests/db/run.sh               # todo
#   supabase/tests/db/run.sh w1_recepcion  # solo archivos que contengan el filtro
#   KEEP=1 supabase/tests/db/run.sh        # no destruir el cluster al final
# ============================================================================
set -uo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${PGPORT_TEST:-54329}"
DATA="${PGDATA_TEST:-${TMPDIR:-/tmp}/renovacell-dbtest}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
FILTER="${1:-}"
export PGHOST="$DATA" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres

PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1)

stop() {
  if [ "${KEEP:-0}" != "1" ]; then
    "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$DATA"
  else
    echo "KEEP=1 → cluster arriba: PGHOST=$DATA PGPORT=$PORT PGUSER=postgres"
  fi
}

# --- 1) cluster limpio ---------------------------------------------------------
"$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
rm -rf "$DATA"
"$PGBIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --locale=C >/dev/null || { echo "initdb falló"; exit 2; }
"$PGBIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w \
  -o "-p $PORT -k $DATA -c listen_addresses='' -c timezone=UTC -c max_connections=40" start >/dev/null \
  || { echo "no arrancó postgres (ver $DATA/server.log)"; exit 2; }
trap stop EXIT

# --- 2) emulación Supabase + migraciones --------------------------------------
"${PSQL[@]}" -f "$HERE/00_supabase_shim.sql" >/dev/null || { echo "FALLÓ el shim"; exit 2; }
# Migraciones SOLO-DATOS de producción: sus guardas abortan a propósito si los 179/121/173
# productos / lista Mayoreo reales no existen (no hay DDL, solo tablas temporales). En un cluster vacío
# se omiten; las pruebas crean sus propios productos.
DATA_ONLY_SKIP=(
  20260930120000_prices_commercial_sep2026.sql
  20261001120000_enable_sellable_121.sql
  20261003120000_volume_rules_sep2026.sql
  20261004120000_cleanup_mayoreo_legacy.sql
)
nmig=0; nskip=0
for m in "$ROOT"/supabase/migrations/*.sql; do
  if printf '%s\n' "${DATA_ONLY_SKIP[@]}" | grep -qx "$(basename "$m")"; then nskip=$((nskip + 1)); continue; fi
  if ! out=$("${PSQL[@]}" -f "$m" 2>&1); then
    echo "FALLÓ migración $(basename "$m")"; echo "$out" | tail -20; exit 2
  fi
  nmig=$((nmig + 1))
done
echo "migraciones aplicadas: $nmig · omitidas (solo-datos prod): $nskip"

# --- 3) helpers + pruebas -----------------------------------------------------
"${PSQL[@]}" -f "$HERE/01_helpers.sql" >/dev/null || { echo "FALLÓ helpers"; exit 2; }

pass=0; fail=0; failed_files=()
for t in "$HERE"/tests/*.sql; do
  [ -e "$t" ] || continue
  [ -n "$FILTER" ] && [[ "$(basename "$t")" != *"$FILTER"* ]] && continue
  out=$("${PSQL[@]}" -f "$t" 2>&1); rc=$?
  p=$(printf '%s\n' "$out" | grep -c 'PASS:' || true)
  pass=$((pass + p))
  if [ $rc -ne 0 ]; then
    fail=$((fail + 1)); failed_files+=("$(basename "$t")")
    echo "✗ $(basename "$t") ($p pass antes de fallar)"; printf '%s\n' "$out" | grep -E 'ERROR|FAIL|CONTEXT' | head -8
  else
    echo "✓ $(basename "$t") — $p pass"
  fi
done

# --- 4) concurrencia (sesiones reales en paralelo) ----------------------------
for c in "$HERE"/concurrency/*.sh; do
  [ -e "$c" ] || continue
  [ -n "$FILTER" ] && [[ "$(basename "$c")" != *"$FILTER"* ]] && continue
  out=$(PSQL_BIN="$PGBIN/psql" bash "$c" 2>&1); rc=$?
  p=$(printf '%s\n' "$out" | grep -c 'PASS:' || true)
  pass=$((pass + p))
  if [ $rc -ne 0 ]; then
    fail=$((fail + 1)); failed_files+=("$(basename "$c")")
    echo "✗ $(basename "$c")"; printf '%s\n' "$out" | grep -E 'ERROR|FAIL' | head -8
  else
    echo "✓ $(basename "$c") — $p pass"
  fi
done

# --- 4b) precondiciones de migración (base aparte del mismo cluster) ---------
for c in "$HERE"/precondition/*.sh; do
  [ -e "$c" ] || continue
  [ -n "$FILTER" ] && [[ "$(basename "$c")" != *"$FILTER"* ]] && continue
  out=$(PSQL_BIN="$PGBIN/psql" bash "$c" 2>&1); rc=$?
  p=$(printf '%s\n' "$out" | grep -c 'PASS:' || true)
  pass=$((pass + p))
  if [ $rc -ne 0 ]; then
    fail=$((fail + 1)); failed_files+=("$(basename "$c")")
    echo "✗ $(basename "$c")"; printf '%s\n' "$out" | grep -E 'FAIL' | head -8
  else
    echo "✓ $(basename "$c") — $p pass"
  fi
done

# --- 4c) contrato PostgREST real (opcional: requiere POSTGREST_BIN = v14.5) ---
for c in "$HERE"/contract/*.sh; do
  [ -e "$c" ] || continue
  [ -n "$FILTER" ] && [[ "$(basename "$c")" != *"$FILTER"* ]] && continue
  out=$(PSQL_BIN="$PGBIN/psql" PGPORT="$PORT" bash "$c" 2>&1); rc=$?
  p=$(printf '%s\n' "$out" | grep -c 'PASS:' || true)
  pass=$((pass + p))
  if [ $rc -eq 3 ]; then echo "○ $(basename "$c") — OMITIDO (sin POSTGREST_BIN): contrato PostgREST NO probado"
  elif [ $rc -ne 0 ]; then
    fail=$((fail + 1)); failed_files+=("$(basename "$c")")
    echo "✗ $(basename "$c")"; printf '%s\n' "$out" | grep -E 'FAIL' | head -12
  else
    echo "✓ $(basename "$c") — $p pass"
  fi
done

# --- 5) rollback verificable (en transacción, se revierte) -------------------
for rb in "$HERE"/rollback/*.sql; do
  [ -e "$rb" ] || continue
  [ -n "$FILTER" ] && [[ "$(basename "$rb")" != *"$FILTER"* ]] && continue
  out=$("${PSQL[@]}" -f "$rb" 2>&1); rc=$?
  p=$(printf '%s\n' "$out" | grep -c 'PASS:' || true)
  pass=$((pass + p))
  if [ $rc -ne 0 ]; then
    fail=$((fail + 1)); failed_files+=("$(basename "$rb")")
    echo "✗ $(basename "$rb")"; printf '%s\n' "$out" | grep -E 'ERROR|FAIL' | head -8
  else
    echo "✓ $(basename "$rb") — $p pass"
  fi
done

echo "----------------------------------------"
echo "ASSERTS OK: $pass · ARCHIVOS FALLIDOS: $fail ${failed_files[*]:-}"
[ $fail -eq 0 ]
