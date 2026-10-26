#!/usr/bin/env bash
# ============================================================================
# R4-B2-2 · el rollback de la cola se NIEGA si hay mensajes retenidos / inciertos / descartados (no pierde decisiones en
# silencio). Todo en una transacción que nunca se confirma; al final la base queda igual.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
P=("${PSQL_BIN:-psql}" -X -q -At -v ON_ERROR_STOP=1)
DOWN="$ROOT/supabase/rollback/cola_salida_segura/99_down.sql"
FAILED=0
antes=$("${P[@]}" -c "select (select count(*) from public.cc_wa_salida) || ':' || md5(pg_get_functiondef('public.cc_wa_salida_reclamar(integer)'::regprocedure))")
out=$( { echo "begin;"
         echo "alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo' where id;"
         echo "select tests.act_as_service();"
         echo "select public.cc_wa_entrante('5216670007001', 'Down', 'wamid.B22.DOWN', 'hola', false);"
         echo "select public.cc_enviar_mensaje((select conversation_id from public.cc_wa_mensajes where wamid = 'wamid.B22.DOWN'), 'system', null, null, 'sys:solicitud:down', 'x');"
         echo "select tests.act_as_owner();"
         echo "update public.cc_wa_config set envio_pausado = true where id;"
         echo "\\i $DOWN"; echo "rollback;"; } | "${P[@]}" 2>&1 ); rc=$?
if [ $rc -ne 0 ] && grep -q "R4-B2-2 down: hay mensajes retenidos" <<<"$out"; then echo "PASS: el rollback se niega con mensajes retenidos"
else echo "FAIL: el rollback no se negó (rc=$rc): $(tail -3 <<<"$out")"; FAILED=1; fi
despues=$("${P[@]}" -c "select (select count(*) from public.cc_wa_salida) || ':' || md5(pg_get_functiondef('public.cc_wa_salida_reclamar(integer)'::regprocedure))")
if [ "$antes" = "$despues" ]; then echo "PASS: la base quedó idéntica"; else echo "FAIL: cambió la base ($antes → $despues)"; FAILED=1; fi
exit $FAILED
