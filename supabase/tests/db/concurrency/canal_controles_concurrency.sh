#!/usr/bin/env bash
# ============================================================================
# R4-B2-1 · Concurrencia REAL de cc_canal_cambiar (sesiones paralelas):
#   A. 8 pausar/reanudar simultáneos en WhatsApp → estado final = 'despues' del último registro; historial sin huecos
#      (cada registro parte del 'despues' del anterior) y sin errores inesperados.
#   B. cambios simultáneos en canales distintos → cada uno aplica sobre su fila (independencia).
#   C. una activación concurrente con pausas → siempre ACTIVACION_BLOQUEADA; el modo nunca sale de espejo.
# Deja los tres canales como estaban (espejo, sin IA, sin pausa). R4-C6: corre con la compuerta CERRADA (la baja y la reabre).
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
R="$(cd "$(dirname "$0")/../../.." && pwd)"
"${P[@]}" -v ON_ERROR_STOP=1 -f "$R/rollback/whatsapp_compuerta_abierta/99_down.sql" >/dev/null || { echo "FAIL: cerrar la compuerta (R4-C6 down)"; exit 1; }
trap 'rm -rf "$T"; "${P[@]}" -v ON_ERROR_STOP=1 -f "$R/migrations/20270124120000_whatsapp_compuerta_abierta.sql" >/dev/null || echo "FAIL: reabrir la compuerta (R4-C6)"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }

ADMIN=$("${P[@]}" -c "select tests.fixture_admin()") || { echo "FAIL: preparación"; exit 1; }
AS="select tests.act_as('$ADMIN');"
N0=$("${P[@]}" -c "select coalesce(max(id), 0) from public.cc_canal_control_hist")

# A) 8 pausas/reanudaciones simultáneas en WhatsApp
for i in 1 2 3 4 5 6 7 8; do v=$([ $((i % 2)) -eq 0 ] && echo true || echo false)
  ("${P[@]}" -c "$AS select public.cc_canal_cambiar('whatsapp', '{\"envio_pausado\":$v}', 'concurrencia A $i') ->> 'cambiado'" > "$T/a$i.out" 2>&1) & done; wait
grep -qiE 'ERROR' "$T"/a*.out && { echo "FAIL: A · errores: $(cat "$T"/a*.out | grep -i error | head -2 | tr '\n' ' ' | cut -c1-200)"; FAILED=1; } || echo "PASS: A · ninguna sesión falló"
check "A · el estado final coincide con el último registro del historial" "select (select envio_pausado from public.cc_wa_config) = ((select despues ->> 'envio_pausado' from public.cc_canal_control_hist where canal = 'whatsapp' and id > $N0 order by id desc limit 1)::boolean)"
check "A · historial encadenado (cada 'antes' = 'despues' anterior)" "select bool_and(antes = prev) from (select antes, lag(despues) over (order by id) prev from public.cc_canal_control_hist where canal = 'whatsapp' and id > $N0) x where prev is not null"
check "A · tantos registros como cambios efectivos reportados" "select count(*) = $(cat "$T"/a*.out | grep -c '^true$') from public.cc_canal_control_hist where canal = 'whatsapp' and id > $N0"

# B) canales distintos a la vez
for c in whatsapp instagram messenger; do ("${P[@]}" -c "$AS select public.cc_canal_cambiar('$c', '{\"envio_pausado\":true}', 'concurrencia B $c') ->> 'cambiado'" > "$T/b_$c.out" 2>&1) & done; wait
grep -qiE 'ERROR' "$T"/b_*.out && { echo "FAIL: B · errores"; FAILED=1; } || echo "PASS: B · sin errores"
check "B · los tres canales en pausa" "select (select envio_pausado from public.cc_wa_config) and (select bool_and(envio_pausado) from public.cc_meta_config where canal in ('instagram', 'messenger'))"

# C) activación concurrente con pausas: siempre bloqueada
for i in 1 2 3; do ("${P[@]}" -c "$AS select public.cc_canal_cambiar('whatsapp', '{\"modo\":\"activo\"}', 'concurrencia C $i')" > "$T/c$i.out" 2>&1) &
  ("${P[@]}" -c "$AS select public.cc_canal_cambiar('whatsapp', '{\"envio_pausado\":false}', 'concurrencia C pausa $i')" > "$T/cp$i.out" 2>&1) & done; wait
check "C · las 3 activaciones rechazadas con ACTIVACION_BLOQUEADA" "select $(cat "$T"/c[123].out | grep -c 'ACTIVACION_BLOQUEADA') = 3"
check "C · WhatsApp sigue en espejo y sin IA" "select modo = 'espejo' and not ia_habilitada from public.cc_wa_config"

# restaurar
"${P[@]}" -c "$AS select public.cc_canal_cambiar(c, '{\"modo\":\"espejo\",\"envio_pausado\":false}', 'restaurar tras concurrencia') from unnest(array['whatsapp','instagram','messenger']) c" >/dev/null 2>&1
check "restaurado: espejo, sin IA, sin pausa" "select (select modo = 'espejo' and not ia_habilitada and not envio_pausado from public.cc_wa_config) and (select bool_and(modo = 'espejo' and not ia_habilitada and not envio_pausado) from public.cc_meta_config where canal in ('instagram', 'messenger'))"
exit $FAILED
