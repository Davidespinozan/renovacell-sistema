#!/usr/bin/env bash
# SEC-C3b · carreras sobre el cierre de entrega y su evidencia. Sesiones reales con COMMIT.
#   A · 10 cierres simultáneos del mismo envío → se entrega UNA vez.
#   B · dos evidencias compitiendo por el mismo envío → queda una, la del primero.
#   C · una evidencia compitiendo por dos envíos → solo uno la obtiene; el otro sigue abierto.
#   D · cierre contra intentos de reabrir / quitar la evidencia → queda entregado e intacto.
#   E · cierre contra actualizaciones de incidencia → queda entregado.
#   F · borrar la foto mientras el cierre está en curso → la foto sobrevive (la sostiene el disparador, no la política).
#   G · cerrar con una foto cuyo borrado está en curso → el cierre se rechaza; el envío sigue abierto.
#   H · un chofer ajeno intentando cerrar durante el cierre legítimo → rechazado siempre.
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
"${P[@]}" -c "delete from tests.ctx where key like 'c3b_%'" >/dev/null
"${P[@]}" >/dev/null <<'SQL'
do $$
declare a uuid := tests.user('driver'); b uuid := tests.user('driver'); d uuid := tests.user('doctor'); p uuid := tests.product(100); it jsonb; k text; s uuid;
begin
  it := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1));
  insert into tests.ctx values ('c3b_a', a), ('c3b_b', b);
  foreach k in array array['sA', 'sB', 'sC1', 'sC2', 'sD', 'sE', 'sF', 'sG', 'sH'] loop
    insert into public.shipments (order_id, driver_id, status) values (tests.order(d, 'pending_payment', it), a, 'out_for_delivery') returning id into s;   -- pedido sin surtir: no altera la conciliación de inventario del cluster compartido
    insert into tests.ctx values ('c3b_' || k, s);
  end loop;
  insert into storage.objects (bucket_id, name, owner, owner_id)
    select 'proofs', 'proofs/c3b-' || x || '.png', a, a::text from unnest(array['a', 'b1', 'b2', 'c', 'd', 'e', 'f', 'g', 'h']) x;
end $$;
SQL
A="select tests.act_as(tests.id('c3b_a'));"; B="select tests.act_as(tests.id('c3b_b'));"
cierres() { "${P[@]}" -c "select count(*) from public.audit_logs where resource_type = 'shipments' and resource_id = tests.id('c3b_$1')::text and action like 'UPDATE%' and payload ->> 'status' = 'delivered'" | tail -1; }

# A
for i in $(seq 1 10); do ("${P[@]}" -c "$A select public.confirmar_entrega(tests.id('c3b_sA'), 'proofs/c3b-a.png', 'Recepción $i')" > "$T/a$i.out" 2>&1) & done; wait
[ "$(cat "$T"/a*.out | grep -ci error)" = "0" ] && echo "PASS: A · 10 cierres simultáneos responden bien (idempotente)" || { echo "FAIL: A · $(cat "$T"/a*.out | grep -i error | head -1)"; FAILED=1; }
[ "$(cierres sA)" = "1" ] && echo "PASS: A · el envío se entregó UNA sola vez (una escritura de cierre en bitácora)" || { echo "FAIL: A · cierres=$(cierres sA)"; FAILED=1; }
check "A · entregado, con su evidencia y un solo receptor" "select status = 'delivered' and proof_image_url = 'proofs/c3b-a.png' and received_by like 'Recepción %' from public.shipments where id = tests.id('c3b_sA')"

# B
for i in 1 2 3 4 5; do for f in b1 b2; do ("${P[@]}" -c "$A select public.confirmar_entrega(tests.id('c3b_sB'), 'proofs/c3b-$f.png', '$f')" > "$T/b$f$i.out" 2>&1) & done; done; wait
[ "$(cierres sB)" = "1" ] && echo "PASS: B · dos evidencias compitiendo: un solo cierre" || { echo "FAIL: B · cierres=$(cierres sB)"; FAILED=1; }
check "B · la evidencia y el receptor son del MISMO intento (no se mezclan)" "select status = 'delivered' and proof_image_url = 'proofs/c3b-' || received_by || '.png' from public.shipments where id = tests.id('c3b_sB')"

# C
for i in 1 2 3 4 5; do for s in sC1 sC2; do ("${P[@]}" -c "$A select public.confirmar_entrega(tests.id('c3b_$s'), 'proofs/c3b-c.png', 'R')" > "$T/c$s$i.out" 2>&1) & done; done; wait
check "C · una evidencia para dos envíos: exactamente UNO la obtiene" "select count(*) = 1 from public.shipments where proof_image_url = 'proofs/c3b-c.png'"
check "C · el otro envío sigue en reparto, sin evidencia" "select count(*) = 1 from public.shipments where id in (tests.id('c3b_sC1'), tests.id('c3b_sC2')) and status = 'out_for_delivery' and proof_image_url is null"
[ "$(cat "$T"/c*.out | grep -c EVIDENCIA_INVALIDA)" = "5" ] && echo "PASS: C · los 5 intentos sobre el otro envío se rechazan con EVIDENCIA_INVALIDA" || { echo "FAIL: C · rechazos=$(cat "$T"/c*.out | grep -c EVIDENCIA_INVALIDA): $(cat "$T"/c*.out | grep -i error | grep -v EVIDENCIA_INVALIDA | head -1)"; FAILED=1; }

# D
("${P[@]}" -c "$A select public.confirmar_entrega(tests.id('c3b_sD'), 'proofs/c3b-d.png', 'R')" > "$T/d0.out" 2>&1) &
for i in $(seq 1 6); do ("${P[@]}" -c "$A update public.shipments set status = 'despachado' where id = tests.id('c3b_sD')" > "$T/dr$i.out" 2>&1) & ("${P[@]}" -c "$A update public.shipments set proof_image_url = null, received_by = 'x' where id = tests.id('c3b_sD')" > "$T/dp$i.out" 2>&1) & done; wait
check "D · cierre contra reapertura y retiro de evidencia: queda entregado e intacto" "select status = 'delivered' and proof_image_url = 'proofs/c3b-d.png' and received_by = 'R' from public.shipments where id = tests.id('c3b_sD')"
[ "$(cat "$T"/dr*.out "$T"/dp*.out | grep -ci error)" = "12" ] && echo "PASS: D · los 12 intentos directos se rechazan" || { echo "FAIL: D · rechazados=$(cat "$T"/dr*.out "$T"/dp*.out | grep -ci error) de 12"; FAILED=1; }

# E
("${P[@]}" -c "$A select pg_sleep(0.05); select public.confirmar_entrega(tests.id('c3b_sE'), 'proofs/c3b-e.png', 'R')" > "$T/e0.out" 2>&1) &
for i in $(seq 1 8); do ("${P[@]}" -c "$A update public.shipments set status = 'incident', incident = '{\"type\":\"n$i\"}' where id = tests.id('c3b_sE')" > "$T/e$i.out" 2>&1) & done; wait
check "E · cierre contra actualizaciones de incidencia: queda entregado, con su evidencia" "select status = 'delivered' and proof_image_url = 'proofs/c3b-e.png' from public.shipments where id = tests.id('c3b_sE')"
[ "$(cat "$T/e0.out" | grep -ci error)" = "0" ] && echo "PASS: E · el cierre legítimo no falla por la carrera" || { echo "FAIL: E · $(grep -i error "$T/e0.out" | head -1)"; FAILED=1; }

# F · el cierre retiene su transacción 1.5 s; el borrado llega en medio
("${P[@]}" -c "$A select public.confirmar_entrega(tests.id('c3b_sF'), 'proofs/c3b-f.png', 'R'); select pg_sleep(1.5)" > "$T/f0.out" 2>&1) &
sleep 0.5
"${P[@]}" -c "$A delete from storage.objects where bucket_id = 'proofs' and name = 'proofs/c3b-f.png'" > "$T/f1.out" 2>&1; wait
check "F · borrar la foto durante el cierre: la foto sobrevive y el envío queda entregado con ella" "select (select status = 'delivered' and proof_image_url = 'proofs/c3b-f.png' from public.shipments where id = tests.id('c3b_sF')) and exists (select 1 from storage.objects where bucket_id = 'proofs' and name = 'proofs/c3b-f.png')"
grep -q EVIDENCIA_PROTEGIDA "$T/f1.out" && echo "PASS: F · el borrado esperó al cierre y lo rechazó el disparador (EVIDENCIA_PROTEGIDA)" || { echo "FAIL: F · salida del borrado: $(head -2 "$T/f1.out" | tr '\n' ' ')"; FAILED=1; }

# G · el borrado retiene su transacción; el cierre llega en medio
("${P[@]}" -c "$A delete from storage.objects where bucket_id = 'proofs' and name = 'proofs/c3b-g.png'; select pg_sleep(1.5)" > "$T/g0.out" 2>&1) &
sleep 0.5
"${P[@]}" -c "$A select public.confirmar_entrega(tests.id('c3b_sG'), 'proofs/c3b-g.png', 'R')" > "$T/g1.out" 2>&1; wait
check "G · cerrar con una foto que se está borrando: el envío sigue abierto, sin evidencia fantasma" "select (select status = 'out_for_delivery' and proof_image_url is null from public.shipments where id = tests.id('c3b_sG')) and not exists (select 1 from storage.objects where name = 'proofs/c3b-g.png')"
grep -q EVIDENCIA_INVALIDA "$T/g1.out" && echo "PASS: G · el cierre esperó al borrado y se rechazó (EVIDENCIA_INVALIDA)" || { echo "FAIL: G · salida del cierre: $(head -2 "$T/g1.out" | tr '\n' ' ')"; FAILED=1; }

# H
for i in $(seq 1 6); do ("${P[@]}" -c "$B select public.confirmar_entrega(tests.id('c3b_sH'), 'proofs/c3b-h.png', 'Intruso')" > "$T/hb$i.out" 2>&1) & done
("${P[@]}" -c "$A select public.confirmar_entrega(tests.id('c3b_sH'), 'proofs/c3b-h.png', 'Legítimo')" > "$T/ha.out" 2>&1) & wait
check "H · chofer ajeno durante el cierre legítimo: lo cierra el asignado" "select status = 'delivered' and received_by = 'Legítimo' from public.shipments where id = tests.id('c3b_sH')"
[ "$(cat "$T"/hb*.out | grep -c 'No tienes permiso')" = "6" ] && echo "PASS: H · los 6 intentos del chofer ajeno se rechazan" || { echo "FAIL: H · rechazos=$(cat "$T"/hb*.out | grep -c 'No tienes permiso')"; FAILED=1; }

check "Z · ninguna evidencia quedó en dos envíos y toda evidencia registrada existe" "select not exists (select 1 from public.shipments where proof_image_url is not null group by proof_image_url having count(*) > 1) and not exists (select 1 from public.shipments s where s.proof_image_url like 'proofs/c3b-%' and not exists (select 1 from storage.objects o where o.bucket_id = 'proofs' and o.name = s.proof_image_url))"
"${P[@]}" -c "delete from tests.ctx where key like 'c3b_%'" >/dev/null
exit $FAILED
