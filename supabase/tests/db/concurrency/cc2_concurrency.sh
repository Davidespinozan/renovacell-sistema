#!/usr/bin/env bash
# ============================================================================
# CC-2 · Concurrencia REAL de la conversación: las cardinalidades las sostiene la base.
#   A. 10 aperturas simultáneas del mismo visitante → 1 conversación abierta.
#   B. mismo client_message_id a la vez → 1 mensaje.
#   C. adoptar mientras se envía → el mensaje queda en la MISMA conversación.
#   D. dos asesores se asignan a la vez → exactamente uno.
#   F. takeover humano vs IA simultánea → la IA no entra después del takeover.
#   G. cerrar/reabrir concurrente → estado válido y eventos coherentes.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
SVC="select tests.act_as_service();"
HA=$(printf 'a%.0s' $(seq 1 64)); HB=$(printf 'b%.0s' $(seq 1 64)); HC=$(printf 'c%.0s' $(seq 1 64)); HD=$(printf 'd%.0s' $(seq 1 64))

"${P[@]}" -c "do \$\$ declare d uuid := tests.user('doctor'); p1 uuid := tests.user('pos'); p2 uuid := tests.user('pos'); begin
  insert into tests.ctx values ('cc2_doc', d), ('cc2_p1', p1), ('cc2_p2', p2);
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{\"capabilities\":[\"conversaciones\"]}' where id in (p1, p2);
  perform public.cc_visitante_abrir(null, '$HA', '{}'::jsonb, null);
  perform public.cc_visitante_abrir(null, '$HB', '{}'::jsonb, null);
  perform public.cc_visitante_abrir(null, '$HC', '{}'::jsonb, null);
  perform public.cc_visitante_abrir(null, '$HD', '{}'::jsonb, null);
end \$\$;" >/dev/null

# ── A) 10 aperturas simultáneas del MISMO visitante
for i in $(seq 1 10); do ("${P[@]}" -c "$SVC select public.cc_abrir_conversacion('$HA', null) ->> 'conversation_id'" > "$T/a$i.out" 2>&1) & done; wait
IDS=$(cat "$T"/a*.out | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l | tr -d ' ')
[ "$IDS" = "1" ] && echo "PASS: A · 10 aperturas simultáneas → 1 conversación (todas devolvieron el mismo id)" || { echo "FAIL: A · ids distintos=$IDS: $(cat "$T"/a*.out | grep -i error | head -1)"; FAILED=1; }
check "A · una sola abierta del visitante" "select count(*) = 1 from public.cc_conversations c join public.cc_visitors v on v.id = c.visitor_id where v.token_hash = '$HA' and c.estado = 'abierta'"
CA=$("${P[@]}" -c "select c.id from public.cc_conversations c join public.cc_visitors v on v.id = c.visitor_id where v.token_hash = '$HA' and c.estado = 'abierta'" | tail -n1)

# ── B) mismo client_message_id a la vez → 1 mensaje
for i in $(seq 1 8); do ("${P[@]}" -c "$SVC select public.cc_enviar_mensaje('$CA', 'visitor', '$HA', null, 'c:dup', 'mismo texto') ->> 'id'" > "$T/b$i.out" 2>&1) & done; wait
check "B · un solo mensaje con ese client_message_id" "select count(*) = 1 from public.cc_messages where conversation_id = '$CA' and client_message_id = 'c:dup'"
MIDS=$(cat "$T"/b*.out | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l | tr -d ' ')
[ "$MIDS" = "1" ] && echo "PASS: B · todas las sesiones recibieron el mismo id" || { echo "FAIL: B · ids=$MIDS"; FAILED=1; }
check "B · los seq son consecutivos sin huecos" "select max(seq) = count(*) from public.cc_messages where conversation_id = '$CA'"

# ── C) adoptar mientras se envía → mismo conversation_id
CB=$("${P[@]}" -c "$SVC select public.cc_abrir_conversacion('$HB', null) ->> 'conversation_id'" | tail -n1)
("${P[@]}" -c "$SVC select public.cc_visitante_adoptar('$HB', tests.id('cc2_doc')) ->> 'estado'" > "$T/c1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_enviar_mensaje('$CB', 'visitor', '$HB', null, 'c:race', 'enviando mientras adoptan') ->> 'seq'" > "$T/c2.out" 2>&1) &
wait
check "C · la conversación conserva su id y ahora es del doctor" "select profile_id = tests.id('cc2_doc') from public.cc_conversations where id = '$CB'"
check "C · el mensaje (si entró antes de rotar el token) está en la MISMA conversación; si no, el token ya no servía (sin mensaje huérfano)" "select (select count(*) from public.cc_messages where client_message_id = 'c:race') = (select count(*) from public.cc_messages where client_message_id = 'c:race' and conversation_id = '$CB')"
grep -qE '^[0-9]+$|SESION_INVALIDA|NO_AUTORIZADO' "$T/c2.out" && echo "PASS: C · el envío concurrente terminó en seq válido o fue rechazado tras la adopción (nunca en otra conversación, nunca deadlock)" || { echo "FAIL: C · $(cat "$T/c2.out" | tr '\n' ' ' | cut -c1-120)"; FAILED=1; }

# ── D) dos asesores se asignan a la vez → exactamente uno
CC=$("${P[@]}" -c "$SVC select public.cc_abrir_conversacion('$HC', null) ->> 'conversation_id'" | tail -n1)
"${P[@]}" -c "$SVC select public.cc_solicitar_asesor('$CC', 'visitor', '$HC', null)" >/dev/null
("${P[@]}" -c "$SVC select public.cc_asignar_asesor('$CC', tests.id('cc2_p1'), tests.id('cc2_p1')) ->> 'seller'" > "$T/d1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_asignar_asesor('$CC', tests.id('cc2_p2'), tests.id('cc2_p2')) ->> 'seller'" > "$T/d2.out" 2>&1) &
wait
GANA=$(cat "$T"/d1.out "$T"/d2.out | grep -cE '^[0-9a-f-]{36}$' || true); PIERDE=$(cat "$T"/d1.out "$T"/d2.out | grep -c 'YA_ASIGNADA' || true)
[ "$GANA" = "1" ] && [ "$PIERDE" = "1" ] && echo "PASS: D · exactamente un asesor se la quedó; el otro recibió YA_ASIGNADA" || { echo "FAIL: D · gana=$GANA pierde=$PIERDE: $(cat "$T"/d1.out "$T"/d2.out | tr '\n' ' ' | cut -c1-160)"; FAILED=1; }
check "D · un solo evento human_assigned" "select count(*) = 1 from public.cc_conversation_events where conversation_id = '$CC' and tipo = 'human_assigned'"

# ── F) takeover humano vs IA simultánea
SELLER=$("${P[@]}" -c "select seller_profile_id from public.cc_conversations where id = '$CC'")
("${P[@]}" -c "$SVC select public.cc_iniciar_asesoria('$CC', '$SELLER') ->> 'modo'" > "$T/f1.out" 2>&1) &
("${P[@]}" -c "$SVC select pg_sleep(0.05); select public.cc_enviar_mensaje('$CC', 'ai', null, null, 'ai:race', 'intento de IA durante el takeover') ->> 'seq'" > "$T/f2.out" 2>&1) &
wait
check "F · tras el takeover el modo es human_active" "select modo = 'human_active' from public.cc_conversations where id = '$CC'"
check "F · si la IA entró, fue ANTES del inicio (seq menor que el mensaje de sistema de inicio); si no, fue rechazada" "select coalesce((select m.seq < s.seq from public.cc_messages m, public.cc_messages s where m.conversation_id = '$CC' and m.client_message_id = 'ai:race' and s.conversation_id = '$CC' and s.actor_type = 'system' and s.content like '%se unió%'), true)"
grep -qE '^[0-9]+$|IA_SILENCIADA' "$T/f2.out" && echo "PASS: F · la IA terminó en seq previo o en IA_SILENCIADA" || { echo "FAIL: F · $(cat "$T/f2.out" | tr '\n' ' ' | cut -c1-120)"; FAILED=1; }
check "F · la IA nunca escribe después de human_active" "select not exists (select 1 from public.cc_messages m where m.conversation_id = '$CC' and m.actor_type = 'ai' and m.seq > (select min(seq) from public.cc_messages s where s.conversation_id = '$CC' and s.actor_type = 'system' and s.content like '%se unió%'))"

# ── G) cerrar/reabrir concurrente
CD=$("${P[@]}" -c "$SVC select public.cc_abrir_conversacion('$HD', null) ->> 'conversation_id'" | tail -n1)
for i in 1 2 3; do ("${P[@]}" -c "$SVC select public.cc_cerrar_conversacion('$CD', 'visitor', '$HD', null) ->> 'estado'" > "$T/g$i.out" 2>&1) & done; wait
for i in 4 5 6; do ("${P[@]}" -c "$SVC select public.cc_reabrir_conversacion('$CD', 'visitor', '$HD', null) ->> 'estado'" > "$T/g$i.out" 2>&1) & done; wait
check "G · estado final válido (abierta)" "select estado = 'abierta' and (closed_at is null) from public.cc_conversations where id = '$CD'"
check "G · exactamente 1 evento closed y 1 reopened" "select (select count(*) from public.cc_conversation_events where conversation_id = '$CD' and tipo = 'conversation_closed') = 1 and (select count(*) from public.cc_conversation_events where conversation_id = '$CD' and tipo = 'conversation_reopened') = 1"

"${P[@]}" -c "delete from tests.ctx where key like 'cc2_%'" >/dev/null
exit $FAILED
