#!/usr/bin/env bash
# ============================================================================
# Commercial Intent CI-1 · Concurrencia REAL del episodio comercial (sesiones de BD paralelas).
#   CI1-13 · Dos señales fuertes a la vez sin episodio → UN episodio (1 sesión, 1 aviso, 1 notificación).
#   CI1-13b· Señal fuerte del carrito y solicitud explícita a la vez → UN episodio humano, sin duplicados.
#   CI1-12/14 · Episodio cerrado → nueva señal fuerte en OTRA transacción → +1 notificación (rearme real).
#   CI1-13c· Dos señales fuertes a la vez justo después del cierre → UN episodio nuevo (sesión 2).
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
noerr() { if grep -qiE 'ERROR|deadlock' "$@"; then echo "FAIL: $(basename "$1") con error: $(cat "$@" | tr '\n' ' ' | cut -c1-180)"; FAILED=1; return 1; fi; return 0; }
SVC="select tests.act_as_service();"

"${P[@]}" -c "do \$\$ declare d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); d3 uuid := tests.user('doctor'); s uuid := tests.user('pos'); pa uuid; pb uuid; k1 uuid; k2 uuid; k3 uuid; c2 uuid; c3 uuid; begin
  delete from tests.ctx where key like 'ci1c_%';
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{\"capabilities\":[\"conversaciones\"]}' where id = s;
  perform tests.cliente(d1); perform tests.cliente(d2); perform tests.cliente(d3);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s), (d2, s), (d3, s);
  pa := tests.producto_cat('Rellenos', 1000); pb := tests.producto_cat('Rellenos', 500);
  perform tests.stock(pa, 'CI1C-A', 100); perform tests.stock(pb, 'CI1C-B', 100);
  k1 := (public.cc_carrito_abrir('doctor', null, d1) ->> 'cart_id')::uuid;
  k2 := (public.cc_carrito_abrir('doctor', null, d2) ->> 'cart_id')::uuid;
  c2 := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  k3 := (public.cc_carrito_abrir('doctor', null, d3) ->> 'cart_id')::uuid;
  perform public.cc_carrito_agregar(k3, 'doctor', null, d3, pa, 1, 'k3-prep');                    -- episodio 1 de d3
  c3 := (select id from public.cc_conversations where profile_id = d3 and estado = 'abierta');
  perform public.cc_iniciar_asesoria(c3, s); perform public.cc_terminar_asesoria(c3, s);           -- se cierra el episodio 1
  insert into tests.ctx values ('ci1c_d1', d1), ('ci1c_d2', d2), ('ci1c_d3', d3), ('ci1c_pa', pa), ('ci1c_pb', pb), ('ci1c_k1', k1), ('ci1c_k2', k2), ('ci1c_c2', c2), ('ci1c_k3', k3), ('ci1c_c3', c3);
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-200)"; exit 1; }

# ── CI1-13 · dos señales fuertes a la vez (productos distintos) sin episodio
("${P[@]}" -c "$SVC select public.cc_carrito_agregar(tests.id('ci1c_k1'), 'doctor', null, tests.id('ci1c_d1'), tests.id('ci1c_pa'), 1, 'c13-a') ->> 'rev'" > "$T/a.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_carrito_agregar(tests.id('ci1c_k1'), 'doctor', null, tests.id('ci1c_d1'), tests.id('ci1c_pb'), 1, 'c13-b') ->> 'rev'" > "$T/b.out" 2>&1) &
wait
noerr "$T/a.out" "$T/b.out"
C1="(select id from public.cc_conversations where profile_id = tests.id('ci1c_d1') and estado = 'abierta')"
check "CI1-13 · una sola sesión" "select count(*) = 1 from public.cc_conversation_sessions where conversation_id = $C1"
check "CI1-13 · un solo aviso del carrito" "select count(*) = 1 from public.cc_messages where conversation_id = $C1 and client_message_id like 'sys:handoff:%'"
check "CI1-13 · una sola notificación al vendedor" "select count(*) = 1 from public.notifications where conversation_id = $C1 and kind = 'handoff_asignado'"
check "CI1-13 · ambos productos en el carrito" "select count(*) = 2 from public.cc_cart_items where cart_id = tests.id('ci1c_k1')"

# ── CI1-13b · señal del carrito y solicitud explícita a la vez
("${P[@]}" -c "$SVC select public.cc_carrito_agregar(tests.id('ci1c_k2'), 'doctor', null, tests.id('ci1c_d2'), tests.id('ci1c_pa'), 1, 'c13b') ->> 'rev'" > "$T/c.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_solicitar_asesor(tests.id('ci1c_c2'), 'doctor', null, tests.id('ci1c_d2')) ->> 'modo'" > "$T/d.out" 2>&1) &
wait
noerr "$T/c.out" "$T/d.out"
check "CI1-13b · una sola sesión" "select count(*) = 1 from public.cc_conversation_sessions where conversation_id = tests.id('ci1c_c2')"
check "CI1-13b · un solo human_assigned" "select count(*) = 1 from public.cc_conversation_events where conversation_id = tests.id('ci1c_c2') and tipo = 'human_assigned'"
check "CI1-13b · una sola notificación" "select count(*) = 1 from public.notifications where conversation_id = tests.id('ci1c_c2') and kind = 'handoff_asignado'"
check "CI1-13b · un solo aviso de episodio (carrito o solicitud)" "select count(*) = 1 from public.cc_messages where conversation_id = tests.id('ci1c_c2') and (client_message_id like 'sys:handoff:%' or client_message_id like 'sys:solicitud:%')"

# ── CI1-13c + CI1-12/14 · episodio 1 cerrado (otra transacción) → dos señales fuertes a la vez → UN episodio nuevo
sleep 1.2   # la llave de notificación de CHV2-A es por segundo
("${P[@]}" -c "$SVC select public.cc_carrito_actualizar(tests.id('ci1c_k3'), 'doctor', null, tests.id('ci1c_d3'), tests.id('ci1c_pa'), 2, 'c13c-a') ->> 'rev'" > "$T/e.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_carrito_agregar(tests.id('ci1c_k3'), 'doctor', null, tests.id('ci1c_d3'), tests.id('ci1c_pb'), 1, 'c13c-b') ->> 'rev'" > "$T/f.out" 2>&1) &
wait
noerr "$T/e.out" "$T/f.out"
check "CI1-12 · sesión 2 abierta, una sola" "select count(*) = 1 and bool_and(ordinal = 2) from public.cc_conversation_sessions where conversation_id = tests.id('ci1c_c3') and estado = 'abierta'"
check "CI1-13c · dos avisos en total (uno por episodio)" "select count(*) = 2 from public.cc_messages where conversation_id = tests.id('ci1c_c3') and client_message_id like 'sys:handoff:%'"
check "CI1-14 · +1 notificación por el episodio nuevo (2 en total)" "select count(*) = 2 from public.notifications where conversation_id = tests.id('ci1c_c3') and kind = 'handoff_asignado'"
check "CI1-19 · eventos del episodio nuevo en la sesión 2" "select count(*) = 2 from public.cc_conversation_events e join public.cc_conversation_sessions s on s.id = e.session_id where e.conversation_id = tests.id('ci1c_c3') and s.ordinal = 2 and e.tipo in ('human_handoff_requested', 'human_assigned')"

exit $FAILED
