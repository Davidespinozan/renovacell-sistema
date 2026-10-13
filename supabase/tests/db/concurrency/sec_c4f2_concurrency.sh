#!/usr/bin/env bash
# SEC-C4-FISCAL-2 · validación fiscal del POS bajo carrera. Sesiones reales con COMMIT.
#   A · 12 sesiones simultáneas con la MISMA operación y los mismos datos → una sola venta, un solo descuento; todas responden éxito.
#   B · la MISMA operación con dos receptores distintos (6 y 6) → una sola venta con UNO de los receptores; el otro grupo recibe OP_ID_REUTILIZADO.
#   C · 12 ventas simultáneas con estado fiscal falsificado → ninguna venta, ningún descuento.
#   D · 10 ventas válidas simultáneas de 10 productos distintos → 10 ventas con receptor canónico, una unidad de cada lote.
#       (Productos distintos a propósito: dos ventas simultáneas del MISMO lote se interbloquean también con la versión
#       anterior de vender_pos; es un hallazgo aparte, ajeno a la validación fiscal, y no se enmascara ni se corrige aquí.)
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0; RUN="F2C$RANDOM$RANDOM"   # folios únicos por corrida
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
"${P[@]}" -c "delete from tests.ctx where key like 'f2_%'" >/dev/null
"${P[@]}" >/dev/null <<'SQL'
do $$
declare p uuid := tests.product(100); lot uuid; i int;
begin
  lot := tests.stock(p, 'F2C-' || left(gen_random_uuid()::text, 8), 100);
  insert into tests.ctx values ('f2_pos', tests.user('pos')), ('f2_p', p), ('f2_lot', lot), ('f2_opa', gen_random_uuid()), ('f2_opb', gen_random_uuid());
  for i in 1..10 loop
    p := tests.product(100); insert into tests.ctx values ('f2_dp' || i, p), ('f2_dl' || i, tests.stock(p, 'F2D-' || left(gen_random_uuid()::text, 8), 5));
  end loop;
end $$;
SQL
Q0=$("${P[@]}" -c "select tests.qty(tests.id('f2_lot'))")
# vender <op-sql> <folio> <solicita> <meta-sql>
vender() { echo "select tests.act_as(tests.id('f2_pos')); select 'R=' || public.vender_pos($1, '$2', 100, 'tarjeta', null, '{}'::jsonb, jsonb_build_array(jsonb_build_object('product_id', tests.id('f2_p'), 'qty', 1, 'unit_price', 100)), jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', tests.id('f2_lot'), 'qty', 1)), $3, $4, null, null, null);"; }
OKM="jsonb_build_object('receiver', tests.fiscal('XAXX010101000'))"
OKM2="jsonb_build_object('receiver', tests.fiscal('BBB010101BB2'))"
BAD="jsonb_build_object('receiver', tests.fiscal('XAXX010101000'), 'status', 'timbrada', 'uuid', '11111111-2222-4333-8444-555555555555')"
con() { cat "$T"/$1*.out 2>/dev/null | grep -o "$2" | wc -l | tr -d ' '; }
dq() { "${P[@]}" -c "select $Q0 - tests.qty(tests.id('f2_lot'))"; }

for i in $(seq 1 12); do ("${P[@]}" -c "$(vender "tests.id('f2_opa')" $RUN-A true "$OKM")" > "$T/a$i.out" 2>&1) & done; wait
[ "$(con a 'R=true')" = "12" ] && echo "PASS: A · 12 simultáneas con la misma operación: las 12 responden éxito" || { echo "FAIL: A · éxitos=$(con a 'R=true'): $(cat "$T"/a*.out | grep -i error | head -2)"; FAILED=1; }
check "A · una sola venta, una sola operación registrada y UNA unidad descontada" "select (select count(*) from public.orders where id = tests.id('f2_opa')) = 1 and (select count(*) from public.inventory_operations where op_id = tests.id('f2_opa')) = 1 and $(dq) = 1"
check "A · el receptor quedó canónico" "select invoice_meta = jsonb_build_object('receiver', tests.fiscal('XAXX010101000')) and invoice_requested from public.orders where id = tests.id('f2_opa')"

for i in $(seq 1 6); do ("${P[@]}" -c "$(vender "tests.id('f2_opb')" $RUN-B true "$OKM")" > "$T/bx$i.out" 2>&1) & ("${P[@]}" -c "$(vender "tests.id('f2_opb')" $RUN-B true "$OKM2")" > "$T/by$i.out" 2>&1) & done; wait
BX=$(con bx 'R=true'); BY=$(con by 'R=true'); RX=$(con bx OP_ID_REUTILIZADO); RY=$(con by OP_ID_REUTILIZADO)
{ { [ "$BX" = "6" ] && [ "$RY" = "6" ] && [ "$BY" = "0" ]; } || { [ "$BY" = "6" ] && [ "$RX" = "6" ] && [ "$BX" = "0" ]; }; } && echo "PASS: B · misma operación, dos receptores: gana UN receptor (6 éxitos) y el otro grupo recibe OP_ID_REUTILIZADO (6)" || { echo "FAIL: B · X ok=$BX reut=$RX · Y ok=$BY reut=$RY"; FAILED=1; }
check "B · una sola venta con uno de los dos receptores; una unidad más descontada" "select (select count(*) from public.orders where id = tests.id('f2_opb')) = 1 and (select invoice_meta -> 'receiver' ->> 'rfc' in ('XAXX010101000', 'BBB010101BB2') from public.orders where id = tests.id('f2_opb')) and $(dq) = 2"

N0=$("${P[@]}" -c "select count(*) from public.orders")
for i in $(seq 1 12); do ("${P[@]}" -c "$(vender "gen_random_uuid()" "$RUN-C$i" true "$BAD")" > "$T/c$i.out" 2>&1) & done; wait
[ "$(con c FISCAL_INVALIDO)" = "12" ] && [ "$(con c 'R=true')" = "0" ] && echo "PASS: C · 12 ventas simultáneas con estado falsificado: las 12 rechazadas" || { echo "FAIL: C · rechazadas=$(con c FISCAL_INVALIDO) éxitos=$(con c 'R=true')"; FAILED=1; }
check "C · ninguna venta nueva, ningún descuento, ningún estado inventado guardado" "select (select count(*) from public.orders) = $N0 and $(dq) = 2 and not exists (select 1 from public.orders where external_ref like '$RUN-%' and (invoice_meta ? 'status' or invoice_meta ? 'uuid'))"

venderd() { echo "select tests.act_as(tests.id('f2_pos')); select 'R=' || public.vender_pos(gen_random_uuid(), '$RUN-D$1', 100, 'tarjeta', null, '{}'::jsonb, jsonb_build_array(jsonb_build_object('product_id', tests.id('f2_dp$1'), 'qty', 1, 'unit_price', 100)), jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', tests.id('f2_dl$1'), 'qty', 1)), true, $OKM, null, null, null);"; }
for i in $(seq 1 10); do ("${P[@]}" -c "$(venderd "$i")" > "$T/d$i.out" 2>&1) & done; wait
[ "$(con d 'R=true')" = "10" ] && echo "PASS: D · 10 ventas válidas simultáneas: las 10 aplicadas" || { echo "FAIL: D · éxitos=$(con d 'R=true'): $(cat "$T"/d*.out | grep -i error | head -2)"; FAILED=1; }
check "D · 10 ventas con receptor canónico y una unidad descontada de cada uno de los 10 lotes" "select (select count(*) from public.orders where external_ref like '$RUN-D%' and invoice_meta = jsonb_build_object('receiver', tests.fiscal('XAXX010101000'))) = 10 and (select count(*) = 10 and min(tests.qty(val)) = 4 and max(tests.qty(val)) = 4 from tests.ctx where key like 'f2_dl%') and $(dq) = 2"
check "Z · inventario concilia" "select tests.conciliacion_errores() = 0"
[ "$(cat "$T"/*.out | grep -ciE 'deadlock|could not serialize')" = "0" ] && echo "PASS: Z · ninguna sesión reportó interbloqueo" || { echo "FAIL: Z · interbloqueos"; FAILED=1; }
exit $FAILED
