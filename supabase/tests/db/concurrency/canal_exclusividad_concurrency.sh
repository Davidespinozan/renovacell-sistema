#!/usr/bin/env bash
# ============================================================================
# R4-B2-3b · Concurrencia REAL de exclusividad y toma (intercalaciones DETERMINISTAS con transacciones sostenidas):
#   A. dos administradores toman a la vez → uno gana; el otro recibe ATENDIDA_POR_OTRO.
#   B. la asesora inicia mientras Dirección intenta tomar → quien llega segundo es rechazado; una sola persona atiende.
#   C. IA guardando vs toma: (C1) la toma primero → la IA se descarta; (C2) la IA guardó primero → su mensaje queda y
#      después Dirección toma. Nunca ambos "a la vez".
#   D. cambio a espejo durante una respuesta de Dirección → la respuesta se rechaza (CANAL_EN_ESPEJO); nada sale.
#   E. terminar la asesoría mientras llega un mensaje del cliente → el mensaje queda una vez y la atención termina limpia.
# Deja WhatsApp en espejo, sin IA y sin pausa.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"; "${P[@]}" -c "update public.cc_wa_config set modo = '"'"'espejo'"'"', ia_habilitada = false, envio_pausado = false where id" >/dev/null 2>&1' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
SVC="select tests.act_as_service();"
conv() { "${P[@]}" -c "$SVC select public.cc_wa_entrante('$1', 'Conc', '$2', 'hola', false)::text" | tail -1; }
cid() { python3 -c "import json,sys;print(json.loads(sys.argv[1])['conversation_id'])" "$1"; }
seq() { python3 -c "import json,sys;print(json.loads(sys.argv[1])['seq'])" "$1"; }

"${P[@]}" -c "update public.cc_wa_config set modo = 'activo', ia_habilitada = true, envio_pausado = false where id" >/dev/null || { echo "FAIL: preparación"; exit 1; }
A1=$("${P[@]}" -c "select tests.user('admin')" | tail -1); A2=$("${P[@]}" -c "select tests.user('admin')" | tail -1); S1=$("${P[@]}" -c "select tests.user('pos')" | tail -1)
"${P[@]}" -c "$SVC update public.profiles set meta = coalesce(meta, '{}') || '{\"capabilities\":[\"conversaciones\"]}' where id = '$S1'" >/dev/null

# A) dos admins: A1 toma y sostiene; A2 llega después
CA=$(cid "$(conv 5216670004001 wamid.B23B.CA)")
("${P[@]}" -c "begin; select tests.act_as('$A1'); select public.cc_tomar_conversacion('$CA') ->> 'tomada_por'; select pg_sleep(1.2); commit;" > "$T/a1.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "select tests.act_as('$A2'); select public.cc_tomar_conversacion('$CA')" > "$T/a2.out" 2>&1) & wait
check "A · el primero tomó" "select tomada_por = '$A1' from public.cc_conversations where id = '$CA'"
check "A · el segundo esperó y fue rechazado (ATENDIDA_POR_OTRO)" "select $(grep -c ATENDIDA_POR_OTRO "$T/a2.out") = 1"
check "A · un solo human_started" "select count(*) = 1 from public.cc_conversation_events where conversation_id = '$CA' and tipo = 'human_started'"

# B) asesora inicia y sostiene; Dirección llega después
CB=$(cid "$(conv 5216670004002 wamid.B23B.CB)")
"${P[@]}" -c "$SVC select public.cc_asignar_asesor('$CB', '$A1', '$S1')" >/dev/null
("${P[@]}" -c "begin; $SVC select public.cc_iniciar_asesoria('$CB', '$S1') ->> 'modo'; select pg_sleep(1.2); commit;" > "$T/b1.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "select tests.act_as('$A2'); select public.cc_tomar_conversacion('$CB')" > "$T/b2.out" 2>&1) & wait
check "B · la asesora atiende (sin toma de Dirección)" "select modo = 'human_active' and tomada_por is null and seller_profile_id = '$S1' from public.cc_conversations where id = '$CB'"
check "B · Dirección llegó después: ATENDIDA_POR_OTRO" "select $(grep -c ATENDIDA_POR_OTRO "$T/b2.out") = 1"
"${P[@]}" -c "$SVC select public.cc_enviar_mensaje('$CB', 'seller', null, '$S1', 'b:1', 'Hola, soy tu asesora')" > "$T/b3.out" 2>&1
check "B · la asesora escribe" "select $(grep -ci error "$T/b3.out") = 0"

# C1) Dirección toma y sostiene; la IA intenta guardar después → descartada
R=$(conv 5216670004003 wamid.B23B.CC1); CC=$(cid "$R")
TURN=$("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CC', $(seq "$R"), 'anthropic', 'm') ->> 'turn_id'" | tail -1)
("${P[@]}" -c "begin; select tests.act_as('$A1'); select public.cc_tomar_conversacion('$CC'); select pg_sleep(1.2); commit;" > "$T/c1t.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "$SVC select public.cc_ia_turno_responder('$TURN', 'IA tarde', 'GENERAL_CHAT')::text" > "$T/c1r.out" 2>&1) & wait
check "C1 · la IA llegó después de la toma: descartada (takeover_humano)" "select status = 'discarded' and error_class = 'takeover_humano' from public.cc_ai_turns where id = '$TURN'"
check "C1 · ningún mensaje de IA" "select count(*) = 0 from public.cc_messages where conversation_id = '$CC' and actor_type = 'ai'"
# C2) la IA guarda y sostiene; Dirección llega después → la respuesta de la IA queda (anterior a la toma)
R=$(conv 5216670004004 wamid.B23B.CC2); CD=$(cid "$R")
TURN=$("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CD', $(seq "$R"), 'anthropic', 'm') ->> 'turn_id'" | tail -1)
("${P[@]}" -c "begin; $SVC select public.cc_ia_turno_responder('$TURN', 'IA a tiempo', 'GENERAL_CHAT') ->> 'persistido'; select pg_sleep(1.2); commit;" > "$T/c2r.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "select tests.act_as('$A1'); select public.cc_tomar_conversacion('$CD') ->> 'modo'" > "$T/c2t.out" 2>&1) & wait
check "C2 · la IA guardó antes: su mensaje queda y sale" "select count(*) = 1 from public.cc_messages m join public.cc_wa_salida s on s.message_id = m.id where m.conversation_id = '$CD' and m.actor_type = 'ai'"
check "C2 · después Dirección tomó" "select modo = 'human_active' and tomada_por = '$A1' from public.cc_conversations where id = '$CD'"
check "C2 · la IA ya no puede reclamar" "$SVC select public.cc_ia_turno_reclamar('$CD', (select max(seq) from public.cc_messages where conversation_id = '$CD'), 'anthropic', 'm') ->> 'estado' in ('silenciado', 'ya_completado')"

# D) cambio a espejo sostenido; Dirección intenta responder después → rechazada
("${P[@]}" -c "begin; update public.cc_wa_config set modo = 'espejo' where id; select pg_sleep(1.2); commit;" > "$T/d1.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "$SVC select public.cc_enviar_mensaje('$CA', 'admin', null, '$A1', 'd:1', 'Respuesta durante el cambio')" > "$T/d2.out" 2>&1) & wait
check "D · la respuesta esperó al cambio y fue rechazada (CANAL_EN_ESPEJO)" "select $(grep -c CANAL_EN_ESPEJO "$T/d2.out") = 1"
check "D · nada se guardó ni salió" "select count(*) = 0 from public.cc_messages where conversation_id = '$CA' and client_message_id = 'd:1'"
"${P[@]}" -c "update public.cc_wa_config set modo = 'activo' where id" >/dev/null

# E) terminar (sostenido) mientras llega un mensaje del cliente
("${P[@]}" -c "begin; $SVC select public.cc_terminar_asesoria('$CB', '$S1'); select pg_sleep(1.2); commit;" > "$T/e1.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "$SVC select public.cc_wa_entrante('5216670004002', null, 'wamid.B23B.CE', 'una pregunta más', false) ->> 'conversation_id'" > "$T/e2.out" 2>&1) & wait
grep -qiE 'ERROR' "$T"/e*.out && { echo "FAIL: E · errores: $(cat "$T"/e*.out | grep -i error | head -2 | tr '\n' ' ' | cut -c1-200)"; FAILED=1; } || echo "PASS: E · sin errores"
check "E · el mensaje del cliente quedó una vez" "select count(*) = 1 from public.cc_wa_mensajes where wamid = 'wamid.B23B.CE'"
check "E · la atención terminó limpia (sin human_active ni toma)" "select modo <> 'human_active' and tomada_por is null from public.cc_conversations where id = '$CB'"
exit $FAILED
