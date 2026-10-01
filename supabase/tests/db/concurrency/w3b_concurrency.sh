#!/usr/bin/env bash
# ============================================================================
# W3-B · Concurrencia REAL de la numeración fiscal: dos sesiones en paralelo.
# Lo que se demuestra: es imposible que dos reclamos reciban el mismo folio, y un
# reclamo perdido NO consume numeración ni asigna un segundo folio.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
sql()   { "${P[@]}" -v ON_ERROR_STOP=1 -c "$1"; }
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
has()   { if grep -Eq "$2" "$3"; then echo "PASS: $1"; else echo "FAIL: $1 (salida: $(tr '\n' ' ' < "$3" | cut -c1-200))"; FAILED=1; fi; }
race() {
  ("${P[@]}" -c "begin; $1; select pg_sleep(1.5); commit;" > "$T/a.out" 2>&1) &
  sleep 0.4
  ("${P[@]}" -c "begin; $2; commit;" > "$T/b.out" 2>&1) &
  wait
}

# ── 1) Dos reclamos de DISTINTAS intenciones a la vez ⇒ folios distintos
sql "do \$\$ declare v_p uuid := tests.product(100); v_a uuid; v_b uuid; v_admin uuid := tests.user('admin'); begin
  perform tests.emisor('AAA010101AAA');
  v_a := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  v_b := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  insert into tests.ctx values ('g1_admin', v_admin), ('g1_da', tests.solicitud(v_a)), ('g1_db', tests.solicitud(v_b));
end \$\$;" >/dev/null
race "select tests.act_as(tests.id('g1_admin')); select tests.reclamar_id(tests.id('g1_da'), 'produccion') ->> 'folio'" \
     "select tests.act_as(tests.id('g1_admin')); select tests.reclamar_id(tests.id('g1_db'), 'produccion') ->> 'folio'"
has "g1: A obtiene folio" "^[0-9]+$" "$T/a.out"
has "g1: B obtiene folio" "^[0-9]+$|deadlock|could not serialize" "$T/b.out"
check "g1: los dos folios son DISTINTOS" "select count(distinct folio) = count(*) from public.fiscal_documents where id in (tests.id('g1_da'), tests.id('g1_db')) and folio is not null"
check "g1: ningún folio repetido en el dominio del proveedor" "select count(*) = 0 from (select provider, coalesce(provider_env,''), coalesce(issuer_rfc,''), folio from public.fiscal_documents where folio is not null group by 1,2,3,4 having count(*) > 1) x"

# ── 2) Dos reclamos de la MISMA intención ⇒ uno gana, el otro NO consume folio
sql "do \$\$ declare v_p uuid := tests.product(100); v_o uuid; v_admin uuid := tests.user('admin'); begin
  perform tests.emisor('AAA010101AAA');
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  insert into tests.ctx values ('g2_admin', v_admin), ('g2_d', tests.solicitud(v_o));
  insert into tests.ctx values ('g2_antes', gen_random_uuid());
end \$\$;" >/dev/null
ANTES=$("${P[@]}" -c "select coalesce(max(next_folio), 1) from public.fiscal_folio_domains where provider_env = 'produccion'")
CMD="select tests.act_as(tests.id('g2_admin')); select tests.reclamar_id(tests.id('g2_d'), 'produccion') ->> 'folio'"
race "$CMD" "$CMD"
has "g2: A reclama la intención" "^[0-9]+$" "$T/a.out"
has "g2: B NO vuelve a reclamarla" "CFDI_EN_PROCESO|deadlock|could not serialize" "$T/b.out"
check "g2: la intención tiene UN solo folio" "select folio is not null from public.fiscal_documents where id = tests.id('g2_d')"
check "g2: el contador avanzó UNA sola vez (el perdedor no consumió numeración)" "select next_folio = $ANTES + 1 from public.fiscal_folio_domains where provider_env = 'produccion'"
check "g2: un solo reclamo en la bitácora" "select count(*) = 1 from public.fiscal_document_events where fiscal_document_id = tests.id('g2_d') and event = 'claim'"

# ── 3) Mismo op_id en paralelo ⇒ un solo efecto
sql "do \$\$ declare v_p uuid := tests.product(100); v_o uuid; v_admin uuid := tests.user('admin'); begin
  perform tests.emisor('AAA010101AAA');
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  insert into tests.ctx values ('g3_admin', v_admin), ('g3_d', tests.solicitud(v_o)), ('g3_op', gen_random_uuid());
end \$\$;" >/dev/null
CMD3="select tests.act_as(tests.id('g3_admin')); select public.reclamar_cfdi(tests.id('g3_op'), tests.id('g3_d'), 'produccion') ->> 'folio'"
race "$CMD3" "$CMD3"
has "g3: A aplica el reclamo" "^[0-9]+$" "$T/a.out"
has "g3: B con el mismo op_id no produce un segundo efecto" "already_applied|duplicate key|fiscal_operations_pkey|CFDI_EN_PROCESO|deadlock|could not serialize" "$T/b.out"
check "g3: una sola operación registrada" "select count(*) = 1 from public.fiscal_operations where op_id = tests.id('g3_op')"

# ── invariantes globales tras las carreras
check "global: ningún documento timbrado sin folio del SAT" "select count(*) = 0 from public.fiscal_documents where status = 'timbrado' and uuid is null"
check "global: ninguna intención en proceso sin identidad completa" "select count(*) = 0 from public.fiscal_documents where status in ('en_proceso','timbrado','incierto','cancelado') and (serie is null or folio is null or provider_date_sent is null or issuer_rfc is null)"
check "global: conciliación fiscal sin errores de identidad" "select count(*) = 0 from (select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role_id = 'admin' limit 1), 'role', 'authenticated')::text, true)) s, public.conciliar_cfdi() c where c.check_id in ('C12_folio_repetido_proveedor','C13_identidad_incompleta')"

exit $FAILED
