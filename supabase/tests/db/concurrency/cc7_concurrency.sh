#!/usr/bin/env bash
# ============================================================================
# CC-7 · Concurrencia REAL del handoff comercial (sesiones paralelas; la base sostiene las cardinalidades).
#   A. 6 "primeros artículos" simultáneos (dos pestañas / doble clic) → UN handoff, UN aviso, UN evento.
#   B. la MISMA operación 5 veces a la vez (reintentos) → la cantidad cambia una vez y UN handoff.
#   C. adopción del visitante mientras el doctor activa su carrito → sin deadlock, sin errores, un handoff.
#   D. dos asignaciones de cartera simultáneas de Dirección → serializadas; conversación = cartera final.
#   E. dos aperturas simultáneas de una conversación cerrada → se reabre UNA (canal permanente).
#   F. rechazo del doctor vs inicio del vendedor → nunca ambos: o IA (rechazo) o humano activo.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
noerr() { if grep -qiE 'ERROR|deadlock' "$@"; then echo "FAIL: $(basename "$1") con error: $(cat "$@" | tr '\n' ' ' | cut -c1-180)"; FAILED=1; return 1; fi; return 0; }
SVC="select tests.act_as_service();"
HV=$(printf 'c7a1%.0s' $(seq 1 16)); HX=$(printf 'c7b2%.0s' $(seq 1 16))   # tokens propios (otros scripts usan dígitos repetidos)

"${P[@]}" -c "do \$\$ declare dA uuid := tests.user('doctor'); dC uuid := tests.user('doctor'); dD uuid := tests.user('doctor'); dE uuid := tests.user('doctor'); dF uuid := tests.user('doctor');
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); pA uuid; pB uuid; pC uuid; sem jsonb; begin
  delete from tests.ctx where key like 'cc7_%';
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{\"capabilities\":[\"conversaciones\",\"nuevos_clientes\"]}' where id in (s1, s2);
  pA := tests.producto_cat('Rellenos', 1000); pB := tests.producto_cat('Rellenos', 700); pC := tests.producto_cat('Rellenos', 400);
  perform tests.stock(pA, 'C7-A', 100); perform tests.stock(pB, 'C7-B', 100); perform tests.stock(pC, 'C7-C', 100);
  insert into tests.ctx values ('cc7_dA', dA), ('cc7_dC', dC), ('cc7_dD', dD), ('cc7_dE', dE), ('cc7_dF', dF), ('cc7_s1', s1), ('cc7_s2', s2),
                               ('cc7_pA', pA), ('cc7_pB', pB), ('cc7_pC', pC), ('cc7_adm', tests.fixture_admin());
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1), (dF, s1);
  sem := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar('America/Mazatlan', sem);
  perform public.cc_visitante_abrir(null, '$HV', '{}'::jsonb, null);
  perform public.cc_visitante_abrir(null, '$HX', '{}'::jsonb, null);
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-200)"; exit 1; }

# ── A) 6 primeros artículos simultáneos sobre el mismo carrito vacío
KA=$("${P[@]}" -c "$SVC select public.cc_carrito_abrir('doctor', null, tests.id('cc7_dA')) ->> 'cart_id'" | tail -n1)
for i in 1 2 3 4 5 6; do
  prod=$([ $((i % 3)) = 0 ] && echo cc7_pA || ([ $((i % 3)) = 1 ] && echo cc7_pB || echo cc7_pC))
  ("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$KA', 'doctor', null, tests.id('cc7_dA'), tests.id('$prod'), 1, 'a:$i') ->> 'cart_id'" > "$T/a$i.out" 2>&1) &
done; wait
noerr "$T"/a*.out && echo "PASS: A · 6 mutaciones concurrentes sin error (el ruteo nunca rompe el carrito)"
check "A · un solo HANDOFF_REQUESTED en el carrito" "select count(*) = 1 from public.cc_cart_events where cart_id = '$KA' and tipo = 'handoff_requested'"
check "A · un solo aviso al doctor" "select count(*) = 1 from public.cc_messages m join public.cc_carts k on k.handoff_conversation_id = m.conversation_id where k.id = '$KA' and m.client_message_id like 'sys:handoff:$KA:%'"
check "A · una sola solicitud en la conversación y asignada a su cartera" "select (select count(*) from public.cc_conversation_events e where e.conversation_id = c.id and e.tipo = 'human_handoff_requested') = 1 and c.modo = 'human_assigned' and c.seller_profile_id = tests.id('cc7_s1') from public.cc_conversations c join public.cc_carts k on k.handoff_conversation_id = c.id where k.id = '$KA'"
check "A · todas las adiciones aplicadas (sin lost update)" "select sum(quantity) = 6 from public.cc_cart_items where cart_id = '$KA'"

# ── B) la MISMA operación 5 veces a la vez (visitante)
KB=$("${P[@]}" -c "$SVC select public.cc_carrito_abrir('visitor', '$HX', null) ->> 'cart_id'" | tail -n1)
for i in 1 2 3 4 5; do ("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$KB', 'visitor', '$HX', null, tests.id('cc7_pA'), 2, 'b:mismo') ->> 'qty_despues'" > "$T/b$i.out" 2>&1) & done; wait
check "B · cantidad aplicada una vez" "select quantity = 2 from public.cc_cart_items where cart_id = '$KB'"
check "B · un solo handoff (lead de visitante en cola)" "select (select count(*) from public.cc_cart_events where cart_id = '$KB' and tipo = 'handoff_requested') = 1 and (select ruteo_motivo = 'visitante' from public.cc_conversations c join public.cc_carts k on k.handoff_conversation_id = c.id where k.id = '$KB')"

# ── C) adopción vs activación del carrito del mismo doctor (órdenes de lock opuestos sin el advisory)
"${P[@]}" -c "$SVC select public.cc_abrir_conversacion(null, tests.id('cc7_dC'))" >/dev/null
"${P[@]}" -c "$SVC select public.cc_abrir_conversacion('$HV', null)" >/dev/null
KC=$("${P[@]}" -c "$SVC select public.cc_carrito_abrir('doctor', null, tests.id('cc7_dC')) ->> 'cart_id'" | tail -n1)
("${P[@]}" -c "$SVC select public.cc_visitante_adoptar('$HV', tests.id('cc7_dC')) ->> 'estado'" > "$T/c1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$KC', 'doctor', null, tests.id('cc7_dC'), tests.id('cc7_pA'), 1, 'c:1') ->> 'cart_id'" > "$T/c2.out" 2>&1) &
wait
noerr "$T/c1.out" "$T/c2.out" && echo "PASS: C · adopción y carrito concurrentes sin deadlock ni error"
check "C · una sola conversación abierta del doctor" "select count(*) = 1 from public.cc_conversations where profile_id = tests.id('cc7_dC') and estado = 'abierta'"
check "C · el carrito quedó con su handoff en la conversación canónica" "select k.handoff_estado = 'solicitado' and k.handoff_conversation_id = (select id from public.cc_conversations where profile_id = tests.id('cc7_dC') and estado = 'abierta') from public.cc_carts k where k.id = '$KC'"

# ── D) dos asignaciones de cartera simultáneas (Dirección)
KD=$("${P[@]}" -c "$SVC select public.cc_carrito_abrir('doctor', null, tests.id('cc7_dD')) ->> 'cart_id'" | tail -n1)
"${P[@]}" -c "$SVC select public.cc_carrito_agregar('$KD', 'doctor', null, tests.id('cc7_dD'), tests.id('cc7_pA'), 1, 'd:1')" >/dev/null
("${P[@]}" -c "$SVC select public.cc_cartera_asignar(tests.id('cc7_dD'), tests.id('cc7_s1'), 'carrera') ->> 'vendedor'" > "$T/d1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_cartera_asignar(tests.id('cc7_dD'), tests.id('cc7_s2'), 'carrera') ->> 'vendedor'" > "$T/d2.out" 2>&1) &
wait
noerr "$T/d1.out" "$T/d2.out" && echo "PASS: D · ambas asignaciones se serializan"
check "D · historial completo (2 filas, encadenadas)" "select count(*) = 2 and count(*) filter (where seller_anterior is null) = 1 from public.cc_cartera_historial where profile_id = tests.id('cc7_dD')"
check "D · la conversación quedó con el vendedor de la cartera final y un solo asesor vigente" "select c.seller_profile_id = k.seller_profile_id and (select count(*) from public.cc_participants p where p.conversation_id = c.id and p.rol = 'asesor' and p.left_at is null) = 1 from public.cc_conversations c join public.cc_cartera k on k.profile_id = c.profile_id where c.profile_id = tests.id('cc7_dD') and c.estado = 'abierta'"

# ── E) dos aperturas simultáneas tras cerrar → se reabre UNA
CE=$("${P[@]}" -c "$SVC select public.cc_abrir_conversacion(null, tests.id('cc7_dE')) ->> 'conversation_id'" | tail -n1)
"${P[@]}" -c "$SVC select public.cc_cerrar_conversacion('$CE', 'doctor', null, tests.id('cc7_dE'))" >/dev/null
for i in 1 2 3; do ("${P[@]}" -c "$SVC select public.cc_abrir_conversacion(null, tests.id('cc7_dE')) ->> 'conversation_id'" > "$T/e$i.out" 2>&1) & done; wait
check "E · todas las aperturas devolvieron la MISMA conversación" "select count(distinct x) = 1 and min(x) = '$CE' from (values ('$(tail -n1 "$T/e1.out")'), ('$(tail -n1 "$T/e2.out")'), ('$(tail -n1 "$T/e3.out")')) v(x)"
check "E · una sola conversación del doctor (canal permanente)" "select count(*) = 1 from public.cc_conversations where profile_id = tests.id('cc7_dE')"

# ── F) rechazo del doctor vs inicio del vendedor
KF=$("${P[@]}" -c "$SVC select public.cc_carrito_abrir('doctor', null, tests.id('cc7_dF')) ->> 'cart_id'" | tail -n1)
CF=$("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$KF', 'doctor', null, tests.id('cc7_dF'), tests.id('cc7_pA'), 1, 'f:1') -> 'handoff' ->> 'conversation_id'" | tail -n1)
("${P[@]}" -c "$SVC select public.cc_handoff_rechazar('$CF', 'doctor', null, tests.id('cc7_dF'))" > "$T/f1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_iniciar_asesoria('$CF', tests.id('cc7_s1')) ->> 'modo'" > "$T/f2.out" 2>&1) &
wait
check "F · estado final coherente: IA (rechazado) xor humano activo" "select (modo = 'ai_active' and (select handoff_estado = 'rechazado' from public.cc_carts where id = '$KF')) or (modo = 'human_active' and (select handoff_estado = 'solicitado' from public.cc_carts where id = '$KF')) from public.cc_conversations where id = '$CF'"

"${P[@]}" -c "delete from tests.ctx where key like 'cc7_%'" >/dev/null
exit $FAILED
