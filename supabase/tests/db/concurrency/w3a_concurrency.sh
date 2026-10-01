#!/usr/bin/env bash
# ============================================================================
# W3-A · Concurrencia REAL de la intención fiscal: dos sesiones en paralelo.
# La sesión A retiene sus locks (pg_sleep antes del COMMIT) y la B arranca dentro
# de esa ventana. Se verifica el estado CONFIRMADO en la BD, no la salida.
#
# Lo que se demuestra: es imposible que dos workers ganen la misma intención y es
# imposible que un pedido acabe con dos intenciones vivas. Sin llamar a Facturama.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
sql()   { "${P[@]}" -v ON_ERROR_STOP=1 -c "$1"; }
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
# grep -E: en BRE de BSD un `$` a media expresión es literal y la alternancia nunca empata.
has()   { if grep -Eq "$2" "$3"; then echo "PASS: $1"; else echo "FAIL: $1 (salida: $(tr '\n' ' ' < "$3" | cut -c1-200))"; FAILED=1; fi; }
race() {
  ("${P[@]}" -c "begin; $1; select pg_sleep(1.5); commit;" > "$T/a.out" 2>&1) &
  sleep 0.4
  ("${P[@]}" -c "begin; $2; commit;" > "$T/b.out" 2>&1) &
  wait
}

# ── 1) Dos SOLICITUDES del mismo pedido a la vez ⇒ una sola intención viva
sql "do \$\$ declare v_p uuid := tests.product(100); v_o uuid; begin
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  insert into tests.ctx values ('f1_admin', tests.user('admin')), ('f1_o', v_o);
end \$\$;" >/dev/null
CMD1="select tests.act_as(tests.id('f1_admin')); select public.solicitar_cfdi(gen_random_uuid(), tests.id('f1_o'), tests.fiscal()) ->> 'status'"
race "$CMD1" "$CMD1"
has "f1: A registra la intención" "^applied$" "$T/a.out"
has "f1: B en paralelo NO crea una segunda intención" "already_requested|uq_fiscal_doc_vivo|duplicate key|deadlock|could not serialize" "$T/b.out"
check "f1: un solo documento fiscal para el pedido" "select count(*) = 1 from public.fiscal_documents where order_id = tests.id('f1_o')"
check "f1: un solo documento VIVO" "select count(*) = 1 from public.fiscal_documents where order_id = tests.id('f1_o') and status in ('pendiente','en_proceso','timbrado','incierto')"

# ── 2) Mismo op_id en paralelo ⇒ un solo efecto registrado
sql "do \$\$ declare v_p uuid := tests.product(100); v_o uuid; begin
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  insert into tests.ctx values ('f2_admin', tests.user('admin')), ('f2_o', v_o), ('f2_op', gen_random_uuid());
end \$\$;" >/dev/null
CMD2="select tests.act_as(tests.id('f2_admin')); select public.solicitar_cfdi(tests.id('f2_op'), tests.id('f2_o'), tests.fiscal()) ->> 'status'"
race "$CMD2" "$CMD2"
has "f2: A aplica la solicitud" "^applied$" "$T/a.out"
has "f2: B con el mismo op_id no produce un segundo efecto" "already_applied|duplicate key|fiscal_operations_pkey|deadlock|could not serialize" "$T/b.out"
check "f2: una sola operación registrada" "select count(*) = 1 from public.fiscal_operations where op_id = tests.id('f2_op')"
check "f2: un solo documento fiscal" "select count(*) = 1 from public.fiscal_documents where order_id = tests.id('f2_o')"

# ── 3) EL RECLAMO: dos workers pelean por la misma intención ⇒ gana exactamente uno
# Es la prueba que sustituye al agujero anterior: antes ambos llamaban al PAC.
sql "do \$\$ declare v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_admin uuid := tests.user('admin'); begin
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  insert into tests.ctx values ('f3_admin', v_admin), ('f3_o', v_o), ('f3_d', v_d);
end \$\$;" >/dev/null
CMD3="select tests.act_as(tests.id('f3_admin')); select coalesce(tests.reclamar(tests.id('f3_d')) ->> 'status', 'PERDIO')"
race "$CMD3" "$CMD3"
has "f3: A gana el reclamo" "^applied$" "$T/a.out"
has "f3: B NO gana el mismo reclamo" "CFDI_EN_PROCESO|deadlock|could not serialize" "$T/b.out"
check "f3: un solo intento contado (no dos)" "select attempts = 1 from public.fiscal_documents where id = tests.id('f3_d')"
check "f3: un solo folio asignado" "select folio is not null from public.fiscal_documents where id = tests.id('f3_d')"
check "f3: un solo reclamo en la bitácora" "select count(*) = 1 from public.fiscal_document_events where fiscal_document_id = tests.id('f3_d') and event = 'claim'"
check "f3: el documento quedó en_proceso con un claim_id" "select status = 'en_proceso' and claim_id is not null from public.fiscal_documents where id = tests.id('f3_d')"

# ── 4) Solicitar mientras otra sesión reclama ⇒ no nace una segunda intención
sql "do \$\$ declare v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_admin uuid := tests.user('admin'); begin
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  insert into tests.ctx values ('f4_admin', v_admin), ('f4_o', v_o), ('f4_d', v_d);
end \$\$;" >/dev/null
race "select tests.act_as(tests.id('f4_admin')); select coalesce(tests.reclamar(tests.id('f4_d')) ->> 'status', 'PERDIO')" \
     "select tests.act_as(tests.id('f4_admin')); select public.solicitar_cfdi(gen_random_uuid(), tests.id('f4_o'), tests.fiscal()) ->> 'status'"
has "f4: el reclamo se aplica" "^applied$" "$T/a.out"
has "f4: la solicitud en paralelo no abre una segunda emisión" "CFDI_EN_PROCESO|already_requested|deadlock|could not serialize" "$T/b.out"
check "f4: sigue habiendo un solo documento" "select count(*) = 1 from public.fiscal_documents where order_id = tests.id('f4_o')"

# ── conciliación global tras las carreras
check "global: conciliación fiscal sin errores salvo los ambiguos esperados" \
  "select count(*) = 0 from (select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role_id = 'admin' limit 1), 'role', 'authenticated')::text, true)) s, public.conciliar_cfdi() c where c.severidad = 'error' and c.check_id not in ('C3_claim_abandonado','C4_incierto_sin_conciliar')"
# No se verifica aquí el inventario de W1: W3-A no mueve existencias, y el estado que dejen
# otros guiones de concurrencia del mismo cluster no dice nada sobre la intención fiscal.
check "global: W3-A no tocó el kardex (ningún movimiento ligado a una operación fiscal)" \
  "select count(*) = 0 from public.inventory_movements m where m.op_id in (select op_id from public.fiscal_operations)"
check "global: ningún documento timbrado sin folio del SAT" "select count(*) = 0 from public.fiscal_documents where status = 'timbrado' and uuid is null"
check "global: ningún pedido con dos intenciones vivas" "select count(*) = 0 from (select order_id from public.fiscal_documents where status in ('pendiente','en_proceso','timbrado','incierto') group by order_id, kind having count(*) > 1) x"

exit $FAILED
