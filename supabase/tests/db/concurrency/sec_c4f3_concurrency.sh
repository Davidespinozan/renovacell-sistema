#!/usr/bin/env bash
# SEC-C4-FISCAL-3 · crear_pedido_con_receptor bajo carrera. Sesiones reales con COMMIT (cada llamada = una transacción).
#   A · 12 simultáneas, mismo pedido, mismo usuario, mismos datos → UN pedido, UN receptor; 1 lo crea y 11 lo confirman.
#   B · mismo pedido, DOS usuarios con la solicitud idéntica (6 y 6) → lo crea uno; al otro, conflicto (sin datos).
#   C · mismo pedido, dos CUENTAS distintas → una sola cuenta; el otro grupo, conflicto.
#   D · mismo pedido, dos RECEPTORES → un solo receptor; el otro grupo, conflicto.
#   E · mismo pedido, dos juegos de RENGLONES → un solo juego; el otro grupo, conflicto.
#   F · mismo pedido, solicitud válida contra receptor inválido → las inválidas se rechazan; queda UN pedido válido.
#   G · pedido creado antes en DOS llamadas (flujo anterior) → la función nueva responde conflicto y no lo toca.
#   H · la función nueva contra crear_pedido (flujo anterior) por el mismo identificador → UN pedido, coherente.
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
"${P[@]}" -c "delete from tests.ctx where key like 'f3_%'" >/dev/null
"${P[@]}" >/dev/null <<'SQL'
do $$
declare k text; c1 uuid; c2 uuid;
begin
  insert into tests.ctx values ('f3_posa', tests.user('pos')), ('f3_posb', tests.user('pos')), ('f3_p1', tests.product(100)), ('f3_p2', tests.product(250));
  perform tests.act_as_service();
  insert into public.customers (full_name, source) values ('Carrera F3 uno ' || left(gen_random_uuid()::text, 8), 'odoo') returning id into c1;
  insert into public.customers (full_name, source) values ('Carrera F3 dos ' || left(gen_random_uuid()::text, 8), 'odoo') returning id into c2;
  perform tests.act_as_owner();
  insert into tests.ctx values ('f3_c1', c1), ('f3_c2', c2);
  foreach k in array array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] loop insert into tests.ctx values ('f3_o' || k, gen_random_uuid()); end loop;
end $$;
SQL
N0=$("${P[@]}" -c "select count(*) from public.orders")
L1="jsonb_build_array(jsonb_build_object('product_id', tests.id('f3_p1'), 'qty', 2))"
L2="jsonb_build_array(jsonb_build_object('product_id', tests.id('f3_p2'), 'qty', 1))"
R1="tests.fiscal('XAXX010101000')"; R2="tests.fiscal('BBB010101BB2')"; RBAD="tests.fiscal('XAXX010101000') || '{\"status\":\"timbrada\"}'::jsonb"
ENV="'{\"address\":{\"line1\":\"Calle 1\"}}'::jsonb"
# nueva <usuario> <pedido> <renglones> <cuenta> <receptor>
nueva() { echo "select tests.act_as(tests.id('f3_$1')); select 'R=' || (public.crear_pedido_con_receptor(tests.id('f3_o$2'), null, null, $3, $ENV, true, tests.id('f3_$4'), $5))::text;"; }
run() { ("${P[@]}" -c "$1" > "$T/$2.out" 2>&1) & }
con() { cat "$T"/$1*.out 2>/dev/null | grep -c "$2"; }
creados() { cat "$T"/$1*.out 2>/dev/null | grep 'R=' | grep -vc idempotent; }
uno() { check "$1 · existe UN solo pedido, con UN receptor y su bitácora de alta" "select (select count(*) from public.orders where id = tests.id('f3_o$2')) = 1 and (select jsonb_typeof(invoice_meta -> 'receiver') = 'object' and invoice_requested from public.orders where id = tests.id('f3_o$2')) and (select count(*) from public.audit_logs where resource_type = 'orders' and resource_id = tests.id('f3_o$2')::text and action = 'INSERT orders') = 1 and (select count(*) from public.audit_logs where resource_type = 'orders' and resource_id = tests.id('f3_o$2')::text and action = 'UPDATE orders') = 1"; }

for i in $(seq 1 12); do run "$(nueva posa a "$L1" c1 "$R1")" "a$i"; done; wait
[ "$(creados a)" = "1" ] && [ "$(con a idempotent)" = "11" ] && [ "$(con a ERROR)" = "0" ] && echo "PASS: A · 12 simultáneas idénticas: 1 crea, 11 confirman, 0 errores" || { echo "FAIL: A · creados=$(creados a) repetidos=$(con a idempotent) errores=$(con a ERROR): $(cat "$T"/a*.out | grep ERROR | head -2)"; FAILED=1; }
uno A a

for i in $(seq 1 6); do run "$(nueva posa b "$L1" c1 "$R1")" "bx$i"; run "$(nueva posb b "$L1" c1 "$R1")" "by$i"; done; wait
XO=$(con bx 'R='); YO=$(con by 'R='); XC=$(con bx PEDIDO_EXISTENTE_CONFLICTO); YC=$(con by PEDIDO_EXISTENTE_CONFLICTO)
{ { [ "$XO" = "6" ] && [ "$YC" = "6" ] && [ "$YO" = "0" ]; } || { [ "$YO" = "6" ] && [ "$XC" = "6" ] && [ "$XO" = "0" ]; }; } && echo "PASS: B · dos usuarios, solicitud idéntica: el pedido es de UNO (6 éxitos); el otro recibe 6 conflictos" || { echo "FAIL: B · A ok=$XO conf=$XC · B ok=$YO conf=$YC"; FAILED=1; }
[ "$(cat "$T"/b*.out | grep PEDIDO_EXISTENTE_CONFLICTO | grep -cE '[0-9]{3,}|S[0-9]+|total|folio')" = "0" ] && echo "PASS: B · el conflicto no revela folio ni total" || { echo "FAIL: B · el conflicto revela datos"; FAILED=1; }
uno B b
check "B · el creador en bitácora es exactamente el usuario que obtuvo los éxitos" "select (select actor from public.audit_logs where resource_type = 'orders' and resource_id = tests.id('f3_ob')::text and action = 'INSERT orders') = tests.id('f3_pos$([ "$XO" = "6" ] && echo a || echo b)')"

for i in $(seq 1 6); do run "$(nueva posa c "$L1" c1 "$R1")" "cx$i"; run "$(nueva posa c "$L1" c2 "$R1")" "cy$i"; done; wait
XO=$(con cx 'R='); YO=$(con cy 'R='); XC=$(con cx PEDIDO_EXISTENTE_CONFLICTO); YC=$(con cy PEDIDO_EXISTENTE_CONFLICTO)
{ { [ "$XO" = "6" ] && [ "$YC" = "6" ] && [ "$YO" = "0" ]; } || { [ "$YO" = "6" ] && [ "$XC" = "6" ] && [ "$XO" = "0" ]; }; } && echo "PASS: C · dos cuentas: gana UNA; la otra, 6 conflictos" || { echo "FAIL: C · c1 ok=$XO conf=$XC · c2 ok=$YO conf=$YC"; FAILED=1; }
uno C c
check "C · el pedido quedó en la cuenta ganadora, con SU snapshot (sin datos de la otra)" "select customer_id = tests.id('f3_c$([ "$XO" = "6" ] && echo 1 || echo 2)') and (shipping_meta -> 'customer' ->> 'id')::uuid = customer_id from public.orders where id = tests.id('f3_oc')"

for i in $(seq 1 6); do run "$(nueva posa d "$L1" c1 "$R1")" "dx$i"; run "$(nueva posa d "$L1" c1 "$R2")" "dy$i"; done; wait
XO=$(con dx 'R='); YO=$(con dy 'R='); XC=$(con dx PEDIDO_EXISTENTE_CONFLICTO); YC=$(con dy PEDIDO_EXISTENTE_CONFLICTO)
{ { [ "$XO" = "6" ] && [ "$YC" = "6" ] && [ "$YO" = "0" ]; } || { [ "$YO" = "6" ] && [ "$XC" = "6" ] && [ "$XO" = "0" ]; }; } && echo "PASS: D · dos receptores: gana UNO; el otro, 6 conflictos" || { echo "FAIL: D · r1 ok=$XO conf=$XC · r2 ok=$YO conf=$YC"; FAILED=1; }
uno D d
check "D · el receptor guardado es el del grupo ganador, sin sobrescritura" "select invoice_meta -> 'receiver' ->> 'rfc' = '$([ "$XO" = "6" ] && echo XAXX010101000 || echo BBB010101BB2)' from public.orders where id = tests.id('f3_od')"

for i in $(seq 1 6); do run "$(nueva posa e "$L1" c1 "$R1")" "ex$i"; run "$(nueva posa e "$L2" c1 "$R1")" "ey$i"; done; wait
XO=$(con ex 'R='); YO=$(con ey 'R='); XC=$(con ex PEDIDO_EXISTENTE_CONFLICTO); YC=$(con ey PEDIDO_EXISTENTE_CONFLICTO)
{ { [ "$XO" = "6" ] && [ "$YC" = "6" ] && [ "$YO" = "0" ]; } || { [ "$YO" = "6" ] && [ "$XC" = "6" ] && [ "$XO" = "0" ]; }; } && echo "PASS: E · dos juegos de renglones: gana UNO; el otro, 6 conflictos" || { echo "FAIL: E · l1 ok=$XO conf=$XC · l2 ok=$YO conf=$YC"; FAILED=1; }
uno E e
check "E · los renglones son SOLO los del grupo ganador" "select count(*) = 1 and min(product_id::text) = tests.id('f3_p$([ "$XO" = "6" ] && echo 1 || echo 2)')::text from public.order_items where order_id = tests.id('f3_oe')"

for i in $(seq 1 6); do run "$(nueva posa f "$L1" c1 "$R1")" "fx$i"; run "$(nueva posa f "$L1" c1 "$RBAD")" "fy$i"; done; wait
[ "$(con fx 'R=')" = "6" ] && [ "$(con fy FISCAL_INVALIDO)" = "6" ] && [ "$(con fy 'R=')" = "0" ] && echo "PASS: F · válidas: 6 éxitos; con receptor inválido: 6 rechazos, ninguna creó ni alteró nada" || { echo "FAIL: F · válidas ok=$(con fx 'R=') · inválidas rechazadas=$(con fy FISCAL_INVALIDO)"; FAILED=1; }
uno F f

# G · flujo anterior en DOS transacciones y después la función nueva
"${P[@]}" -c "select tests.act_as(tests.id('f3_posa')); select public.crear_pedido(tests.id('f3_og'), null, null, $L1, $ENV, true, tests.id('f3_c1'));" >/dev/null
"${P[@]}" -c "select tests.act_as(tests.id('f3_posa')); select public.set_order_fiscal_snapshot(tests.id('f3_og'), $R1);" >/dev/null
"${P[@]}" -c "$(nueva posa g "$L1" c1 "$R1")" > "$T/g1.out" 2>&1
[ "$(con g PEDIDO_EXISTENTE_CONFLICTO)" = "1" ] && echo "PASS: G · pedido creado en dos llamadas (flujo anterior): la función nueva responde conflicto" || { echo "FAIL: G · $(cat "$T/g1.out")"; FAILED=1; }
check "G · y no lo tocó (un solo cambio en bitácora, el del flujo anterior)" "select (select count(*) from public.audit_logs where resource_type = 'orders' and resource_id = tests.id('f3_og')::text and action = 'UPDATE orders') = 1 and (select count(distinct created_at) from public.audit_logs where resource_type = 'orders' and resource_id = tests.id('f3_og')::text) = 2"

# H · la función nueva contra crear_pedido por el mismo identificador
for i in $(seq 1 6); do run "$(nueva posa h "$L1" c1 "$R1")" "hx$i"; run "select tests.act_as(tests.id('f3_posb')); select 'V=' || (public.crear_pedido(tests.id('f3_oh'), null, null, $L2, $ENV, false, tests.id('f3_c2')))::text;" "hy$i"; done; wait
check "H · contra el flujo anterior: UN solo pedido" "select count(*) = 1 from public.orders where id = tests.id('f3_oh')"
check "H · coherente: o es el de la función nueva (cuenta 1, con receptor, creado por A) o el del flujo anterior (cuenta 2, sin receptor, creado por B); nunca una mezcla" "select (o.customer_id = tests.id('f3_c1') and o.invoice_meta -> 'receiver' ->> 'rfc' = 'XAXX010101000' and a.actor = tests.id('f3_posa') and (select min(product_id::text) from public.order_items where order_id = o.id) = tests.id('f3_p1')::text) or (o.customer_id = tests.id('f3_c2') and o.invoice_meta is null and a.actor = tests.id('f3_posb') and (select min(product_id::text) from public.order_items where order_id = o.id) = tests.id('f3_p2')::text) from public.orders o join public.audit_logs a on a.resource_type = 'orders' and a.resource_id = o.id::text and a.action = 'INSERT orders' where o.id = tests.id('f3_oh')"
[ "$(cat "$T"/hx*.out | grep -c 'R=')" -le 6 ] && [ "$(cat "$T"/hx*.out | grep 'R=' | grep -vc idempotent)" -le 1 ] && echo "PASS: H · la función nueva creó como mucho una vez" || { echo "FAIL: H"; FAILED=1; }

check "Z · en total se crearon exactamente 8 pedidos (uno por escenario)" "select count(*) = $N0 + 8 from public.orders"
[ "$(cat "$T"/*.out | grep -ciE 'deadlock|could not serialize')" = "0" ] && echo "PASS: Z · ninguna sesión reportó interbloqueo" || { echo "FAIL: Z · interbloqueos: $(cat "$T"/*.out | grep -ciE 'deadlock')"; FAILED=1; }
exit $FAILED
