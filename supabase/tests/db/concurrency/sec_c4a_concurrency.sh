#!/usr/bin/env bash
# SEC-C4-A · cuotas de la búsqueda bajo carrera. Sesiones reales con COMMIT.
#   A · 35 búsquedas simultáneas de un vendedor → pasan exactamente 20; 15 quedan anotadas como exceso de frecuencia.
#       (35 y no más: el cluster de pruebas admite 40 conexiones; por PostgREST se probó con 100.)
#   B · presupuesto con 5 filas disponibles y 15 búsquedas simultáneas de 10 → se devuelven 5 filas en total.
#   C · con 1 fila disponible → 1 en total.   D · con 10 disponibles → 10 en total.
#   E · 20 primeras búsquedas simultáneas de un vendedor nuevo (carrera al crear su fila de cuota) → una sola fila, 20 pasan.
#   F · dos vendedores a la vez no se estorban ni comparten cuota.
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -n1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
"${P[@]}" -c "delete from tests.ctx where key like 'c4a_%'" >/dev/null
"${P[@]}" >/dev/null <<'SQL'
do $$
declare k text;
begin
  foreach k in array array['a', 'b', 'c', 'd', 'e', 'f1', 'f2'] loop insert into tests.ctx values ('c4a_' || k, tests.user('pos')); end loop;
  insert into public.customers (full_name, source, external_id) select 'Carrera C4A ' || lpad(g::text, 3, '0'), 'odoo', 'C4A-CARRERA-' || g from generate_series(1, 60) g;
end $$;
SQL
# cada sesión imprime: <filas devueltas>|<estado>  (estado vacío = 200)
buscar() { echo "select tests.act_as(tests.id('c4a_$1')); select set_config('response.status', '', true); select count(*) from public.buscar_clientes_pos('carrera c4a'); select 'E=' || coalesce(nullif(current_setting('response.status', true), ''), '200');"; }
lanzar() { local u=$1 n=$2 pre=$3; for i in $(seq 1 "$n"); do ("${P[@]}" -c "$(buscar "$u")" 2>&1 | tr '\n' ' ' > "$T/$pre$i.out") & done; wait; }
filas() { cat "$T"/$1*.out | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) s += $i } END { print s + 0 }'; }
con() { cat "$T"/$1*.out | grep -o "E=$2" | wc -l | tr -d ' '; }
usar() { "${P[@]}" -c "insert into public.c4a_cuota (user_id, dia, filas) values (tests.id('c4a_$1'), public._c4a_dia_local(clock_timestamp()), $2) on conflict (user_id) do update set dia = excluded.dia, filas = excluded.filas, marcas = '{}'" >/dev/null; }

lanzar a 35 a
[ "$(con a 200)" = "20" ] && [ "$(con a 429)" = "15" ] && [ "$(filas a)" = "200" ] && echo "PASS: A · 35 simultáneas: pasan exactamente 20 (200 filas) y 15 responden 429" || { echo "FAIL: A · 200=$(con a 200) 429=$(con a 429) filas=$(filas a): $(cat "$T"/a*.out | grep -i error | head -1)"; FAILED=1; }
check "A · la cuota registra 20 marcas y 200 filas; el exceso de frecuencia, 15 intentos en UNA fila" "select (select cardinality(marcas) = 20 and filas = 200 from public.c4a_cuota where user_id = tests.id('c4a_a')) and (select count(*) = 1 and max(intentos) = 15 from public.c4a_excesos where user_id = tests.id('c4a_a') and tipo = 'frecuencia')"

usar b 295; lanzar b 15 b
[ "$(filas b)" = "5" ] && echo "PASS: B · 5 filas disponibles, 15 búsquedas simultáneas de 10: se devuelven 5 filas EN TOTAL" || { echo "FAIL: B · filas devueltas=$(filas b)"; FAILED=1; }
check "B · presupuesto exactamente en 300; 14 intentos anotados como exceso de filas" "select (select filas = 300 from public.c4a_cuota where user_id = tests.id('c4a_b')) and (select intentos = 14 from public.c4a_excesos where user_id = tests.id('c4a_b') and tipo = 'filas')"

usar c 299; lanzar c 12 c
[ "$(filas c)" = "1" ] && echo "PASS: C · 1 fila disponible, 12 simultáneas: se devuelve 1 fila en total" || { echo "FAIL: C · filas devueltas=$(filas c)"; FAILED=1; }
usar d 290; lanzar d 15 d
[ "$(filas d)" = "10" ] && echo "PASS: D · 10 filas disponibles, 15 simultáneas: se devuelven 10 en total" || { echo "FAIL: D · filas devueltas=$(filas d)"; FAILED=1; }
check "C/D · ningún presupuesto pasó de 300" "select max(filas) = 300 and count(*) = 3 from public.c4a_cuota where user_id in (tests.id('c4a_b'), tests.id('c4a_c'), tests.id('c4a_d'))"

lanzar e 20 e
[ "$(con e 200)" = "20" ] && [ "$(cat "$T"/e*.out | grep -ci error)" = "0" ] && echo "PASS: E · 20 primeras búsquedas simultáneas de un vendedor nuevo: todas pasan, sin error" || { echo "FAIL: E · 200=$(con e 200): $(cat "$T"/e*.out | grep -i error | head -1)"; FAILED=1; }
check "E · una sola fila de cuota para ese vendedor, con 20 marcas y 200 filas" "select count(*) = 1 and max(cardinality(marcas)) = 20 and max(filas) = 200 from public.c4a_cuota where user_id = tests.id('c4a_e')"

for i in $(seq 1 15); do ("${P[@]}" -c "$(buscar f1)" 2>&1 | tr '\n' ' ' > "$T/f1_$i.out") & ("${P[@]}" -c "$(buscar f2)" 2>&1 | tr '\n' ' ' > "$T/f2_$i.out") & done; wait
check "F · dos vendedores a la vez: cada uno con SU cuota (15 marcas y 150 filas cada uno)" "select count(*) = 2 and min(cardinality(marcas)) = 15 and max(cardinality(marcas)) = 15 and min(filas) = 150 and max(filas) = 150 from public.c4a_cuota where user_id in (tests.id('c4a_f1'), tests.id('c4a_f2'))"
check "Z · sin interbloqueos ni cuotas negativas o por encima del tope" "select not exists (select 1 from public.c4a_cuota where filas < 0 or filas > 300 or cardinality(marcas) > 20)"
[ "$(cat "$T"/*.out | grep -ciE 'deadlock|could not serialize')" = "0" ] && echo "PASS: Z · ninguna sesión reportó interbloqueo" || { echo "FAIL: Z · interbloqueos"; FAILED=1; }
# limpieza: lo sembrado aquí no debe quedar en el cluster compartido
"${P[@]}" -c "delete from public.customers where external_id like 'C4A-CARRERA-%'; delete from public.c4a_cuota where user_id in (select val from tests.ctx where key like 'c4a_%'); delete from public.c4a_excesos where user_id in (select val from tests.ctx where key like 'c4a_%'); delete from tests.ctx where key like 'c4a_%'" >/dev/null 2>&1
exit $FAILED
