#!/usr/bin/env bash
# ============================================================================
# SEC-B · Concurrencia REAL del corte por cajero (D-SECB-2): dos sesiones en paralelo.
# La sesión A retiene sus locks (pg_sleep antes del COMMIT) y la B arranca dentro de esa ventana.
# Se verifica el estado CONFIRMADO en la BD, no la salida.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
sql()   { "${P[@]}" -v ON_ERROR_STOP=1 -c "$1"; }
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
has()   { if grep -q "$2" "$3"; then echo "PASS: $1"; else echo "FAIL: $1 (salida: $(tr '\n' ' ' < "$3" | cut -c1-200))"; FAILED=1; fi; }
race() {
  ("${P[@]}" -c "begin; $1; select pg_sleep(1.5); commit;" > "$T/a.out" 2>&1) &
  sleep 0.4
  ("${P[@]}" -c "begin; $2; commit;" > "$T/b.out" 2>&1) &
  wait
}

# El efectivo del cajero entra por vender_pos (único cobro del POS)
sql "do \$\$ declare v_pos uuid := tests.user('pos', 'secb-conc-pos@test.local'); v_pos2 uuid := tests.user('pos', 'secb-conc-pos2@test.local'); begin
  insert into tests.ctx values ('sb_pos', v_pos), ('sb_pos2', v_pos2), ('sb_bill', tests.user('billing'));
  perform tests.venta_pos(v_pos, 70);
  perform tests.venta_pos(v_pos2, 40);
end \$\$;" >/dev/null

# ── 1) El MISMO cajero cierra su corte dos veces en paralelo (op_id distintos)
CMD="select tests.act_as(tests.id('sb_pos')); select public.registrar_corte_caja(gen_random_uuid(), public.hoy_local(), 'cajero', 0, 70, null, tests.id('sb_pos')) ->> 'esperado'"
race "$CMD" "$CMD"
has "s1: A cierra SU corte con el esperado del servidor (70)" "^70$" "$T/a.out"
has "s1: B en paralelo NO vuelve a arquear el mismo efectivo" "MOTIVO_REQUERIDO\|uq_cierre_cadena\|TRAMO_VACIO\|deadlock" "$T/b.out"
check "s1: UN solo corte vigente del cajero" "select count(*) = 1 from public.cash_closings where alcance = 'cajero' and cajero = tests.id('sb_pos') and voids_closing_id is null"
check "s1: el efectivo del cajero se arqueó UNA vez (70)" "select coalesce(sum(esperado), 0) = 70 from public.cash_closings where alcance = 'cajero' and cajero = tests.id('sb_pos')"

# ── 2) Mientras un POS cierra su corte, OTRO POS intenta cerrar ese mismo corte ajeno
A="select tests.act_as(tests.id('sb_pos2')); select public.registrar_corte_caja(gen_random_uuid(), public.hoy_local(), 'cajero', 0, 40, null, tests.id('sb_pos2')) ->> 'esperado'"
B="select tests.act_as(tests.id('sb_pos')); select public.registrar_corte_caja(gen_random_uuid(), public.hoy_local(), 'cajero', 0, 40, null, tests.id('sb_pos2')) ->> 'esperado'"
race "$A" "$B"
has "s2: el dueño cierra su corte (40)" "^40$" "$T/a.out"
has "s2: el otro POS es rechazado (no cierra ni consume el corte ajeno)" "solo puedes cerrar tu propio corte" "$T/b.out"
check "s2: el corte de pos2 es uno y lo creó pos2" "select count(*) = 1 and bool_and(created_by = tests.id('sb_pos2')) from public.cash_closings where alcance = 'cajero' and cajero = tests.id('sb_pos2')"

# ── 3) Corte propio del POS y corte de OTRO cajero por Facturación en paralelo: cadenas independientes.
#     (No se toca la cadena del DÍA: es estado compartido con otros scripts de concurrencia.)
sql "do \$\$ begin perform tests.venta_pos(tests.id('sb_pos'), 15); perform tests.venta_pos(tests.id('sb_pos2'), 5); end \$\$;" >/dev/null
A="select tests.act_as(tests.id('sb_pos')); select public.registrar_corte_caja(gen_random_uuid(), public.hoy_local(), 'cajero', 0, 15, null, tests.id('sb_pos')) ->> 'esperado'"
B="select tests.act_as(tests.id('sb_bill')); select public.registrar_corte_caja(gen_random_uuid(), public.hoy_local(), 'cajero', 0, 5, null, tests.id('sb_pos2')) ->> 'esperado'"
race "$A" "$B"
has "s3: el POS cierra el tramo nuevo de SU cadena (15)" "^15$" "$T/a.out"
has "s3: Facturación cierra en paralelo el corte de otro cajero (5, cadena independiente)" "^5$" "$T/b.out"
check "s3: ningún tramo traslapado tras las carreras" "select count(*) = 0 from public.cash_closings a, public.cash_closings b where a.id <> b.id and a.alcance = b.alcance and a.cajero is not distinct from b.cajero and a.voids_closing_id is null and b.voids_closing_id is null and a.corte_desde < b.corte_hasta and b.corte_desde < a.corte_hasta"
check "s3: ningún corte de POS fuera de su propia cadena" "select count(*) = 0 from public.cash_closings c join public.profiles p on p.id = c.created_by where p.role_id = 'pos' and (c.alcance <> 'cajero' or c.cajero is distinct from c.created_by)"
check "s3: la cadena del DÍA no la tocó ningún POS" "select count(*) = 0 from public.cash_closings c join public.profiles p on p.id = c.created_by where p.role_id = 'pos' and c.alcance = 'dia'"

exit $FAILED
