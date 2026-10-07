#!/usr/bin/env bash
# ============================================================================
# Chat V2-C1 · Concurrencia REAL de sesiones (sesiones de BD paralelas).
#   3.  Dos PRIMEROS mensajes a la vez en una conversación sin sesión → exactamente UNA sesión abierta.
#   R1. Terminar la asesoría mientras el doctor escribe → sin error/deadlock; nunca dos abiertas; cada
#       mensaje cae en exactamente un rango de sesión.
#   R2. Terminar dos veces a la vez → UN solo cierre (un session_closed).
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
noerr() { if grep -qiE 'ERROR|deadlock' "$@"; then echo "FAIL: $(basename "$1") con error: $(cat "$@" | tr '\n' ' ' | cut -c1-180)"; FAILED=1; return 1; fi; return 0; }
SVC="select tests.act_as_service();"

"${P[@]}" -c "do \$\$ declare d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); d3 uuid := tests.user('doctor'); s uuid := tests.user('pos'); c1 uuid; c2 uuid; c3 uuid; begin
  delete from tests.ctx where key like 'c1c_%';
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{\"capabilities\":[\"conversaciones\"]}' where id = s;
  c1 := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  c2 := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  c3 := (public.cc_abrir_conversacion(null, d3) ->> 'conversation_id')::uuid;
  foreach c1 in array array[c2, c3] loop
    perform public.cc_enviar_mensaje(c1, 'doctor', null, case when c1 = c2 then d2 else d3 end, 'prep', 'Hola');
    perform public.cc_solicitar_asesor(c1, 'doctor', null, case when c1 = c2 then d2 else d3 end);
    perform tests.act_as(tests.fixture_admin()); perform public.cc_solicitud_reasignar(c1, s, 'prep'); perform tests.act_as_service();
    perform public.cc_iniciar_asesoria(c1, s);
  end loop;
  insert into tests.ctx values ('c1c_d1', d1), ('c1c_d2', d2), ('c1c_s', s), ('c1c_c1', (select id from public.cc_conversations where profile_id = d1 and estado = 'abierta')), ('c1c_c2', c2), ('c1c_c3', c3);
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-200)"; exit 1; }

# ── 3) dos primeros mensajes a la vez
("${P[@]}" -c "$SVC select public.cc_enviar_mensaje(tests.id('c1c_c1'), 'doctor', null, tests.id('c1c_d1'), 'p1', 'Uno') ->> 'seq'" > "$T/a.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_enviar_mensaje(tests.id('c1c_c1'), 'doctor', null, tests.id('c1c_d1'), 'p2', 'Dos') ->> 'seq'" > "$T/b.out" 2>&1) &
wait
noerr "$T/a.out" "$T/b.out"
check "3 · exactamente UNA sesión (abierta, ordinal 1)" "select count(*) = 1 and bool_and(estado = 'abierta' and ordinal = 1) from public.cc_conversation_sessions where conversation_id = tests.id('c1c_c1')"
check "3 · ambos mensajes dentro de esa sesión" "select count(*) = 2 from public.cc_messages m join public.cc_conversation_sessions s on s.conversation_id = m.conversation_id and m.seq >= s.first_seq where m.conversation_id = tests.id('c1c_c1')"
check "3 · un solo session_opened" "select count(*) = 1 from public.cc_conversation_events where conversation_id = tests.id('c1c_c1') and tipo = 'session_opened'"

# ── R1) terminar mientras el doctor escribe
("${P[@]}" -c "$SVC select public.cc_terminar_asesoria(tests.id('c1c_c2'), tests.id('c1c_s')) ->> 'modo'" > "$T/r1a.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_enviar_mensaje(tests.id('c1c_c2'), 'doctor', null, tests.id('c1c_d2'), 'r1', 'Justo ahora') ->> 'seq'" > "$T/r1b.out" 2>&1) &
wait
noerr "$T/r1a.out" "$T/r1b.out"
check "R1 · nunca dos sesiones abiertas" "select count(*) <= 1 from public.cc_conversation_sessions where conversation_id = tests.id('c1c_c2') and estado = 'abierta'"
check "R1 · la sesión 1 quedó cerrada" "select estado = 'cerrada' from public.cc_conversation_sessions where conversation_id = tests.id('c1c_c2') and ordinal = 1"
check "R1 · cada mensaje en exactamente un rango de sesión" "select bool_and(n = 1) from (select m.seq, (select count(*) from public.cc_conversation_sessions s where s.conversation_id = m.conversation_id and m.seq between s.first_seq and coalesce(s.last_seq, 9223372036854775807)) n from public.cc_messages m where m.conversation_id = tests.id('c1c_c2')) x"
check "R1 · estado operativo liberado" "select modo = 'ai_active' and seller_profile_id is null from public.cc_conversations where id = tests.id('c1c_c2')"

# ── R2) terminar dos veces a la vez
("${P[@]}" -c "$SVC select public.cc_terminar_asesoria(tests.id('c1c_c3'), tests.id('c1c_s')) ->> 'idempotente'" > "$T/r2a.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_terminar_asesoria(tests.id('c1c_c3'), tests.id('c1c_s')) ->> 'idempotente'" > "$T/r2b.out" 2>&1) &
wait
noerr "$T/r2a.out" "$T/r2b.out"
check "R2 · UN solo session_closed" "select count(*) = 1 from public.cc_conversation_events where conversation_id = tests.id('c1c_c3') and tipo = 'session_closed'"
check "R2 · una llamada cerró y la otra fue idempotente" "select (select string_agg(x, ',' order by x) from (values ('$(tail -1 "$T/r2a.out")'), ('$(tail -1 "$T/r2b.out")')) v(x)) = 'false,true'"

exit $FAILED
