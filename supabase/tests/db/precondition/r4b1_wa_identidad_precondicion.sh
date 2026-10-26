#!/usr/bin/env bash
# ============================================================================
# R4-B1 · la migración 20270117120000 debe ABORTAR (sin aplicar nada) si ya existe un contacto de WhatsApp ligado a un
# perfil, y debe exigir la definición exacta de la 167. Todo en una transacción que nunca se confirma (la base de pruebas
# queda igual: se comprueba al final).
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
P=("${PSQL_BIN:-psql}" -X -q -At -v ON_ERROR_STOP=1)
MIG="$ROOT/supabase/migrations/20270117120000_wa_identidad_fail_closed.sql"
DOWN="$ROOT/supabase/rollback/wa_identidad_fail_closed/99_down.sql"
FAILED=0
antes=$("${P[@]}" -c "select md5(pg_get_functiondef('public._cc_wa_perfil(text)'::regprocedure)) || ':' || (select count(*) from public.cc_wa_contactos)")

# 1) con un contacto ligado → aborta en la precondición
out=$( { echo "begin;"; echo "\\i $DOWN"
         echo "insert into public.cc_wa_contactos (wa_id, profile_id) values ('5210000000001', tests.user('doctor'));"
         echo "\\i $MIG"; echo "rollback;"; } | "${P[@]}" 2>&1 ); rc=$?
if [ $rc -ne 0 ] && grep -q "R4-B1: hay contactos de WhatsApp ligados" <<<"$out"; then echo "PASS: con un contacto ligado la migración aborta en la precondición"
else echo "FAIL: no abortó como se esperaba (rc=$rc): $(tail -3 <<<"$out")"; FAILED=1; fi

# 2) ya aplicada (definición distinta de la 167) → aborta, no reescribe
out=$( { echo "begin;"; echo "\\i $MIG"; echo "rollback;"; } | "${P[@]}" 2>&1 ); rc=$?
if [ $rc -ne 0 ] && grep -q "R4-B1: _cc_wa_perfil no tiene la definición esperada" <<<"$out"; then echo "PASS: sobre una función que no es la de la 167 aborta"
else echo "FAIL: reaplicó sobre una definición inesperada (rc=$rc): $(tail -3 <<<"$out")"; FAILED=1; fi

# 3) nada quedó a medias
despues=$("${P[@]}" -c "select md5(pg_get_functiondef('public._cc_wa_perfil(text)'::regprocedure)) || ':' || (select count(*) from public.cc_wa_contactos)")
if [ "$antes" = "$despues" ]; then echo "PASS: la base quedó idéntica (función y contactos)"; else echo "FAIL: cambió la base ($antes → $despues)"; FAILED=1; fi
exit $FAILED
