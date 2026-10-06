#!/usr/bin/env bash
# ============================================================================
# CC-5 · Concurrencia REAL del carrito (la base sostiene las cardinalidades).
#   1. 10 aperturas simultáneas → 1 carrito activo.
#   2. 10 veces la MISMA operación de agregar → la cantidad cambia una vez.
#   3. dos operaciones distintas a la vez → ambas reflejadas (sin lost update).
#   4. actualizar vs quitar el mismo item → resultado válido y determinista.
#   5. adopción mientras se agrega → carrito canónico final correcto, sin huérfanos.
#   6. carrito del perfil + carrito del visitante → fusión exactamente una vez.
#   7. dos "ofrecer" simultáneos → una oferta.
#   8. aceptar dos veces → un estado.
#   9. preparar checkout concurrente con mutación → versión coherente.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
SVC="select tests.act_as_service();"
HA=$(printf '8%.0s' $(seq 1 64)); HB=$(printf '9%.0s' $(seq 1 64)); HC=$(printf '0%.0s' $(seq 1 64))   # hashes propios (cc1/2/4 usan otros)

"${P[@]}" -c "do \$\$ declare d uuid := tests.user('doctor'); px uuid; py uuid; begin
  px := tests.producto_fam('Rellenos', 'CC5', 1000); py := tests.producto_fam('Rellenos', 'CC5', 500);
  delete from tests.ctx where key like 'cc5_%'; insert into tests.ctx values ('cc5_doc', d), ('cc5_px', px), ('cc5_py', py);
  perform tests.act_as_service();
  perform public.cc_visitante_abrir(null, '$HA', '{}'::jsonb, null); perform public.cc_visitante_abrir(null, '$HB', '{}'::jsonb, null); perform public.cc_visitante_abrir(null, '$HC', '{}'::jsonb, null);
end \$\$;" >/dev/null

# ── 1) 10 aperturas simultáneas
for i in $(seq 1 10); do ("${P[@]}" -c "$SVC select public.cc_carrito_abrir('visitor', '$HA', null) ->> 'cart_id'" > "$T/a$i.out" 2>&1) & done; wait
IDS=$(cat "$T"/a*.out | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l | tr -d ' ')
[ "$IDS" = "1" ] && echo "PASS: 1 · 10 aperturas → 1 carrito (mismo id)" || { echo "FAIL: 1 · ids=$IDS: $(cat "$T"/a*.out | grep -i error | head -1)"; FAILED=1; }
CA=$(cat "$T"/a1.out | tail -n1)
check "1 · un solo activo del visitante" "select count(*) = 1 from public.cc_carts c join public.cc_visitors v on v.id = c.visitor_id where v.token_hash = '$HA' and c.estado = 'active'"

# ── 2) misma operación ×10
for i in $(seq 1 10); do ("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$CA', 'visitor', '$HA', null, tests.id('cc5_px'), 2, 'op-dup') ->> 'qty_despues'" > "$T/b$i.out" 2>&1) & done; wait
check "2 · cantidad = 2 (no 20)" "select quantity = 2 from public.cc_cart_items where cart_id = '$CA' and product_id = tests.id('cc5_px')"
[ "$(cat "$T"/b*.out | grep -c '^2$' || true)" = "10" ] && echo "PASS: 2 · las 10 sesiones vieron qty 2" || { echo "FAIL: 2 · $(cat "$T"/b*.out | sort | uniq -c | tr '\n' ' ')"; FAILED=1; }

# ── 3) dos operaciones distintas a la vez
("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$CA', 'visitor', '$HA', null, tests.id('cc5_px'), 3, 'op-c1')" > "$T/c1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$CA', 'visitor', '$HA', null, tests.id('cc5_px'), 4, 'op-c2')" > "$T/c2.out" 2>&1) &
wait
check "3 · 2+3+4 = 9 (ninguna se perdió)" "select quantity = 9 from public.cc_cart_items where cart_id = '$CA' and product_id = tests.id('cc5_px')"
check "3 · rev avanzó exactamente 3 veces desde el alta (1→4)" "select rev = 4 from public.cc_carts where id = '$CA'"

# ── 4) actualizar vs quitar
("${P[@]}" -c "$SVC select public.cc_carrito_actualizar('$CA', 'visitor', '$HA', null, tests.id('cc5_px'), 1, 'op-d1')" > "$T/d1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_carrito_quitar('$CA', 'visitor', '$HA', null, tests.id('cc5_px'), 'op-d2')" > "$T/d2.out" 2>&1) &
wait
check "4 · resultado válido: 1 (actualizar ganó al final) o ausente (quitar ganó al final)" "select coalesce((select quantity from public.cc_cart_items where cart_id = '$CA' and product_id = tests.id('cc5_px')), 0) in (0, 1)"
check "4 · los eventos cuentan la historia (2 eventos nuevos)" "select count(*) >= 2 from public.cc_cart_events where cart_id = '$CA' and tipo in ('item_quantity_changed', 'item_removed', 'item_added') and created_at > now() - interval '10 seconds'"

# ── 5/6) adopción con fusión mientras se agrega; perfil ya tenía carrito
CD=$("${P[@]}" -c "$SVC select public.cc_carrito_abrir('doctor', null, tests.id('cc5_doc')) ->> 'cart_id'" | tail -n1)
"${P[@]}" -c "$SVC select public.cc_carrito_agregar('$CD', 'doctor', null, tests.id('cc5_doc'), tests.id('cc5_py'), 1, 'e0')" >/dev/null
CB=$("${P[@]}" -c "$SVC select public.cc_carrito_abrir('visitor', '$HB', null) ->> 'cart_id'" | tail -n1)
"${P[@]}" -c "$SVC select public.cc_carrito_agregar('$CB', 'visitor', '$HB', null, tests.id('cc5_py'), 2, 'e1')" >/dev/null
("${P[@]}" -c "$SVC select public.cc_visitante_adoptar('$HB', tests.id('cc5_doc')) ->> 'carritos'" > "$T/e1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$CB', 'visitor', '$HB', null, tests.id('cc5_px'), 5, 'e2') ->> 'qty_despues'" > "$T/e2.out" 2>&1) &
wait
check "6 · fusión exactamente una vez (un evento merged en el canónico)" "select count(*) = 1 from public.cc_cart_events where cart_id = '$CD' and tipo = 'merged'"
check "6 · el carrito del visitante quedó merged apuntando al del perfil" "select estado = 'merged' and merged_into_cart_id = '$CD' from public.cc_carts where id = '$CB'"
check "6 · Y: 1 + 2 = 3 en el canónico" "select quantity = 3 from public.cc_cart_items where cart_id = '$CD' and product_id = tests.id('cc5_py')"
check "5 · el agregado concurrente entró ANTES de la fusión (viajó al canónico: 5) o fue rechazado (0); nunca huérfano a medias" "select coalesce((select quantity from public.cc_cart_items where cart_id = '$CD' and product_id = tests.id('cc5_px')), 0) in (0, 5) and (not exists (select 1 from public.cc_cart_items where cart_id = '$CB' and product_id = tests.id('cc5_px')) or coalesce((select quantity from public.cc_cart_items where cart_id = '$CD' and product_id = tests.id('cc5_px')), 0) = 5)"
grep -qE '^5$|SESION_INVALIDA|CARRITO_CERRADO|NO_AUTORIZADO' "$T/e2.out" && echo "PASS: 5 · el agregado concurrente terminó en qty 5 o rechazado explícitamente" || { echo "FAIL: 5 · $(cat "$T/e2.out" | tr '\n' ' ' | cut -c1-160)"; FAILED=1; }
check "5/6 · un solo carrito activo del doctor" "select count(*) = 1 from public.cc_carts where profile_id = tests.id('cc5_doc') and estado = 'active'"

# ── 7) dos ofrecer simultáneos
CC=$("${P[@]}" -c "$SVC select public.cc_carrito_abrir('visitor', '$HC', null) ->> 'cart_id'" | tail -n1)
"${P[@]}" -c "$SVC select public.cc_carrito_agregar('$CC', 'visitor', '$HC', null, tests.id('cc5_px'), 1, 'f0')" >/dev/null
for i in 1 2; do ("${P[@]}" -c "$SVC select public.cc_carrito_oferta('$CC', 'ai', '$HC', null, 'ofrecer') ->> 'registrada'" > "$T/f$i.out" 2>&1) & done; wait
[ "$(cat "$T"/f*.out | grep -c '^true$' || true)" = "1" ] && echo "PASS: 7 · exactamente una oferta registrada" || { echo "FAIL: 7 · $(cat "$T"/f*.out | tr '\n' ' ')"; FAILED=1; }
check "7 · un evento seller_offer_triggered" "select count(*) = 1 from public.cc_cart_events where cart_id = '$CC' and tipo = 'seller_offer_triggered'"
# ── 8) aceptar dos veces
for i in 1 2; do ("${P[@]}" -c "$SVC select public.cc_carrito_oferta('$CC', 'ai', '$HC', null, 'aceptar') ->> 'registrada'" > "$T/g$i.out" 2>&1) & done; wait
[ "$(cat "$T"/g*.out | grep -c '^true$' || true)" = "1" ] && echo "PASS: 8 · una sola aceptación" || { echo "FAIL: 8 · $(cat "$T"/g*.out | tr '\n' ' ')"; FAILED=1; }
check "8 · estado aceptada" "select oferta_estado = 'aceptada' from public.cc_carts where id = '$CC'"

# ── 9) preparar checkout concurrente con mutación
("${P[@]}" -c "$SVC select public.cc_carrito_preparar_checkout('$CD', 'doctor', null, tests.id('cc5_doc')) -> 'proyeccion' ->> 'rev'" > "$T/h1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$CD', 'doctor', null, tests.id('cc5_doc'), tests.id('cc5_px'), 1, 'h2') ->> 'rev'" > "$T/h2.out" 2>&1) &
wait
R1=$(tail -n1 "$T/h1.out"); R2=$(tail -n1 "$T/h2.out")
{ [[ "$R1" =~ ^[0-9]+$ ]] && [[ "$R2" =~ ^[0-9]+$ ]] && [ "$R1" -le "$R2" ]; } && echo "PASS: 9 · la preparación devolvió una versión coherente (rev $R1 ≤ $R2) y nada se persistió como autoridad" || { echo "FAIL: 9 · r1=$R1 r2=$R2"; FAILED=1; }
check "9 · preparar no mutó items ni creó pedidos" "select (select count(*) from public.orders) = 0 and (select count(*) from public.cc_cart_events where cart_id = '$CD' and tipo = 'checkout_prepared') = 1"

"${P[@]}" -c "delete from tests.ctx where key like 'cc5_%'" >/dev/null
exit $FAILED
