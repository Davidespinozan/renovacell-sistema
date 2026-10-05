#!/usr/bin/env bash
# ============================================================================
# CC-0B · Concurrencia REAL del limitador: N sesiones simultáneas sobre el MISMO cubo.
# Lo que se demuestra: con límite L y N > L peticiones a la vez, exactamente L reciben
# allowed=true y el contador final es N (ninguna carrera "cuela" una de más ni pierde una).
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }

N=24; L=5; SCOPE="conc_$$"
# Todas las sesiones arrancan a la vez (barrera: pg_sleep hasta un instante común) y golpean el mismo cubo.
START=$("${P[@]}" -c "select extract(epoch from clock_timestamp()) + 1.0")
for i in $(seq 1 $N); do
  ("${P[@]}" -c "select tests.act_as_service(); select pg_sleep(greatest($START - extract(epoch from clock_timestamp()), 0)); select (public.rate_limit_hit('$SCOPE', 'ip:mismo', $L, 3600) ->> 'allowed')" > "$T/$i.out" 2>&1) &
done
wait
ALLOWED=$(cat "$T"/*.out | grep -c '^true$' || true)
DENIED=$(cat "$T"/*.out | grep -c '^false$' || true)
ERRS=$(cat "$T"/*.out | grep -ci 'error' || true)
[ "$ERRS" = "0" ] && echo "PASS: R · ninguna sesión falló ($N sesiones)" || { echo "FAIL: R · $ERRS errores: $(grep -ih error "$T"/*.out | head -2)"; FAILED=1; }
[ "$ALLOWED" = "$L" ] && echo "PASS: R · exactamente $L permitidas de $N simultáneas" || { echo "FAIL: R · permitidas=$ALLOWED (esperado $L)"; FAILED=1; }
[ "$DENIED" = "$((N - L))" ] && echo "PASS: R · $((N - L)) rechazadas" || { echo "FAIL: R · rechazadas=$DENIED"; FAILED=1; }
check "R · el contador final es exactamente $N (ni una perdida)" "select count = $N from public.rate_limit_buckets where scope = '$SCOPE' and subject = 'ip:mismo'"
check "R · un solo renglón por (scope, subject, ventana)" "select count(*) = 1 from public.rate_limit_buckets where scope = '$SCOPE'"

# Sujetos distintos en paralelo no se estorban.
for i in $(seq 1 10); do
  ("${P[@]}" -c "select tests.act_as_service(); select (public.rate_limit_hit('${SCOPE}_b', 'ip:$i', 1, 3600) ->> 'allowed')" > "$T/b$i.out" 2>&1) &
done
wait
OKB=$(cat "$T"/b*.out | grep -c '^true$' || true)
[ "$OKB" = "10" ] && echo "PASS: C · 10 sujetos distintos, 10 permitidos (sin cubo compartido indebido)" || { echo "FAIL: C · permitidos=$OKB"; FAILED=1; }

"${P[@]}" -c "delete from public.rate_limit_buckets where scope like '${SCOPE}%'" >/dev/null
exit $FAILED
