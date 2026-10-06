#!/usr/bin/env bash
# ============================================================================
# CC-6 · Concurrencia REAL del checkout (la base sostiene "un carrito → máximo un pedido").
#   1. misma revisión confirmada por 10 workers (operation_id distintos) → exactamente 1 pedido.
#   2. misma operación reintentada en paralelo → mismo pedido.
#   3. dos revisiones vigentes del mismo carrito confirmadas a la vez → 1 pedido.
#   4. mutación del carrito vs confirmación → CARRITO_CAMBIO o convertido coherente.
#   7. "respuesta perdida": reintento tras commit → pedido existente.
#   8. carrera de conversión → un solo converted_order_id.
#   10. abrir carrito ×5 tras convertir → un activo nuevo.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
SVC="select tests.act_as_service();"
DOC="select tests.act_as(tests.id('cc6_doc'));"

"${P[@]}" -c "do \$\$ declare d uuid := tests.user('doctor'); px uuid; c uuid; begin
  px := tests.producto_fam('Rellenos', 'CC6', 1000);
  delete from tests.ctx where key like 'cc6_%'; insert into tests.ctx values ('cc6_doc', d), ('cc6_px', px); perform tests.cliente(d);
  perform tests.stock(px, 'L6', 50);
  perform tests.act_as_service();
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, is_default) values (d, 'Base', 'Calle 1', '82000', 'Mazatlán', 'Sinaloa', true);
  c := (public.cc_carrito_abrir('doctor', null, d) ->> 'cart_id')::uuid; insert into tests.ctx values ('cc6_cart', c);
  perform public.cc_carrito_agregar(c, 'doctor', null, d, px, 2, 'a1');
end \$\$;" >/dev/null
CART=$("${P[@]}" -c "select tests.id('cc6_cart')" | tail -n1)
RV=$("${P[@]}" -c "$DOC select public.cc_checkout_revisar('$CART') ->> 'review_id'" | tail -n1)
O0=$("${P[@]}" -c "select count(*) from public.orders" | tail -n1)

# ── 1/8) misma revisión, 10 workers, operaciones distintas
for i in $(seq 1 10); do ("${P[@]}" -c "$DOC select public.cc_checkout_confirmar('$RV', 'w$i') ->> 'order_id'" > "$T/a$i.out" 2>&1) & done; wait
IDS=$(cat "$T"/a*.out | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l | tr -d ' '); OK=$(cat "$T"/a*.out | grep -cE '^[0-9a-f-]{36}$' || true)
[ "$IDS" = "1" ] && [ "$OK" = "10" ] && echo "PASS: 1 · 10 confirmaciones → un solo pedido; las 10 recibieron el mismo id" || { echo "FAIL: 1 · ids=$IDS ok=$OK: $(cat "$T"/a*.out | grep -i error | head -1)"; FAILED=1; }
check "1 · exactamente un pedido nuevo" "select count(*) = $O0 + 1 from public.orders"
check "8 · un solo converted_order_id, carrito converted" "select estado = 'converted' and converted_order_id = (select id from public.orders order by created_at desc limit 1) from public.cc_carts where id = '$CART'"
check "1 · la revisión se consumió una vez" "select consumed_at is not null and order_id is not null from public.cc_checkout_reviews where id = '$RV'"
ORD=$(cat "$T"/a1.out | tail -n1)

# ── 2/7) misma operación en paralelo + reintento tras commit
for i in 1 2 3 4; do ("${P[@]}" -c "$DOC select public.cc_checkout_confirmar('$RV', 'w1') ->> 'order_id'" > "$T/b$i.out" 2>&1) & done; wait
[ "$(cat "$T"/b*.out | grep -c "^$ORD$" || true)" = "4" ] && echo "PASS: 2/7 · reintentos de la misma operación devuelven el mismo pedido" || { echo "FAIL: 2 · $(cat "$T"/b*.out | tr '\n' ' ')"; FAILED=1; }
check "2 · sigue habiendo un solo pedido" "select count(*) = $O0 + 1 from public.orders"

# ── 10) abrir ×5 tras convertir → un activo nuevo
for i in $(seq 1 5); do ("${P[@]}" -c "$SVC select public.cc_carrito_abrir('doctor', null, tests.id('cc6_doc')) ->> 'cart_id'" > "$T/c$i.out" 2>&1) & done; wait
check "10 · un solo carrito activo nuevo (distinto del convertido)" "select count(*) = 1 and bool_and(id <> '$CART') from public.cc_carts where profile_id = tests.id('cc6_doc') and estado = 'active'"
C2=$(cat "$T"/c1.out | tail -n1)
"${P[@]}" -c "$SVC select public.cc_carrito_agregar('$C2', 'doctor', null, tests.id('cc6_doc'), tests.id('cc6_px'), 1, 'b1')" >/dev/null

# ── 3) dos revisiones vigentes del mismo carrito confirmadas a la vez → 1 pedido
R1=$("${P[@]}" -c "$DOC select public.cc_checkout_revisar('$C2') ->> 'review_id'" | tail -n1)
R2=$("${P[@]}" -c "$DOC select public.cc_checkout_revisar('$C2') ->> 'review_id'" | tail -n1)
("${P[@]}" -c "$DOC select public.cc_checkout_confirmar('$R1', 'x1') ->> 'order_id'" > "$T/d1.out" 2>&1) &
("${P[@]}" -c "$DOC select public.cc_checkout_confirmar('$R2', 'x2') ->> 'order_id'" > "$T/d2.out" 2>&1) &
wait
check "3 · dos revisiones vigentes → un solo pedido" "select count(*) = $O0 + 2 from public.orders"
[ "$(cat "$T"/d1.out "$T"/d2.out | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l | tr -d ' ')" = "1" ] && echo "PASS: 3 · ambas confirmaciones devolvieron el mismo pedido" || { echo "FAIL: 3 · $(cat "$T"/d1.out "$T"/d2.out | tr '\n' ' ')"; FAILED=1; }

# ── 4) mutación vs confirmación
C3=$("${P[@]}" -c "$SVC select public.cc_carrito_abrir('doctor', null, tests.id('cc6_doc')) ->> 'cart_id'" | tail -n1)
"${P[@]}" -c "$SVC select public.cc_carrito_agregar('$C3', 'doctor', null, tests.id('cc6_doc'), tests.id('cc6_px'), 1, 'e1')" >/dev/null
R3=$("${P[@]}" -c "$DOC select public.cc_checkout_revisar('$C3') ->> 'review_id'" | tail -n1)
("${P[@]}" -c "$SVC select public.cc_carrito_agregar('$C3', 'doctor', null, tests.id('cc6_doc'), tests.id('cc6_px'), 5, 'e2') ->> 'qty_despues'" > "$T/e1.out" 2>&1) &
("${P[@]}" -c "$DOC select coalesce(public.cc_checkout_confirmar('$R3', 'y1') ->> 'motivo', 'OK')" > "$T/e2.out" 2>&1) &
wait
M=$(tail -n1 "$T/e2.out")
check "4 · estado coherente: convertido con la cantidad revisada (1) y la mutación rechazada, o CARRITO_CAMBIO sin pedido" "select (c.estado = 'converted' and (select qty from public.order_items where order_id = c.converted_order_id) = 1) or (c.estado = 'active' and (select quantity from public.cc_cart_items where cart_id = c.id) = 6) from public.cc_carts c where c.id = '$C3'"
grep -qE '^OK$|^CARRITO_CAMBIO$' "$T/e2.out" && echo "PASS: 4 · la confirmación terminó en OK o CARRITO_CAMBIO ($M)" || { echo "FAIL: 4 · $(cat "$T/e2.out" | tr '\n' ' ' | cut -c1-120)"; FAILED=1; }
grep -qE '^[0-9]+$|CARRITO_CERRADO' "$T/e1.out" && echo "PASS: 4 · la mutación entró antes o fue rechazada por carrito cerrado (nunca sobre un convertido)" || { echo "FAIL: 4 · $(cat "$T/e1.out" | tr '\n' ' ' | cut -c1-120)"; FAILED=1; }

"${P[@]}" -c "delete from tests.ctx where key like 'cc6_%'" >/dev/null
exit $FAILED
