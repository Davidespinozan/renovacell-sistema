#!/usr/bin/env bash
# ============================================================================
# CC-1 · Concurrencia REAL de la identidad de visitante: las cardinalidades las sostiene la
# base, no el orden de llegada. Dos aperturas con el mismo token → un visitante; dos cuentas
# adoptando el mismo visitante a la vez → exactamente una gana; dos adopciones de la misma
# cuenta → un solo evento; first_touch concurrente → se fija una sola vez.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
HA=$(printf 'a%.0s' $(seq 1 64)); HB=$(printf 'b%.0s' $(seq 1 64)); HC=$(printf 'c%.0s' $(seq 1 64)); HD=$(printf 'd%.0s' $(seq 1 64))
SVC="select tests.act_as_service();"

# ── 1) Dos aperturas simultáneas con el MISMO token nuevo (mismo hash nuevo): un solo visitante.
for i in 1 2 3 4 5 6; do
  ("${P[@]}" -c "$SVC select public.cc_visitante_abrir(null, '$HA', '{\"utm_source\":\"s$i\"}'::jsonb, null) ->> 'nuevo'" > "$T/a$i.out" 2>&1) &
done
wait
OK=$(cat "$T"/a*.out | grep -c '^true$' || true); ERR=$(cat "$T"/a*.out | grep -ci 'error' || true)
[ "$OK" = "1" ] && echo "PASS: T · de 6 aperturas simultáneas con el mismo hash, exactamente 1 creó (las demás chocaron con la unicidad: $ERR errores, esperado)" || { echo "FAIL: T · creaciones=$OK"; FAILED=1; }
check "T · un solo visitante con ese hash" "select count(*) = 1 from public.cc_visitors where token_hash = '$HA'"
check "I · first_touch se fijó una sola vez (una fuente)" "select first_touch ? 'utm_source' and (select count(*) from public.cc_visitor_events e join public.cc_visitors v on v.id = e.visitor_id where v.token_hash = '$HA' and e.tipo = 'abierto') = 1 from public.cc_visitors where token_hash = '$HA'"

# ── 2) Reanudar en paralelo el MISMO visitante: visitas exactas, un solo renglón.
for i in 1 2 3 4 5 6 7 8; do
  ("${P[@]}" -c "$SVC select public.cc_visitante_abrir('$HA', '$HB', '{\"landing_path\":\"/p$i\"}'::jsonb, null) ->> 'nuevo'" > "$T/b$i.out" 2>&1) &
done
wait
REANUDADOS=$(cat "$T"/b*.out | grep -c '^false$' || true)
[ "$REANUDADOS" = "8" ] && echo "PASS: 8 reanudaciones simultáneas, ninguna creó" || { echo "FAIL: reanudaciones=$REANUDADOS"; FAILED=1; }
check "visitas = 1 + 8 (ninguna perdida)" "select visitas = 9 from public.cc_visitors where token_hash = '$HA'"
check "J · navegación directa concurrente no tocó last_touch" "select last_touch ->> 'utm_source' is not null and not (last_touch ? 'landing_path' and last_touch ->> 'landing_path' like '/p%') from public.cc_visitors where token_hash = '$HA'"

# ── 3) Dos CUENTAS distintas adoptan el mismo visitante a la vez: exactamente una gana.
"${P[@]}" -c "do \$\$ begin insert into tests.ctx values ('cc1_a', tests.user('doctor')), ('cc1_b', tests.user('doctor')); perform tests.act_as_service(); perform public.cc_visitante_abrir(null, '$HC', '{}'::jsonb, null); end \$\$;" >/dev/null
("${P[@]}" -c "$SVC select public.cc_visitante_adoptar('$HC', tests.id('cc1_a')) ->> 'estado'" > "$T/c1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_visitante_adoptar('$HC', tests.id('cc1_b')) ->> 'estado'" > "$T/c2.out" 2>&1) &
wait
GANA=$(cat "$T"/c1.out "$T"/c2.out | grep -c '^adoptado$' || true); PIERDE=$(cat "$T"/c1.out "$T"/c2.out | grep -c '^ajeno$\|SESION_INVALIDA' || true)
[ "$GANA" = "1" ] && [ "$PIERDE" = "1" ] && echo "PASS: G/T · dos cuentas a la vez: exactamente una adopta, la otra recibe conflicto" || { echo "FAIL: gana=$GANA pierde=$PIERDE: $(cat "$T"/c1.out "$T"/c2.out | tr '\n' ' ' | cut -c1-160)"; FAILED=1; }
check "T · un solo dueño y un solo evento adoptado" "select count(*) = 1 from public.cc_visitor_events e join public.cc_visitors v on v.id = e.visitor_id where v.estado = 'adoptado' and v.adopted_profile_id in (tests.id('cc1_a'), tests.id('cc1_b')) and e.tipo = 'adoptado'"

# ── 4) La MISMA cuenta adopta el mismo visitante dos veces a la vez: un solo evento.
"${P[@]}" -c "do \$\$ begin perform tests.act_as_service(); perform public.cc_visitante_abrir(null, '$HD', '{}'::jsonb, null); end \$\$;" >/dev/null
("${P[@]}" -c "$SVC select public.cc_visitante_adoptar('$HD', tests.id('cc1_a')) ->> 'estado'" > "$T/d1.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_visitante_adoptar('$HD', tests.id('cc1_a')) ->> 'estado'" > "$T/d2.out" 2>&1) &
wait
RES=$(cat "$T"/d1.out "$T"/d2.out | grep -cE '^(adoptado|ya_adoptado)$|SESION_INVALIDA' || true)
[ "$RES" = "2" ] && echo "PASS: B/T · misma cuenta dos veces: adoptado + (ya_adoptado o sesión rotada), sin error inesperado" || { echo "FAIL: $(cat "$T"/d1.out "$T"/d2.out | tr '\n' ' ' | cut -c1-160)"; FAILED=1; }
check "T · cardinalidad final: la cuenta A tiene exactamente los visitantes que ganó (≤ 2) y cada visitante un dueño" "select count(*) <= 2 and count(*) = count(distinct id) from public.cc_visitors where adopted_profile_id = tests.id('cc1_a')"

"${P[@]}" -c "select set_config('app.cc_purga','on',true); delete from public.cc_visitors where token_hash in ('$HA','$HB','$HC','$HD') or adopted_profile_id in (tests.id('cc1_a'), tests.id('cc1_b')); delete from tests.ctx where key like 'cc1_%'" >/dev/null
exit $FAILED
