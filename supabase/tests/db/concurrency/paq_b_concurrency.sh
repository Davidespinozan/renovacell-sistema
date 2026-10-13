#!/usr/bin/env bash
# PAQ-B · anular_guia bajo carrera. Sesiones reales con COMMIT.
#   A · 8 anulaciones simultáneas del MISMO pedido (operaciones distintas) → se aplica UNA; las demás, "ya no está enviado".
#   B · la MISMA operación repetida 6 veces a la vez → una aplica y las demás responden "ya aplicada" (sin error).
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
"${P[@]}" -c "delete from tests.ctx where key like 'pb_%'" >/dev/null
"${P[@]}" >/dev/null <<'SQL'
do $$
declare wh uuid := tests.user('warehouse'); d uuid := tests.user('doctor'); p uuid := tests.product(100); o uuid; k text; g text;
begin
  perform tests.stock(p, 'PB-' || left(gen_random_uuid()::text, 8), 10);
  insert into tests.ctx values ('pb_wh', wh), ('pb_op', gen_random_uuid());
  foreach k in array array['a', 'b'] loop
    perform tests.act_as_owner();
    o := tests.packed_order(d, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
    g := 'PB' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
    insert into public.shipping_attempts (order_id, provider, idempotency_key, service_code, request_fingerprint, status, tracking_number) values (o, 'dhl', o::text || ':N', 'N', md5(o::text), 'succeeded', g);
    insert into public.shipments (order_id, carrier, tracking_number, status, provider) values (o, 'DHL', g, 'in_transit', 'dhl');
    perform tests.act_as(wh);
    update public.orders set status = 'shipped', shipping_meta = coalesce(shipping_meta, '{}'::jsonb) || jsonb_build_object('method', 'paqueteria', 'carrier', 'DHL', 'tracking', g) where id = o;
    perform tests.act_as_owner();
    insert into tests.ctx values ('pb_o' || k, o);
  end loop;
end $$;
SQL
anular() { echo "select tests.act_as(tests.id('pb_wh')); select 'R=' || (public.anular_guia($1, tests.id('pb_o$2'), 'dirección equivocada'))::text;"; }
con() { cat "$T"/$1*.out 2>/dev/null | grep -c "$2"; }

for i in $(seq 1 8); do ("${P[@]}" -c "$(anular "gen_random_uuid()" a)" > "$T/a$i.out" 2>&1) & done; wait
[ "$(con a '"applied"')" = "1" ] && [ "$(con a PEDIDO_NO_ENVIADO)" = "7" ] && echo "PASS: A · 8 anulaciones simultáneas: se aplica UNA; 7 reciben 'ya no está enviado'" || { echo "FAIL: A · aplicadas=$(con a '"applied"') rechazadas=$(con a PEDIDO_NO_ENVIADO): $(cat "$T"/a*.out | grep ERROR | sort | uniq -c | head -3)"; FAILED=1; }
check "A · estado final coherente: pedido empacado, UN envío cancelado sin número activo, UN intento anulado, UNA operación" "select (select status = 'packed' from public.orders where id = tests.id('pb_oa')) and (select count(*) = 1 and bool_and(status = 'cancelado' and tracking_number is null and provider_meta ? 'anulada') from public.shipments where order_id = tests.id('pb_oa')) and (select count(*) = 1 and bool_and(status = 'voided_manual') from public.shipping_attempts where order_id = tests.id('pb_oa')) and (select count(*) = 1 from public.inventory_operations where kind = 'anulacion_guia' and result ->> 'order_id' = tests.id('pb_oa')::text)"

for i in $(seq 1 6); do ("${P[@]}" -c "$(anular "tests.id('pb_op')" b)" > "$T/b$i.out" 2>&1) & done; wait
[ "$(con b 'R=')" = "6" ] && [ "$(con b '"status": "applied"')" = "1" ] && [ "$(con b already_applied)" = "5" ] && [ "$(con b ERROR)" = "0" ] && echo "PASS: B · misma operación 6 veces a la vez: una aplica, 5 responden 'ya aplicada', 0 errores" || { echo "FAIL: B · respuestas=$(con b 'R=') aplicadas=$(con b '"status": "applied"') repetidas=$(con b already_applied) errores=$(con b ERROR)"; FAILED=1; }
check "B · un solo envío cancelado y un solo registro de operación" "select (select count(*) = 1 from public.shipments where order_id = tests.id('pb_ob') and status = 'cancelado') and (select count(*) = 1 from public.inventory_operations where op_id = tests.id('pb_op'))"
check "Z · inventario concilia" "select tests.conciliacion_errores() = 0"
[ "$(cat "$T"/*.out | grep -ciE 'deadlock|could not serialize')" = "0" ] && echo "PASS: Z · sin interbloqueos" || { echo "FAIL: Z · interbloqueos"; FAILED=1; }
# Los intentos anulados son datos de ESTA carrera: se retiran para no dejar residuos a las pruebas de reversión que corren después.
"${P[@]}" -c "set session_replication_role = replica; delete from public.shipping_attempts where order_id in (tests.id('pb_oa'), tests.id('pb_ob'))" >/dev/null 2>&1
exit $FAILED
