#!/usr/bin/env bash
# CAJA SIN INTERBLOQUEOS (166) · ventas de Caja simultáneas con COMMIT real.
#   A · 10 ventas simultáneas del MISMO lote (100 piezas) → las 10 aplicadas, 10 piezas menos, ningún interbloqueo.
#   B · 8 ventas simultáneas de DOS lotes en órdenes cruzados (A,B) y (B,A) → las 8 aplicadas, sin interbloqueo.
#   C · 10 ventas simultáneas de 1 pieza contra un lote de 4 → exactamente 4 aplicadas y 6 "Inventario insuficiente"; nunca negativo.
#   Z · el inventario concilia y la llave sigue protegiendo (un renglón a un lote inexistente no se guarda).
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0; RUN="PL$RANDOM$RANDOM"
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
"${P[@]}" -c "delete from tests.ctx where key like 'pl_%'" >/dev/null
"${P[@]}" >/dev/null <<'SQL'
do $$
declare p uuid := tests.product(100); p2 uuid := tests.product(100); p3 uuid := tests.product(100);
begin
  insert into tests.ctx values ('pl_pos', tests.user('pos')), ('pl_p', p), ('pl_lot', tests.stock(p, 'PLA-' || left(gen_random_uuid()::text, 8), 100)),
    ('pl_p2', p2), ('pl_la', tests.stock(p2, 'PLB-' || left(gen_random_uuid()::text, 8), 50)), ('pl_lb', tests.stock(p2, 'PLC-' || left(gen_random_uuid()::text, 8), 50)),
    ('pl_p3', p3), ('pl_lc', tests.stock(p3, 'PLD-' || left(gen_random_uuid()::text, 8), 4));
end $$;
SQL
venta() { echo "select tests.act_as(tests.id('pl_pos')); select 'R=' || public.vender_pos(gen_random_uuid(), '$RUN-$1', 100, 'efectivo', null, '{}'::jsonb, jsonb_build_array(jsonb_build_object('product_id', tests.id('$2'), 'qty', $3, 'unit_price', 100)), $4, false, null, null, null, null);"; }
un_lote() { echo "jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', tests.id('$1'), 'qty', 1))"; }
dos_lotes() { echo "jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', tests.id('$1'), 'qty', 1), jsonb_build_object('line_index', 0, 'lot_id', tests.id('$2'), 'qty', 1))"; }
con() { cat "$T"/$1*.out 2>/dev/null | grep -o "$2" | wc -l | tr -d ' '; }

for i in $(seq 1 10); do ("${P[@]}" -c "$(venta "A$i" pl_p 1 "$(un_lote pl_lot)")" > "$T/a$i.out" 2>&1) & done; wait
[ "$(con a 'R=true')" = "10" ] && echo "PASS: A · 10 ventas simultáneas del mismo lote: las 10 aplicadas" || { echo "FAIL: A · éxitos=$(con a 'R=true'): $(cat "$T"/a*.out | grep -i error | head -2)"; FAILED=1; }
check "A · 10 piezas menos en el lote" "select tests.qty(tests.id('pl_lot')) = 90"

for i in $(seq 1 4); do
  ("${P[@]}" -c "$(venta "B$i" pl_p2 2 "$(dos_lotes pl_la pl_lb)")" > "$T/b$i.out" 2>&1) &
  ("${P[@]}" -c "$(venta "BB$i" pl_p2 2 "$(dos_lotes pl_lb pl_la)")" > "$T/bb$i.out" 2>&1) &
done; wait
[ "$(con b 'R=true')" = "8" ] && echo "PASS: B · 8 ventas simultáneas de dos lotes en órdenes cruzados: las 8 aplicadas" || { echo "FAIL: B · éxitos=$(con b 'R=true'): $(cat "$T"/b*.out | grep -i error | head -2)"; FAILED=1; }
check "B · 8 piezas menos en cada lote" "select tests.qty(tests.id('pl_la')) = 42 and tests.qty(tests.id('pl_lb')) = 42"

for i in $(seq 1 10); do ("${P[@]}" -c "$(venta "C$i" pl_p3 1 "$(un_lote pl_lc)")" > "$T/c$i.out" 2>&1) & done; wait
[ "$(con c 'R=true')" = "4" ] && [ "$(con c 'Inventario insuficiente')" = "6" ] && echo "PASS: C · lote de 4 y 10 ventas: 4 aplicadas, 6 rechazadas por inventario" || { echo "FAIL: C · éxitos=$(con c 'R=true') insuficiente=$(con c 'Inventario insuficiente'): $(cat "$T"/c*.out | grep -i error | grep -v insuficiente | head -2)"; FAILED=1; }
check "C · el lote queda en 0, nunca negativo" "select tests.qty(tests.id('pl_lc')) = 0"

check "Z · inventario concilia" "select tests.conciliacion_errores() = 0"
r=$("${P[@]}" -c "insert into public.order_items (order_id, product_id, lot_id, qty, unit_price) select id, tests.id('pl_p'), gen_random_uuid(), 1, 1 from public.orders limit 1" 2>&1 | tail -n1)
case "$r" in *foreign\ key*|*violates*|*is\ not\ present*) echo "PASS: Z · la llave sigue protegiendo (renglón a lote inexistente rechazado al confirmar)";; *) echo "FAIL: Z · un renglón a un lote inexistente se guardó ($r)"; FAILED=1;; esac
[ "$(cat "$T"/*.out | grep -ciE 'deadlock|could not serialize')" = "0" ] && echo "PASS: Z · ninguna sesión reportó interbloqueo" || { echo "FAIL: Z · interbloqueos: $(cat "$T"/*.out | grep -ciE deadlock)"; FAILED=1; }
exit $FAILED
