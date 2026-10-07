#!/usr/bin/env bash
# ============================================================================
# Chat V2-C2 · Concurrencia REAL del motor de inactividad (sesiones de BD paralelas).
#   R1. El doctor escribe (con la conversación bloqueada) mientras corre el motor → el motor la salta
#       (SKIP LOCKED); el mensaje renueva la actividad; la siguiente corrida NO cierra; nada se pierde.
#   R3. Igual con el asesor enviando en una sesión humana vencida.
#   R6. Dos motores a la vez sobre la misma sesión humana vencida → UN cierre, UN aviso de sistema,
#       UN human_ended, UN session_closed.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"; "${P[@]}" -c "update public.cc_atencion_config set sesion_ia_min = null, sesion_humana_min = null, sesion_aviso_previo_min = null, solicitud_expira_min = null where id = 1" >/dev/null 2>&1' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
noerr() { if grep -qiE 'ERROR|deadlock' "$@"; then echo "FAIL: $(basename "$1") con error: $(cat "$@" | tr '\n' ' ' | cut -c1-180)"; FAILED=1; return 1; fi; return 0; }
SVC="select tests.act_as_service();"
MOTOR="$SVC select public.cc_sesiones_cerrar_inactivas()::text;"

"${P[@]}" -c "do \$\$ declare d1 uuid := tests.user('doctor'); d3 uuid := tests.user('doctor'); d6 uuid := tests.user('doctor'); s uuid := tests.user('pos'); pA uuid; k uuid; r jsonb; c3 uuid; c6 uuid; sem jsonb; begin
  delete from tests.ctx where key like 'c2c_%';
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{\"capabilities\":[\"conversaciones\",\"nuevos_clientes\"]}' where id = s;
  perform tests.cliente(d3); perform tests.cliente(d6);
  pA := tests.producto_cat('Rellenos', 1000); perform tests.stock(pA, 'C2C-A', 100);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d3, s), (d6, s);
  perform tests.act_as(tests.fixture_admin());
  sem := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar('America/Mazatlan', sem);
  perform public.cc_sesiones_config_guardar(240, 480, 60, 1440);
  perform tests.act_as_service();
  insert into tests.ctx values ('c2c_c1', (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid);
  perform public.cc_enviar_mensaje(tests.id('c2c_c1'), 'doctor', null, d1, 'r1-0', 'Hola');
  k := (public.cc_carrito_abrir('doctor', null, d3) ->> 'cart_id')::uuid; r := public.cc_carrito_agregar(k, 'doctor', null, d3, pA, 1, 'r3-k'); c3 := (r -> 'handoff' ->> 'conversation_id')::uuid; perform public.cc_iniciar_asesoria(c3, s);
  k := (public.cc_carrito_abrir('doctor', null, d6) ->> 'cart_id')::uuid; r := public.cc_carrito_agregar(k, 'doctor', null, d6, pA, 1, 'r6-k'); c6 := (r -> 'handoff' ->> 'conversation_id')::uuid; perform public.cc_iniciar_asesoria(c6, s);
  insert into tests.ctx values ('c2c_d1', d1), ('c2c_s', s), ('c2c_c3', c3), ('c2c_c6', c6);
  update public.cc_conversation_sessions set last_activity_at = now() - interval '5 hours' where conversation_id = tests.id('c2c_c1') and estado = 'abierta';
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-200)"; exit 1; }

# ── R1) el doctor escribe con la conversación bloqueada mientras corre el motor
("${P[@]}" -c "begin; select tests.act_as_service(); select 1 from public.cc_conversations where id = tests.id('c2c_c1') for update; select pg_sleep(1.2); select public.cc_enviar_mensaje(tests.id('c2c_c1'), 'doctor', null, tests.id('c2c_d1'), 'r1-1', 'Sigo aquí') ->> 'seq'; commit;" > "$T/r1a.out" 2>&1) &
("${P[@]}" -c "select pg_sleep(0.4); $MOTOR" > "$T/r1b.out" 2>&1) &
wait
noerr "$T/r1a.out" "$T/r1b.out"
check "R1 · el motor saltó la conversación ocupada" "select (regexp_match('$(tail -1 "$T/r1b.out")', '\"saltadas_ocupadas\": ([0-9]+)'))[1]::int >= 1"
"${P[@]}" -c "$MOTOR" > "$T/r1c.out" 2>&1; noerr "$T/r1c.out"
check "R1 · la actividad del doctor se renovó y la sesión sigue abierta" "select estado = 'abierta' and last_activity_at > now() - interval '5 minutes' from public.cc_conversation_sessions where conversation_id = tests.id('c2c_c1') and ordinal = 1"
check "R1 · el mensaje no se perdió" "select exists (select 1 from public.cc_messages where conversation_id = tests.id('c2c_c1') and client_message_id = 'r1-1')"

# ── R3) el asesor envía con la conversación bloqueada mientras corre el motor (se envejece justo antes)
"${P[@]}" -c "update public.cc_conversation_sessions set last_activity_at = now() - interval '9 hours' where conversation_id = tests.id('c2c_c3') and estado = 'abierta'" > /dev/null
("${P[@]}" -c "begin; select tests.act_as_service(); select 1 from public.cc_conversations where id = tests.id('c2c_c3') for update; select pg_sleep(1.2); select public.cc_enviar_mensaje(tests.id('c2c_c3'), 'seller', null, tests.id('c2c_s'), 'r3-1', 'Le confirmo el pedido') ->> 'seq'; commit;" > "$T/r3a.out" 2>&1) &
("${P[@]}" -c "select pg_sleep(0.4); $MOTOR" > "$T/r3b.out" 2>&1) &
wait
noerr "$T/r3a.out" "$T/r3b.out"
"${P[@]}" -c "$MOTOR" > "$T/r3c.out" 2>&1; noerr "$T/r3c.out"
check "R3 · el envío del asesor renovó la actividad: sigue human_active" "select modo = 'human_active' from public.cc_conversations where id = tests.id('c2c_c3')"
check "R3 · sin cierre debajo del envío" "select count(*) = 0 from public.cc_conversation_events where conversation_id = tests.id('c2c_c3') and tipo = 'session_closed'"

# ── R6) dos motores a la vez sobre la misma sesión vencida (se envejece justo antes)
"${P[@]}" -c "update public.cc_conversation_sessions set last_activity_at = now() - interval '9 hours' where conversation_id = tests.id('c2c_c6') and estado = 'abierta'" > /dev/null
check "R6 · premisa: sigue human_active antes de los motores" "select modo = 'human_active' from public.cc_conversations where id = tests.id('c2c_c6')"
("${P[@]}" -c "$MOTOR" > "$T/r6a.out" 2>&1) &
("${P[@]}" -c "$MOTOR" > "$T/r6b.out" 2>&1) &
wait
noerr "$T/r6a.out" "$T/r6b.out"
check "R6 · UN session_closed" "select count(*) = 1 from public.cc_conversation_events where conversation_id = tests.id('c2c_c6') and tipo = 'session_closed'"
check "R6 · UN human_ended" "select count(*) = 1 from public.cc_conversation_events where conversation_id = tests.id('c2c_c6') and tipo = 'human_ended'"
check "R6 · UN aviso de sistema de inactividad" "select count(*) = 1 from public.cc_messages where conversation_id = tests.id('c2c_c6') and client_message_id like 'sys:inactividad:%'"
check "R6 · conversación ai_active y sin sesión abierta" "select (select modo = 'ai_active' from public.cc_conversations where id = tests.id('c2c_c6')) and not exists (select 1 from public.cc_conversation_sessions where conversation_id = tests.id('c2c_c6') and estado = 'abierta')"

exit $FAILED
