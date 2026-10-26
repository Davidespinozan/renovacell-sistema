#!/usr/bin/env bash
# ============================================================================
# R4-B2-3a · Concurrencia REAL (sesiones paralelas):
#   A. 6 avisos de falla simultáneos en la misma conversación de canal → UNA transferencia y UN aviso.
#   B. apagar la IA mientras se guarda la respuesta del turno (5 rondas) → en cada ronda, o se guardó ANTES del apagado
#      (turno completed + 1 mensaje de IA) o se descartó con ia_apagada (0 mensajes); nunca a medias.
# Deja WhatsApp en espejo, sin IA y sin pausa.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"; "${P[@]}" -c "update public.cc_wa_config set modo = '"'"'espejo'"'"', ia_habilitada = false, envio_pausado = false where id" >/dev/null 2>&1' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
SVC="select tests.act_as_service();"

"${P[@]}" -c "update public.cc_wa_config set modo = 'activo', ia_habilitada = true, envio_pausado = false where id" >/dev/null || { echo "FAIL: preparación"; exit 1; }
C=$("${P[@]}" -c "$SVC select public.cc_wa_entrante('5216670009001', 'Concurrencia A', 'wamid.B23A.CONC.A', 'hola', false) ->> 'conversation_id'" | tail -1)
[ -n "$C" ] || { echo "FAIL: conversación A"; exit 1; }

# A) 6 avisos de falla simultáneos
for i in 1 2 3 4 5 6; do ("${P[@]}" -c "$SVC select public.cc_ia_aviso_no_disponible('$C') ->> 'transferido'" > "$T/a$i.out" 2>&1) & done; wait
grep -qiE 'ERROR' "$T"/a*.out && { echo "FAIL: A · errores: $(cat "$T"/a*.out | grep -i error | head -2 | tr '\n' ' ' | cut -c1-200)"; FAILED=1; } || echo "PASS: A · sin errores"
check "A · exactamente una sesión transfirió" "select $(cat "$T"/a*.out | grep -c '^true$') = 1"
check "A · un solo aviso de falla" "select count(*) = 1 from public.cc_messages where conversation_id = '$C' and client_message_id like 'sys:falla_ia:%'"
check "A · un solo evento human_requested" "select count(*) = 1 from public.cc_conversation_events where conversation_id = '$C' and tipo = 'human_requested'"

# B) apagado de IA contra guardado de respuesta, 5 rondas
ok=0
for k in 1 2 3 4 5; do
  "${P[@]}" -c "update public.cc_wa_config set ia_habilitada = true where id" >/dev/null
  R=$("${P[@]}" -c "$SVC select public.cc_wa_entrante('52166700092$k$k', 'Concurrencia B$k', 'wamid.B23A.CONC.B$k', 'hola', false)::text" | tail -1)
  CB=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['conversation_id'])" "$R"); SQ=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['seq'])" "$R")
  TURN=$("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CB', $SQ, 'anthropic', 'm') ->> 'turn_id'" | tail -1)
  ("${P[@]}" -c "$SVC select public.cc_ia_turno_responder('$TURN', 'respuesta $k', 'GENERAL_CHAT') ->> 'persistido'" > "$T/b$k.out" 2>&1) &
  ("${P[@]}" -c "update public.cc_wa_config set ia_habilitada = false where id" > "$T/bo$k.out" 2>&1) & wait
  r=$("${P[@]}" -c "select case when t.status = 'completed' and (select count(*) from public.cc_messages where conversation_id = '$CB' and actor_type = 'ai') = 1 then 'guardada'
                                when t.status = 'discarded' and t.error_class = 'ia_apagada' and (select count(*) from public.cc_messages where conversation_id = '$CB' and actor_type = 'ai') = 0 then 'descartada'
                                else 'INCONSISTENTE:' || t.status || '/' || coalesce(t.error_class, '-') end from public.cc_ai_turns t where t.id = '$TURN'")
  echo "   ronda $k: $r"; [[ "$r" == guardada || "$r" == descartada ]] && ok=$((ok + 1))
done
check "B · las 5 rondas consistentes (guardada antes del apagado o descartada por ia_apagada)" "select $ok = 5"
exit $FAILED
