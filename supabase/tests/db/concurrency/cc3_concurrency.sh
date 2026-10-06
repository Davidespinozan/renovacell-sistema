#!/usr/bin/env bash
# ============================================================================
# CC-3 · Concurrencia REAL del conocimiento: las cardinalidades las sostiene la base.
#   A. 8 guardados simultáneos de la misma (producto, sección) → 1 borrador.
#   B. 2 ediciones con la misma rev → exactamente una entra (optimista).
#   C. 6 aprobaciones simultáneas del mismo borrador → 1 approved, sin error.
#   D. aprobar v2 mientras otra sesión aprueba v2 (re-entrada) → 1 approved por sección, v1 retirada una vez.
#   E. mismo alias para dos productos a la vez → uno gana, el otro ALIAS_AMBIGUO.
#   F. importación concurrente → sin duplicados por (producto, sección, versión).
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
ADM="select tests.act_as(tests.id('cc3_adm'));"

"${P[@]}" -c "do \$\$ declare a uuid := tests.fixture_admin(); pa uuid; pb uuid; begin
  pa := tests.producto_fam('Rellenos', 'Concur'); pb := tests.producto_fam('Rellenos', 'Concur');
  delete from tests.ctx where key like 'cc3_%';
  insert into tests.ctx values ('cc3_adm', a), ('cc3_pa', pa), ('cc3_pb', pb);
  perform tests.act_as_service();
  update public.products set odoo_reference = 'Caja 1 ml' where id in (pa, pb);
end \$\$;" >/dev/null

# ── A) 8 guardados simultáneos de la misma sección → 1 borrador
for i in $(seq 1 8); do ("${P[@]}" -c "$ADM select public.cc_conocimiento_guardar(tests.id('cc3_pa'), 'resumen', 'texto $i') ->> 'id'" > "$T/a$i.out" 2>&1) & done; wait
check "A · un solo borrador de resumen para el producto" "select count(*) = 1 from public.cc_product_knowledge where product_id = tests.id('cc3_pa') and seccion = 'resumen' and estado = 'draft'"
OK=$(cat "$T"/a*.out | grep -cE '^[0-9a-f-]{36}$' || true); DUP=$(cat "$T"/a*.out | grep -c 'DRAFT_EXISTE\|uq_cpk_draft\|product_id_seccion_version_key' || true)
[ "$OK" = "1" ] && [ "$DUP" = "7" ] && echo "PASS: A · 1 ganó, 7 fueron rechazados (DRAFT_EXISTE o índice único de borrador/versión)" || { echo "FAIL: A · ok=$OK dup=$DUP: $(cat "$T"/a*.out | grep -iv '^[0-9a-f-]\{36\}$' | head -2 | tr '\n' ' ' | cut -c1-200)"; FAILED=1; }
D1=$("${P[@]}" -c "select id from public.cc_product_knowledge where product_id = tests.id('cc3_pa') and seccion = 'resumen' and estado = 'draft'" | tail -n1)

# ── B) dos ediciones con la misma rev → exactamente una
("${P[@]}" -c "$ADM select public.cc_conocimiento_guardar(tests.id('cc3_pa'), 'resumen', 'edición uno', null, null, null, '$D1', 1) ->> 'rev'" > "$T/b1.out" 2>&1) &
("${P[@]}" -c "$ADM select public.cc_conocimiento_guardar(tests.id('cc3_pa'), 'resumen', 'edición dos', null, null, null, '$D1', 1) ->> 'rev'" > "$T/b2.out" 2>&1) &
wait
GANA=$(cat "$T"/b1.out "$T"/b2.out | grep -c '^2$' || true); PIERDE=$(cat "$T"/b1.out "$T"/b2.out | grep -c 'REV_DESACTUALIZADA' || true)
[ "$GANA" = "1" ] && [ "$PIERDE" = "1" ] && echo "PASS: B · una edición entró (rev 2); la otra recibió REV_DESACTUALIZADA" || { echo "FAIL: B · gana=$GANA pierde=$PIERDE: $(cat "$T"/b1.out "$T"/b2.out | tr '\n' ' ' | cut -c1-160)"; FAILED=1; }
check "B · rev final = 2 (no 3)" "select rev = 2 from public.cc_product_knowledge where id = '$D1'"

# ── C) 6 aprobaciones simultáneas del mismo borrador → 1 approved, idempotente
for i in $(seq 1 6); do ("${P[@]}" -c "$ADM select public.cc_conocimiento_aprobar('$D1') ->> 'estado'" > "$T/c$i.out" 2>&1) & done; wait
APR=$(cat "$T"/c*.out | grep -c '^approved$' || true)
[ "$APR" = "6" ] && echo "PASS: C · las 6 sesiones terminaron en approved (sin error, idempotente)" || { echo "FAIL: C · approved=$APR: $(cat "$T"/c*.out | grep -v '^approved$' | head -2 | tr '\n' ' ' | cut -c1-160)"; FAILED=1; }
check "C · un solo evento aprobar para esa versión" "select count(*) = 1 from public.cc_knowledge_events where entidad = 'producto' and entidad_id = '$D1' and accion = 'aprobar'"

# ── D) nueva versión aprobada concurrentemente → 1 approved por sección, v1 retirada una vez
D2=$("${P[@]}" -c "$ADM select public.cc_conocimiento_guardar(tests.id('cc3_pa'), 'resumen', 'versión dos') ->> 'id'" | tail -n1)
for i in 1 2 3 4; do ("${P[@]}" -c "$ADM select public.cc_conocimiento_aprobar('$D2') ->> 'estado'" > "$T/d$i.out" 2>&1) & done; wait
check "D · exactamente un approved en la sección" "select count(*) = 1 from public.cc_product_knowledge where product_id = tests.id('cc3_pa') and seccion = 'resumen' and estado = 'approved'"
check "D · v1 retirada y v2 vigente" "select (select estado from public.cc_product_knowledge where id = '$D1') = 'retired' and (select estado from public.cc_product_knowledge where id = '$D2') = 'approved'"
check "D · v1 se retiró UNA vez (un evento retirar)" "select count(*) = 1 from public.cc_knowledge_events where entidad = 'producto' and entidad_id = '$D1' and accion = 'retirar'"

# ── E) mismo alias a dos productos a la vez → uno gana
("${P[@]}" -c "$ADM select public.cc_alias_guardar(tests.id('cc3_pa'), 'Concurrente')" > "$T/e1.out" 2>&1) &
("${P[@]}" -c "$ADM select public.cc_alias_guardar(tests.id('cc3_pb'), 'concurrente')" > "$T/e2.out" 2>&1) &
wait
GANA=$(cat "$T"/e1.out "$T"/e2.out | grep -cE '^[0-9a-f-]{36}$' || true); PIERDE=$(cat "$T"/e1.out "$T"/e2.out | grep -c 'ALIAS_AMBIGUO\|uq_cpa\|duplicate key' || true)
[ "$GANA" = "1" ] && [ "$PIERDE" = "1" ] && echo "PASS: E · un alias, un dueño; el otro fue rechazado" || { echo "FAIL: E · gana=$GANA pierde=$PIERDE: $(cat "$T"/e1.out "$T"/e2.out | tr '\n' ' ' | cut -c1-160)"; FAILED=1; }
check "E · el alias normalizado existe una sola vez" "select count(*) = 1 from public.cc_product_aliases where alias_norm = 'concurrente'"

# ── F) importación concurrente → sin duplicados
for i in 1 2 3; do ("${P[@]}" -c "$ADM select public.cc_importar_conocimiento_existente() ->> 'presentacion'" > "$T/f$i.out" 2>&1) & done; wait
check "F · una sola presentación importada por producto (unique (product, seccion, version) sostiene)" "select count(*) = 2 from public.cc_product_knowledge where product_id in (tests.id('cc3_pa'), tests.id('cc3_pb')) and seccion = 'presentacion'"
check "F · todo lo importado es borrador" "select not exists (select 1 from public.cc_product_knowledge where importado_de like 'products.%' and estado <> 'draft')"

"${P[@]}" -c "delete from tests.ctx where key like 'cc3_%'" >/dev/null
exit $FAILED
