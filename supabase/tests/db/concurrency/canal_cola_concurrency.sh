#!/usr/bin/env bash
# ============================================================================
# R4-B2-2 · Concurrencia REAL de la cola (sesiones paralelas):
#   A. pausa mientras 3 sesiones reclaman: ningún mensaje queda 'pendiente'; cada uno quedó reclamado ANTES de la pausa
#      ('enviando', y la verificación previa ya dice que no) o retenido; nada se pierde ni se duplica.
#   B. dos administradores deciden los MISMOS mensajes a la vez (liberar vs descartar): cada mensaje se decide UNA vez.
#   C. pausa contra liberación simultánea: al final no queda nada 'pendiente' con el canal en pausa.
# Deja WhatsApp en espejo, sin IA y sin pausa.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"; "${P[@]}" -c "update public.cc_wa_config set modo = '"'"'espejo'"'"', ia_habilitada = false, envio_pausado = false where id; alter table public.cc_wa_config enable trigger trg_cc_wa_config_guardia" >/dev/null 2>&1' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
SVC="select tests.act_as_service();"

"${P[@]}" -c "alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = false, envio_pausado = false where id" >/dev/null || { echo "FAIL: preparación"; exit 1; }
C=$("${P[@]}" -c "$SVC select public.cc_wa_entrante('5216670008001', 'Cola concurrente', 'wamid.B22.CONC', 'hola', false) ->> 'conversation_id'" | tail -1)
"${P[@]}" -c "$SVC select count(public.cc_enviar_mensaje('$C', 'system', null, null, 'sys:solicitud:c' || g, 'aviso ' || g)) from generate_series(1, 11) g" >/dev/null
N=$("${P[@]}" -c "select count(*) from public.cc_wa_salida where conversation_id = '$C' and estado = 'pendiente'")
[ "$N" = "12" ] || { echo "FAIL: preparación (pendientes=$N)"; exit 1; }

# A) pausa mientras 3 sesiones reclaman
for i in 1 2 3; do ("${P[@]}" -c "$SVC select count(*) from public.cc_wa_salida_reclamar(4)" > "$T/a$i.out" 2>&1) & done
("${P[@]}" -c "update public.cc_wa_config set envio_pausado = true where id" > "$T/ap.out" 2>&1) & wait
grep -qiE 'ERROR' "$T"/a*.out && { echo "FAIL: A · errores: $(cat "$T"/a*.out | grep -i error | head -2 | tr '\n' ' ' | cut -c1-200)"; FAILED=1; } || echo "PASS: A · sin errores"
check "A · ningún mensaje quedó pendiente" "select count(*) = 0 from public.cc_wa_salida where conversation_id = '$C' and estado = 'pendiente'"
check "A · los 12 siguen: reclamados antes de la pausa o retenidos" "select count(*) = 12 from public.cc_wa_salida where conversation_id = '$C' and estado in ('enviando', 'retenido')"
SUMA=0; for i in 1 2 3; do v=$(grep -E '^[0-9]+$' "$T/a$i.out" | tail -1); SUMA=$((SUMA + ${v:-0})); done
check "A · lo reclamado coincide con lo que devolvieron las sesiones ($SUMA)" "select count(*) = $SUMA from public.cc_wa_salida where conversation_id = '$C' and estado = 'enviando'"
check "A · con la pausa confirmada, ningún reclamado puede enviarse" "$SVC select coalesce(bool_and(not public.cc_wa_salida_puede_enviar(id)), true) from public.cc_wa_salida where conversation_id = '$C' and estado = 'enviando'"
# la Edge los retiene al verificar
"${P[@]}" -c "$SVC select count(public.cc_wa_salida_resolver(id, false, null, 'retener|canal pausado o fuera de activo antes del envío')) from public.cc_wa_salida where conversation_id = '$C' and estado = 'enviando'" >/dev/null
check "A · todo retenido tras la verificación previa" "select count(*) = 12 from public.cc_wa_salida where conversation_id = '$C' and estado = 'retenido'"

# B) dos administradores, los mismos 12 mensajes, a la vez
"${P[@]}" -c "update public.cc_wa_config set envio_pausado = false where id" >/dev/null
A1=$("${P[@]}" -c "select tests.user('admin')"); A2=$("${P[@]}" -c "select tests.user('admin')")
IDS=$("${P[@]}" -c "select array_agg(id)::text from public.cc_wa_salida where conversation_id = '$C' and estado = 'retenido'")
("${P[@]}" -c "select tests.act_as('$A1'); select public.cc_salida_decidir('whatsapp', '$IDS'::uuid[], 'liberar', 'Concurrencia B liberar') ->> 'aplicados'" > "$T/b1.out" 2>&1) &
("${P[@]}" -c "select tests.act_as('$A2'); select public.cc_salida_decidir('whatsapp', '$IDS'::uuid[], 'descartar', 'Concurrencia B descartar') ->> 'aplicados'" > "$T/b2.out" 2>&1) & wait
grep -qiE 'ERROR' "$T"/b*.out && { echo "FAIL: B · errores: $(cat "$T"/b*.out | grep -i error | head -2 | tr '\n' ' ' | cut -c1-200)"; FAILED=1; } || echo "PASS: B · sin errores ni interbloqueos"
B1=$(grep -E '^[0-9]+$' "$T/b1.out" | tail -1); B2=$(grep -E '^[0-9]+$' "$T/b2.out" | tail -1)
check "B · entre ambos aplicaron exactamente 12 decisiones ($B1 + $B2)" "select ${B1:-0} + ${B2:-0} = 12"
check "B · cada mensaje decidido UNA vez (auditoría)" "select count(*) = 12 and count(distinct salida_id) = 12 from public.cc_salida_decisiones where salida_id = any ('$IDS'::uuid[])"
check "B · cada mensaje quedó liberado o descartado" "select count(*) = 12 from public.cc_wa_salida where id = any ('$IDS'::uuid[]) and estado in ('pendiente', 'descartado')"

# C) pausa contra liberación simultánea
"${P[@]}" -c "update public.cc_wa_config set envio_pausado = true where id" >/dev/null   # mensajes propios de C: nacen retenidos
"${P[@]}" -c "$SVC select count(public.cc_enviar_mensaje('$C', 'system', null, null, 'sys:solicitud:e' || g, 'aviso ' || g)) from generate_series(1, 4) g" >/dev/null
"${P[@]}" -c "update public.cc_wa_config set envio_pausado = false where id" >/dev/null
IDS2=$("${P[@]}" -c "select array_agg(s.id)::text from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id like 'sys:solicitud:e%' and s.estado = 'retenido'")
if [ -n "$IDS2" ]; then
  ("${P[@]}" -c "select tests.act_as('$A1'); select public.cc_salida_decidir('whatsapp', '$IDS2'::uuid[], 'liberar', 'Concurrencia C liberar') ->> 'aplicados'" > "$T/c1.out" 2>&1) &
  ("${P[@]}" -c "update public.cc_wa_config set envio_pausado = true where id" > "$T/c2.out" 2>&1) & wait
  check "C · con la pausa confirmada no queda nada pendiente (liberó antes y la pausa retuvo, o no liberó)" "select (select envio_pausado from public.cc_wa_config) and count(*) = 0 from public.cc_wa_salida where conversation_id = '$C' and estado = 'pendiente'"
  grep -q 'CANAL_NO_HABILITADO' "$T/c1.out" && echo "   C: la pausa ganó (CANAL_NO_HABILITADO)" || echo "   C: la liberación ganó y la pausa la retuvo"
else echo "FAIL: C · sin retenidos para probar"; FAILED=1; fi

# A2) DETERMINISTA: una sesión reclama y sostiene su transacción; la pausa llega DESPUÉS y debe esperar (candado compartido)
"${P[@]}" -c "update public.cc_wa_config set envio_pausado = false where id" >/dev/null
"${P[@]}" -c "$SVC select count(public.cc_enviar_mensaje('$C', 'system', null, null, 'sys:solicitud:d' || g, 'aviso ' || g)) from generate_series(1, 6) g" >/dev/null
("${P[@]}" -c "begin; $SVC select count(*) from public.cc_wa_salida_reclamar(4); select pg_sleep(1.5); commit;" > "$T/a2r.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "update public.cc_wa_config set envio_pausado = true where id" > "$T/a2p.out" 2>&1) & wait
check "A2 · reclamó 4 ANTES de la pausa" "select count(*) = 4 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id like 'sys:solicitud:d%' and s.estado = 'enviando'"
check "A2 · la pausa esperó y retuvo los otros 2" "select count(*) = 2 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id like 'sys:solicitud:d%' and s.estado = 'retenido'"
check "A2 · los 4 reclamados ya no pueden enviarse (verificación previa)" "$SVC select bool_and(not public.cc_wa_salida_puede_enviar(s.id)) from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id like 'sys:solicitud:d%' and s.estado = 'enviando'"

# C2) DETERMINISTA: la liberación sostiene su transacción; la pausa llega después, espera y retiene lo liberado
"${P[@]}" -c "$SVC select count(public.cc_wa_salida_resolver(s.id, false, null, 'retener|prueba')) from public.cc_wa_salida s where s.conversation_id = '$C' and s.estado = 'enviando'" >/dev/null
"${P[@]}" -c "update public.cc_wa_config set envio_pausado = false where id" >/dev/null
IDS3=$("${P[@]}" -c "select array_agg(s.id)::text from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id like 'sys:solicitud:d%' and s.estado = 'retenido'")
("${P[@]}" -c "begin; select tests.act_as('$A1'); select public.cc_salida_decidir('whatsapp', '$IDS3'::uuid[], 'liberar', 'Concurrencia C2 liberar') ->> 'aplicados'; select pg_sleep(1.5); commit;" > "$T/c2l.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "update public.cc_wa_config set envio_pausado = true where id" > "$T/c2p.out" 2>&1) & wait
check "C2 · la liberación se aplicó (6)" "select $(grep -E '^[0-9]+$' "$T/c2l.out" | tail -1) = 6"
check "C2 · la pausa esperó y volvió a retener lo liberado: nada pendiente" "select count(*) = 0 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id like 'sys:solicitud:d%' and s.estado = 'pendiente'"
check "C2 · las 6 decisiones quedaron auditadas" "select count(*) = 6 from public.cc_salida_decisiones where salida_id = any ('$IDS3'::uuid[])"
exit $FAILED
