#!/usr/bin/env bash
# Genera supabase/ops/w1_p4_apply.sql: M1–M4 VERBATIM + registro en el historial de migraciones,
# en UNA sola transacción (BEGIN/COMMIT propios). Cualquier error ⇒ nada queda aplicado.
# No ejecuta nada. Imprime sha256 de cada migración para cotejar antes de P4.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; OUT="$ROOT/supabase/ops/w1_p4_apply.sql"
M=(20261012120000_w1_m1_schema 20261012120100_w1_m2_constraints 20261012120200_w1_m3_commands 20261012120300_w1_m4_authority)
{
  echo "-- GENERADO por supabase/ops/build_w1_p4_bundle.sh — NO EDITAR A MANO."
  echo "-- W1 · P4: M1→M4 + historial en UNA transacción. Ejecutar SOLO con autorización de David,"
  echo "-- DESPUÉS de w1_base_limpia.sql. Uso: psql -X -v ON_ERROR_STOP=1 -f supabase/ops/w1_p4_apply.sql"
  for m in "${M[@]}"; do echo "-- sha256 ${m}.sql $(shasum -a 256 "$ROOT/supabase/migrations/$m.sql" | cut -d' ' -f1)"; done
  echo "begin;"
  echo "set local lock_timeout = '10s';"
  for m in "${M[@]}"; do
    echo; echo "-- >>>>>>>>>>>>>>>> $m.sql"
    cat "$ROOT/supabase/migrations/$m.sql"
  done
  echo; echo "-- >>>>>>>>>>>>>>>> historial de migraciones (misma transacción: esquema + historial atómicos)"
  for m in "${M[@]}"; do
    v="${m%%_*}"; n="${m#*_}"
    echo "insert into supabase_migrations.schema_migrations (version, name, statements) values ('$v', '$n', '{}') on conflict (version) do nothing;"
  done
  echo "commit;"
} > "$OUT"
echo "bundle: $OUT ($(wc -l < "$OUT") líneas) sha256 $(shasum -a 256 "$OUT" | cut -d' ' -f1)"
