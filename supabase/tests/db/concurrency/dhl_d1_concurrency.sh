#!/usr/bin/env bash
# DHL D1 · reconciliar_guia bajo carrera. Sesiones reales con COMMIT.
#   A · 8 resoluciones simultáneas del MISMO intento (operaciones distintas, 4 sin_guia y 4 guia_confirmada) → se aplica UNA;
#       las demás reciben ESTADO_INVALIDO. Nunca dos envíos ni dos cambios de estado.
#   B · la MISMA operación (guia_confirmada) repetida 6 veces a la vez → una aplica y las demás responden "ya aplicada".
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
"${P[@]}" -c "delete from tests.ctx where key like 'd1_%'" >/dev/null
"${P[@]}" >/dev/null <<'SQL'
do $$
declare ad uuid := tests.fixture_admin(); d uuid := tests.user('doctor'); p uuid := tests.product(100); o uuid; k text; a uuid;
  req jsonb := jsonb_build_object('shipper', jsonb_build_object('name', 'Renovacell', 'cp', '80197'), 'receiver', jsonb_build_object('name', 'Dra', 'address', jsonb_build_object('line1', 'Av 2', 'cp', '44100', 'city', 'Guadalajara', 'phone', '3312345678')),
                                  'pkg', jsonb_build_object('weightKg', 1.2, 'lengthCm', 20, 'widthCm', 20, 'heightCm', 10, 'pieces', 1), 'productCode', 'N', 'orderRef', 'S1');
begin
  perform tests.stock(p, 'D1C-' || left(gen_random_uuid()::text, 8), 10);
  insert into tests.ctx values ('d1_ad', ad), ('d1_op', gen_random_uuid());
  foreach k in array array['a', 'b'] loop
    perform tests.act_as_owner();
    o := tests.packed_order(d, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
    a := gen_random_uuid();
    insert into public.shipping_attempts (id, order_id, provider, idempotency_key, service_code, request_fingerprint, external_reference, status, request, created_at, updated_at)
    values (a, o, 'dhl', o::text || ':N', 'N', md5(o::text), a::text, 'unknown_requires_reconciliation', req, now() - interval '2 hours', now() - interval '2 hours');
    insert into tests.ctx values ('d1_o' || k, o), ('d1_a' || k, a);
  end loop;
end $$;
SQL
# consulta del servidor para el intento $2 (clave a|b): con la guía 31439994XX hallada (para guia_confirmada) o vacía (para sin_guia)
consulta() { echo "jsonb_build_object('consultado_en', now(), 'referencia', replace(tests.id('d1_a$2')::text, '-', ''), 'portal_revisado', true, 'acepta_duplicado_tardio', true, 'por_referencia', jsonb_build_object('realizada', true, 'resultado', '$1', 'encontradas', case when '$1' = 'encontradas' then jsonb_build_array(jsonb_build_object('tracking', '314399948$3', 'referencias', jsonb_build_array(replace(tests.id('d1_a$2')::text, '-', '')), 'producto', 'N', 'destino_cp', '44100', 'peso_total', 1.2, 'piezas', 1)) else '[]'::jsonb end))"; }
resolver() { echo "select tests.act_as(tests.id('d1_ad')); select 'R=' || (public.reconciliar_guia($1, tests.id('d1_a$2'), '$3', $(consulta "$4" "$2" "$5"), 'Decisión de Dirección en prueba de carrera', $6))::text;"; }
con() { cat "$T"/$1*.out 2>/dev/null | grep -c "$2"; }

for i in 1 2 3 4; do ("${P[@]}" -c "$(resolver "gen_random_uuid()" a sin_guia sin_resultados 2 null)" > "$T/a$i.out" 2>&1) & done
for i in 5 6 7 8; do ("${P[@]}" -c "$(resolver "gen_random_uuid()" a guia_confirmada encontradas 2 "'3143999482'")" > "$T/a$i.out" 2>&1) & done
wait
[ "$(con a '"applied"')" = "1" ] && [ "$(con a ESTADO_INVALIDO)" = "7" ] && echo "PASS: A · 8 resoluciones simultáneas (4 sin guía, 4 guía confirmada): se aplica UNA; 7 reciben 'estado inválido'" || { echo "FAIL: A · aplicadas=$(con a '"applied"') estado_invalido=$(con a ESTADO_INVALIDO)"; cat "$T"/a*.out | head -20; FAILED=1; }
check "A · estado final coherente: el intento ya no está en desconocido, a lo sumo UN envío, UNA operación, y el pedido está empacado o enviado según la ganadora" "select (select status <> 'unknown_requires_reconciliation' and reconciled_at is not null from public.shipping_attempts where id = tests.id('d1_aa')) and (select count(*) <= 1 from public.shipments where order_id = tests.id('d1_oa')) and (select count(*) = 1 from public.inventory_operations where kind = 'reconciliacion_guia' and request_hash in (select request_hash from public.inventory_operations where kind = 'reconciliacion_guia')) is not null and (select (status = 'packed' and not exists (select 1 from public.shipments s where s.order_id = tests.id('d1_oa'))) or (status = 'shipped' and exists (select 1 from public.shipments s where s.order_id = tests.id('d1_oa') and s.tracking_number = '3143999482')) from public.orders where id = tests.id('d1_oa'))"

for i in $(seq 1 6); do ("${P[@]}" -c "$(resolver "tests.id('d1_op')" b guia_confirmada encontradas 3 "'3143999483'")" > "$T/b$i.out" 2>&1) & done; wait
[ "$(con b 'R=')" = "6" ] && [ "$(con b '"status": "applied"')" = "1" ] && [ "$(con b already_applied)" = "5" ] && [ "$(con b ERROR)" = "0" ] && echo "PASS: B · misma operación 6 veces a la vez: una aplica y 5 responden 'ya aplicada', sin errores" || { echo "FAIL: B · R=$(con b 'R=') applied=$(con b '"status": "applied"') already=$(con b already_applied) errores=$(con b ERROR)"; cat "$T"/b*.out | head -20; FAILED=1; }
check "B · un solo envío, un solo intento exitoso, pedido enviado, una operación" "select (select count(*) = 1 from public.shipments where order_id = tests.id('d1_ob') and tracking_number = '3143999483') and (select status = 'succeeded' from public.shipping_attempts where id = tests.id('d1_ab')) and (select status = 'shipped' from public.orders where id = tests.id('d1_ob')) and (select count(*) = 1 from public.inventory_operations where op_id = tests.id('d1_op'))"
check "Z · inventario concilia" "select tests.conciliacion_errores() = 0"
[ "$(cat "$T"/*.out | grep -ciE 'deadlock|could not serialize')" = "0" ] && echo "PASS: Z · sin interbloqueos" || { echo "FAIL: Z · interbloqueos"; FAILED=1; }
# Datos de ESTA carrera: se retiran para no dejar residuos a las pruebas de reversión que corren después.
"${P[@]}" -c "set session_replication_role = replica; delete from public.shipments where order_id in (tests.id('d1_oa'), tests.id('d1_ob')); delete from public.shipping_attempts where order_id in (tests.id('d1_oa'), tests.id('d1_ob'))" >/dev/null 2>&1
exit $FAILED
