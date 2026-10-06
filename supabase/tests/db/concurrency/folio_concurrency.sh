#!/usr/bin/env bash
# FOLIO · 20 crear_pedido simultáneos sin folio → 20 folios distintos; 10 con el MISMO folio del cliente → 10 pedidos, 10 folios distintos.
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
"${P[@]}" -c "do \$\$ declare d uuid := tests.user('doctor'); p uuid := tests.producto_fam('Rellenos', 'FolioC', 100); begin delete from tests.ctx where key like 'folio_%'; insert into tests.ctx values ('folio_doc', d), ('folio_p', p); end \$\$;" >/dev/null
DOC="select tests.act_as(tests.id('folio_doc'));"
for i in $(seq 1 20); do ("${P[@]}" -c "$DOC select public.crear_pedido(gen_random_uuid(), null, tests.id('folio_doc'), jsonb_build_array(jsonb_build_object('product_id', tests.id('folio_p'), 'qty', 1))) ->> 'folio'" > "$T/a$i.out" 2>&1) & done; wait
N=$(cat "$T"/a*.out | grep -cE '^S[0-9]{6,}$' || true); U=$(cat "$T"/a*.out | grep -E '^S[0-9]{6,}$' | sort -u | wc -l | tr -d ' ')
[ "$N" = "20" ] && [ "$U" = "20" ] && echo "PASS: A · 20 pedidos simultáneos sin folio → 20 folios distintos" || { echo "FAIL: A · ok=$N unicos=$U: $(cat "$T"/a*.out | grep -i error | head -1)"; FAILED=1; }
for i in $(seq 1 10); do ("${P[@]}" -c "$DOC select public.crear_pedido(gen_random_uuid(), 'S777777', tests.id('folio_doc'), jsonb_build_array(jsonb_build_object('product_id', tests.id('folio_p'), 'qty', 1))) ->> 'folio'" > "$T/b$i.out" 2>&1) & done; wait
N=$(cat "$T"/b*.out | grep -cE '^S[0-9]{6,}$' || true); U=$(cat "$T"/b*.out | grep -E '^S[0-9]{6,}$' | sort -u | wc -l | tr -d ' ')
[ "$N" = "10" ] && [ "$U" = "10" ] && echo "PASS: B · 10 clientes con el MISMO folio a la vez → 10 pedidos con folios distintos (uno conserva S777777)" || { echo "FAIL: B · ok=$N unicos=$U: $(cat "$T"/b*.out | grep -i error | head -1)"; FAILED=1; }
check "B · exactamente un S777777" "select count(*) = 1 from public.orders where external_ref = 'S777777'"
check "C · cero duplicados en orders" "select count(*) = count(distinct external_ref) from public.orders where external_ref is not null"
"${P[@]}" -c "delete from tests.ctx where key like 'folio_%'" >/dev/null
exit $FAILED
