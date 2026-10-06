#!/usr/bin/env bash
# ============================================================================
# CC-4 · Concurrencia REAL del turno de IA (la base sostiene las cardinalidades).
#   A. mismo disparador → 8 workers → 1 reclamo gana, el resto en_curso; 1 mensaje ai.
#   B. dos disparadores a la vez (N, N+1) → el más nuevo gana; el viejo se persiste antes o se descarta como superado.
#   C. takeover humano mientras el proveedor "responde" → la respuesta tardía no entra.
#   D. cierre de la conversación mientras corre → sin escritura tardía.
#   E. reintento tras timeout → mismo turno, mismo mensaje (1).
#   F. responder concurrente al mismo turno → 1 mensaje.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
SVC="select tests.act_as_service();"
HA=$(printf '4%.0s' $(seq 1 64)); HB=$(printf '5%.0s' $(seq 1 64)); HC=$(printf '6%.0s' $(seq 1 64)); HD=$(printf '7%.0s' $(seq 1 64))   # hashes propios: cc1/cc2 concurrency usan a-d y dejan estado

"${P[@]}" -c "do \$\$ declare p1 uuid := tests.user('pos'); begin
  delete from tests.ctx where key like 'cc4_%'; insert into tests.ctx values ('cc4_p1', p1), ('cc4_adm', tests.fixture_admin());
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{\"capabilities\":[\"conversaciones\"]}' where id = p1;
  perform public.cc_visitante_abrir(null, '$HA', '{}'::jsonb, null); perform public.cc_visitante_abrir(null, '$HB', '{}'::jsonb, null);
  perform public.cc_visitante_abrir(null, '$HC', '{}'::jsonb, null); perform public.cc_visitante_abrir(null, '$HD', '{}'::jsonb, null);
end \$\$;" >/dev/null
conv() { "${P[@]}" -c "$SVC select public.cc_abrir_conversacion('$1', null) ->> 'conversation_id'" | tail -n1; }
msg() { "${P[@]}" -c "$SVC select public.cc_enviar_mensaje('$1', 'visitor', '$2', null, '$3', 'mensaje $3') ->> 'seq'" | tail -n1; }

# ── A) mismo disparador, 8 workers
CA=$(conv "$HA"); S1=$(msg "$CA" "$HA" c:1)
for i in $(seq 1 8); do ("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CA', $S1, 'falso', 'f', 60) ->> 'estado'" > "$T/a$i.out" 2>&1) & done; wait
G=$(cat "$T"/a*.out | grep -c '^reclamado$' || true); E=$(cat "$T"/a*.out | grep -c '^en_curso$' || true)
[ "$G" = "1" ] && [ "$E" = "7" ] && echo "PASS: A · 1 reclamó, 7 vieron en_curso" || { echo "FAIL: A · reclamado=$G en_curso=$E: $(cat "$T"/a*.out | sort | uniq -c | tr '\n' ' ')"; FAILED=1; }
check "A · un solo turno para ese disparador" "select count(*) = 1 from public.cc_ai_turns where conversation_id = '$CA' and trigger_seq = $S1"
TA=$("${P[@]}" -c "select id from public.cc_ai_turns where conversation_id = '$CA' and trigger_seq = $S1" | tail -n1)

# ── F) responder concurrente al mismo turno → 1 mensaje
for i in $(seq 1 6); do ("${P[@]}" -c "$SVC select public.cc_ia_turno_responder('$TA', 'respuesta A') ->> 'persistido'" > "$T/f$i.out" 2>&1) & done; wait
check "F · un solo mensaje ai para el turno" "select count(*) = 1 from public.cc_messages where conversation_id = '$CA' and actor_type = 'ai'"
[ "$(cat "$T"/f*.out | grep -c '^true$' || true)" = "6" ] && echo "PASS: F · las 6 sesiones terminaron persistido=true (idempotente)" || { echo "FAIL: F · $(cat "$T"/f*.out | tr '\n' ' ')"; FAILED=1; }

# ── B) N y N+1 a la vez: "el más nuevo gana" — nunca se persiste una respuesta fuera de orden
CB=$(conv "$HB"); S1=$(msg "$CB" "$HB" c:1); S2=$(msg "$CB" "$HB" c:2)
("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CB', $S1, 'falso', 'f', 60) ->> 'estado'" > "$T/b1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CB', $S2, 'falso', 'f', 60) ->> 'estado'" > "$T/b2.out" 2>&1) &
wait
R1=$(tail -n1 "$T/b1.out"); R2=$(tail -n1 "$T/b2.out")
{ [ "$R2" = "reclamado" ] && { [ "$R1" = "reclamado" ] || [ "$R1" = "superado" ]; }; } && echo "PASS: B · N+1 siempre se reclama; N queda reclamado (si llegó antes) o superado (si llegó después): r1=$R1" || { echo "FAIL: B · r1=$R1 r2=$R2"; FAILED=1; }
TB1=$("${P[@]}" -c "select id from public.cc_ai_turns where conversation_id = '$CB' and trigger_seq = $S1" | tail -n1)
TB2=$("${P[@]}" -c "select id from public.cc_ai_turns where conversation_id = '$CB' and trigger_seq = $S2" | tail -n1)
# la respuesta del viejo llega tarde y la del nuevo también: solo la del nuevo entra; la del viejo se descarta como superada
("${P[@]}" -c "$SVC select public.cc_ia_turno_responder('$TB1', 'respuesta vieja') ->> 'persistido'" > "$T/b3.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_ia_turno_responder('$TB2', 'respuesta nueva') ->> 'persistido'" > "$T/b4.out" 2>&1) &
wait
check "B · el disparador más nuevo tiene su respuesta" "select exists (select 1 from public.cc_messages where conversation_id = '$CB' and actor_type = 'ai' and client_message_id = 'ai:$S2')"
check "B · ninguna respuesta persistida con client_id menor a otra ya reclamada después de ella (orden por disparador)" "select not exists (select 1 from public.cc_ai_turns v join public.cc_ai_turns n on n.conversation_id = v.conversation_id and n.trigger_seq > v.trigger_seq where v.conversation_id = '$CB' and v.status = 'completed' and n.status in ('provider_running','completed') and v.finished_at > n.started_at)"
check "B · el viejo terminó completed (antes) o discarded:superado; nunca running" "select status in ('completed','discarded') and (status = 'completed' or error_class = 'superado') from public.cc_ai_turns where id = '$TB1'"

# ── C) takeover humano mientras corre
CC=$(conv "$HC"); S1=$(msg "$CC" "$HC" c:1)
TC=$("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CC', $S1, 'falso', 'f', 60) ->> 'turn_id'" | tail -n1)
"${P[@]}" -c "$SVC select public.cc_solicitar_asesor('$CC', 'visitor', '$HC', null)" >/dev/null
# CC-7 · la IA sigue con asesor asignado; el takeover que compite con ella es INICIAR la sesión humana.
"${P[@]}" -c "$SVC select public.cc_asignar_asesor('$CC', tests.id('cc4_adm'), tests.id('cc4_p1'))" >/dev/null
("${P[@]}" -c "$SVC select public.cc_iniciar_asesoria('$CC', tests.id('cc4_p1'))" > "$T/c1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_ia_turno_responder('$TC', 'respuesta tardía') ->> 'persistido'" > "$T/c2.out" 2>&1) &
wait
# (now() es el inicio de la transacción: los timestamps no sirven para ordenar dos tx que compitieron por el lock;
#  la garantía es por construcción —responder re-verifica el modo bajo el MISMO lock que el takeover— y se
#  comprueba como estado final consistente: completed ⇔ hay mensaje ai; discarded ⇔ no lo hay.)
check "C · estado final determinista: completed con mensaje, o discarded sin mensaje (nunca running ni mezcla)" "select (status = 'completed') = exists (select 1 from public.cc_messages m where m.conversation_id = '$CC' and m.actor_type = 'ai') and status in ('completed','discarded') from public.cc_ai_turns where id = '$TC'"
check "C · la conversación quedó con la sesión humana iniciada por su asesor" "select modo = 'human_active' and seller_profile_id = tests.id('cc4_p1') from public.cc_conversations where id = '$CC'"

# ── D) cierre mientras corre
CD=$(conv "$HD"); S1=$(msg "$CD" "$HD" c:1)
TD=$("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CD', $S1, 'falso', 'f', 60) ->> 'turn_id'" | tail -n1)
("${P[@]}" -c "$SVC select public.cc_cerrar_conversacion('$CD', 'visitor', '$HD', null)" > "$T/d1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_ia_turno_responder('$TD', 'tarde') ->> 'persistido'" > "$T/d2.out" 2>&1) &
wait
check "D · estado final determinista: completed ⇔ mensaje ai; discarded ⇔ sin mensaje; la conversación cerrada" "select (t.status = 'completed') = exists (select 1 from public.cc_messages m where m.conversation_id = '$CD' and m.actor_type = 'ai') and t.status in ('completed','discarded') and c.estado = 'cerrada' from public.cc_ai_turns t join public.cc_conversations c on c.id = t.conversation_id where t.id = '$TD'"
check "D · el turno discarded (si lo fue) registra conversacion_cerrada" "select status = 'completed' or error_class = 'conversacion_cerrada' from public.cc_ai_turns where id = '$TD'"

# ── E) reintento tras timeout → mismo mensaje
S2=$(msg "$CA" "$HA" c:2)
TE=$("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CA', $S2, 'falso', 'f', 60) ->> 'turn_id'" | tail -n1)
"${P[@]}" -c "$SVC select public.cc_ia_turno_fallar('$TE', 'provider_timeout', true)" >/dev/null
for i in 1 2 3; do ("${P[@]}" -c "$SVC select public.cc_ia_turno_reclamar('$CA', $S2, 'falso', 'f', 60) ->> 'estado'" > "$T/e$i.out" 2>&1) & done; wait
[ "$(cat "$T"/e*.out | grep -c '^reclamado$' || true)" = "1" ] && echo "PASS: E · tras el timeout, exactamente un worker re-reclama" || { echo "FAIL: E · $(cat "$T"/e*.out | tr '\n' ' ')"; FAILED=1; }
for i in 1 2; do ("${P[@]}" -c "$SVC select public.cc_ia_turno_responder('$TE', 'respuesta E') ->> 'persistido'" > "$T/e2$i.out" 2>&1) & done; wait
check "E · un solo mensaje ai para el segundo disparador" "select count(*) = 1 from public.cc_messages where conversation_id = '$CA' and actor_type = 'ai' and client_message_id = 'ai:$S2'"
check "E · attempts = 2 en el turno" "select attempts = 2 from public.cc_ai_turns where id = '$TE'"

"${P[@]}" -c "delete from tests.ctx where key like 'cc4_%'" >/dev/null
exit $FAILED
