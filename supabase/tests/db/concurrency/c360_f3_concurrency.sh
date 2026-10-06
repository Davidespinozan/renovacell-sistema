#!/usr/bin/env bash
# ============================================================================
# C360-F3 · Concurrencia REAL (sesiones paralelas): un solo principal/predeterminado por cliente.
#   A. 5 teléfonos "principal" a la vez → 1 principal y customers.phone = su número.
#   B. el MISMO número 4 veces a la vez → 1 fila.
#   C. 5 domicilios "predeterminado" a la vez → 1 predeterminado activo.
#   D. 5 perfiles fiscales "predeterminado" a la vez → 1 predeterminado; espejo = ese.
#   E. archivar el predeterminado mientras se elige otro → exactamente 1 predeterminado activo.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
SVC="select tests.act_as_service();"

"${P[@]}" -c "do \$\$ declare d uuid := tests.user('doctor'); c uuid; begin
  delete from tests.ctx where key like 'c3f_%';
  perform tests.act_as_service();
  c := tests.cliente(d);
  insert into tests.ctx values ('c3f_c', c);
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-200)"; exit 1; }
C=$("${P[@]}" -c "select tests.id('c3f_c')")

# A) 5 principales simultáneos
for i in 1 2 3 4 5; do ("${P[@]}" -c "$SVC select public.cliente_telefono_guardar('$C', null, '66911100$i$i', 'celular', true) ->> 'id'" > "$T/a$i.out" 2>&1) & done; wait
check "A · un solo principal activo" "select count(*) = 1 from public.customer_phones where customer_id = '$C' and es_principal and activo"
check "A · customers.phone = número del principal" "select c.phone = p.numero from public.customers c join public.customer_phones p on p.customer_id = c.id and p.es_principal and p.activo where c.id = '$C'"
check "A · ningún error inesperado" "select true" ; grep -qiE 'ERROR' "$T"/a*.out && { echo "FAIL: A · errores: $(cat "$T"/a*.out | grep -i error | head -2 | tr '\n' ' ' | cut -c1-160)"; FAILED=1; }

# B) mismo número 4 veces
for i in 1 2 3 4; do ("${P[@]}" -c "$SVC select public.cliente_telefono_guardar('$C', null, '6697776655', 'whatsapp') ->> 'id'" > "$T/b$i.out" 2>&1) & done; wait
check "B · el mismo número una sola vez" "select count(*) = 1 from public.customer_phones where customer_id = '$C' and numero_norm = '6697776655' and activo"
check "B · los demás reciben TELEFONO_DUPLICADO" "select $(cat "$T"/b*.out | grep -c 'TELEFONO_DUPLICADO') = 3"

# C) 5 domicilios predeterminados simultáneos
for i in 1 2 3 4 5; do ("${P[@]}" -c "$SVC select public.cliente_ubicacion_guardar('$C', null, '{\"tipo\":\"OFICINA\",\"name\":\"Oficina $i\",\"line1\":\"Calle $i\",\"postal_code\":\"8200$i\",\"city\":\"Mazatlán\",\"state\":\"Sinaloa\"}'::jsonb, true) ->> 'id'" > "$T/c$i.out" 2>&1) & done; wait
check "C · 5 domicilios creados" "select count(*) = 5 from public.doctor_locations where customer_id = '$C' and active"
check "C · un solo predeterminado activo" "select count(*) = 1 from public.doctor_locations where customer_id = '$C' and active and is_default"

# D) 5 perfiles fiscales predeterminados simultáneos
for i in 1 2 3 4 5; do ("${P[@]}" -c "$SVC select public.cliente_fiscal_guardar('$C', null, tests.fiscal('AAA01010$i' || 'AA$i'), true) ->> 'id'" > "$T/d$i.out" 2>&1) & done; wait
check "D · 5 perfiles creados" "select count(*) = 5 from public.customer_fiscal_profiles where customer_id = '$C' and activo"
check "D · un solo predeterminado; el espejo lo refleja" "select count(*) = 1 and bool_and(c.meta -> 'fiscal' ->> 'rfc' = f.rfc) from public.customer_fiscal_profiles f join public.customers c on c.id = f.customer_id where f.customer_id = '$C' and f.es_predeterminado and f.activo"

# E) archivar el predeterminado mientras se elige otro
DEF=$("${P[@]}" -c "select id from public.doctor_locations where customer_id = '$C' and is_default and active")
OTRO=$("${P[@]}" -c "select id from public.doctor_locations where customer_id = '$C' and not is_default and active order by created_at desc limit 1")
("${P[@]}" -c "$SVC select public.cliente_ubicacion_archivar('$DEF')" > "$T/e1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cliente_ubicacion_predeterminar('$OTRO')" > "$T/e2.out" 2>&1) &
wait
check "E · exactamente un predeterminado activo tras la carrera" "select count(*) = 1 from public.doctor_locations where customer_id = '$C' and active and is_default"
check "E · el archivado no es predeterminado" "select not is_default and not active from public.doctor_locations where id = '$DEF'"

"${P[@]}" -c "delete from tests.ctx where key like 'c3f_%'" >/dev/null
exit $FAILED
