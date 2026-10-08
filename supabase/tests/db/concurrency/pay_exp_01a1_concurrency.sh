#!/usr/bin/env bash
# ============================================================================
# PAY-EXP-01A-1 (133) · Concurrencia REAL (sesiones psql independientes en paralelo, timeouts controlados).
#   A. 5 revisores verifican la MISMA declaración a la vez → UN asiento; los demás "already_verified".
#   B. la MISMA operación (op_id) 5 veces a la vez → UN asiento.
#   C. verificación vs cancelación del mismo pedido → sin deadlock; declaración verificada, UN asiento, cancelado.
#   D. declaración vs cancelación → nunca una declaración nueva sobre un pedido ya cancelado; señal coherente.
#   E. cobro vs cancelación → serializados; el dinero SIEMPRE se registra (F-9) y la señal es coherente.
#   F. DEADLOCK: una sesión que bloquea pedido → declaración (como lo hará un comando futuro) contra revisar_pago.
#      Con el revisar_pago VIEJO (declaración → pedido) hay deadlock; con el NUEVO (pedido → declaración), no.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
HERE="$(cd "$(dirname "$0")" && pwd)"
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
noerr() { if grep -qiE 'ERROR|deadlock' "$@"; then echo "FAIL: con error: $(cat "$@" | tr '\n' ' ' | cut -c1-200)"; FAILED=1; return 1; fi; return 0; }
TO="set lock_timeout = '15s'; set statement_timeout = '30s';"
as() { echo "$TO select tests.act_as(tests.id('$1'));"; }

"${P[@]}" -c "do \$\$ declare dr uuid := tests.user('doctor'); ad uuid := tests.user('admin'); bi uuid := tests.user('billing'); p uuid := tests.product(); o uuid; c uuid; i int; begin
  delete from tests.ctx where key like 'p1a1_%';
  perform tests.stock(p, 'P1A1-C', 500);
  insert into tests.ctx values ('p1a1_doc', dr), ('p1a1_adm', ad), ('p1a1_bil', bi);
  -- pedidos con declaración abierta: A, B, C1..C4, F_viejo, F_nuevo
  for i in 1..8 loop
    o := tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));   -- 100
    perform tests.act_as(dr);
    c := (public.reportar_pago(gen_random_uuid(), o, 'transferencia', 100, 'C' || i) ->> 'claim_id')::uuid;
    perform tests.act_as_service();
    insert into tests.ctx values ('p1a1_o' || i, o), ('p1a1_c' || i, c);
  end loop;
  -- pedidos sin declaración: D1..D6 y E1..E6
  for i in 1..6 loop
    insert into tests.ctx values ('p1a1_d' || i, tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)))),
                                 ('p1a1_e' || i, tests.order(dr, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1))));
  end loop;
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-200)"; exit 1; }

# ── A) 5 revisores, misma declaración, op_id distintos
for i in 1 2 3 4 5; do ("${P[@]}" -c "$(as p1a1_bil) select public.revisar_pago(gen_random_uuid(), tests.id('p1a1_c1'), 'verificar') ->> 'status'" > "$T/a$i.out" 2>&1) & done; wait
noerr "$T"/a*.out && echo "PASS: A · 5 revisores concurrentes sin error ni deadlock"
check "A · UN solo asiento por la declaración" "select count(*) = 1 from public.payment_entries where claim_id = tests.id('p1a1_c1')"
check "A · exactamente un 'applied' y cuatro 'already_verified'" "select $(grep -h -c '^applied$' "$T"/a*.out | paste -sd+ - | bc) = 1 and $(grep -h -c '^already_verified$' "$T"/a*.out | paste -sd+ - | bc) = 4"

# ── B) mismo op_id 5 veces a la vez
OPB=$(uuidgen | tr 'A-Z' 'a-z')
for i in 1 2 3 4 5; do ("${P[@]}" -c "$(as p1a1_bil) select public.revisar_pago('$OPB', tests.id('p1a1_c2'), 'verificar') ->> 'status'" > "$T/b$i.out" 2>&1) & done; wait
noerr "$T"/b*.out && echo "PASS: B · mismo op_id ×5 sin error"
check "B · UN asiento" "select count(*) = 1 from public.payment_entries where claim_id = tests.id('p1a1_c2')"

# ── C) verificación vs cancelación (4 pedidos, ambos órdenes de llegada posibles)
for k in 3 4 5 6; do
  ("${P[@]}" -c "$(as p1a1_bil) select public.revisar_pago(gen_random_uuid(), tests.id('p1a1_c$k'), 'verificar') ->> 'status'" > "$T/cv$k.out" 2>&1) &
  ("${P[@]}" -c "$(as p1a1_adm) select public.cancelar_pedido(gen_random_uuid(), tests.id('p1a1_o$k'), 'prueba de concurrencia') ->> 'money_signal'" > "$T/cc$k.out" 2>&1) &
done; wait
noerr "$T"/cv*.out "$T"/cc*.out && echo "PASS: C · verificación ∥ cancelación sin error ni deadlock"
check "C · cada declaración verificada con UN asiento y su pedido cancelado" "select bool_and(c.status = 'verificado' and (select count(*) from public.payment_entries e where e.claim_id = c.id) = 1 and o.status = 'cancelled') from public.payment_claims c join public.orders o on o.id = c.order_id where c.id in (tests.id('p1a1_c3'), tests.id('p1a1_c4'), tests.id('p1a1_c5'), tests.id('p1a1_c6'))"
check "C · señal coherente con el orden real (declaración en revisión o pago ya registrado)" "select bool_and(x.money_signal in ('pago_reportado_en_revision', 'pago_registrado')) from public.order_cancellations x where x.order_id in (tests.id('p1a1_o3'), tests.id('p1a1_o4'), tests.id('p1a1_o5'), tests.id('p1a1_o6'))"

# ── D) declaración vs cancelación (6 pedidos)
for k in 1 2 3 4 5 6; do
  ("${P[@]}" -c "$(as p1a1_doc) select public.reportar_pago(gen_random_uuid(), tests.id('p1a1_d$k'), 'transferencia', 100, 'D$k') ->> 'status'" > "$T/dr$k.out" 2>&1) &
  ("${P[@]}" -c "$(as p1a1_adm) select public.cancelar_pedido(gen_random_uuid(), tests.id('p1a1_d$k'), 'prueba de concurrencia') ->> 'money_signal'" > "$T/dc$k.out" 2>&1) &
done; wait
if grep -hiE 'ERROR' "$T"/dr*.out "$T"/dc*.out | grep -viE 'PEDIDO_CANCELADO' | grep -q .; then echo "FAIL: D · error inesperado: $(cat "$T"/d*.out | tr '\n' ' ' | cut -c1-200)"; FAILED=1; else echo "PASS: D · solo el rechazo esperado (PEDIDO_CANCELADO), sin deadlock"; fi
check "D · hay declaración ⇔ la cancelación vio la declaración (nunca una declaración nueva sobre un cancelado)" "select bool_and(exists (select 1 from public.payment_claims c where c.order_id = x.order_id) = (x.money_signal is not distinct from 'pago_reportado_en_revision')) from public.order_cancellations x where x.order_id in (select tests.id('p1a1_d' || g) from generate_series(1, 6) g)"

# ── E) cobro vs cancelación (6 pedidos)
for k in 1 2 3 4 5 6; do
  ("${P[@]}" -c "$(as p1a1_adm) select public.registrar_cobro(gen_random_uuid(), tests.id('p1a1_e$k'), 'efectivo', 100) ->> 'sobre_pedido_cancelado'" > "$T/ep$k.out" 2>&1) &
  ("${P[@]}" -c "$(as p1a1_adm) select public.cancelar_pedido(gen_random_uuid(), tests.id('p1a1_e$k'), 'prueba de concurrencia') ->> 'money_signal'" > "$T/ec$k.out" 2>&1) &
done; wait
noerr "$T"/ep*.out "$T"/ec*.out && echo "PASS: E · cobro ∥ cancelación sin error ni deadlock"
check "E · el dinero SIEMPRE quedó en el libro (F-9) y el pedido cancelado" "select bool_and((select count(*) from public.payment_entries e where e.order_id = o.id) = 1 and o.status = 'cancelled') from public.orders o where o.id in (select tests.id('p1a1_e' || g) from generate_series(1, 6) g)"
SOBRE=$(grep -h -c '^true$' "$T"/ep*.out | paste -sd+ - | bc); SENAL=$(grep -h -c '^pago_registrado$' "$T"/ec*.out | paste -sd+ - | bc)
if [ $((SOBRE + SENAL)) -eq 6 ]; then echo "PASS: E · coherente: $SENAL cobros antes de cancelar (señal pago_registrado) + $SOBRE después (sobre_pedido_cancelado)"; else echo "FAIL: E · incoherente: sobre=$SOBRE señal=$SENAL"; FAILED=1; fi

# ── F) DEADLOCK: sesión X bloquea pedido → (espera) → declaración; sesión Y revisa la misma declaración
"${P[@]}" -c "$(sed -e '/^drop index/d' -e 's/create or replace function public.revisar_pago(/create or replace function tests.revisar_pago_viejo(/' "$HERE/../../../rollback/pay_exp_01a1/99_down.sql") grant execute on function tests.revisar_pago_viejo(uuid, uuid, text, numeric, date, text) to authenticated;" > "$T/viejo.out" 2>&1 || { echo "FAIL: F · no se pudo crear la copia del revisar_pago viejo: $(cat "$T/viejo.out" | cut -c1-200)"; FAILED=1; }
f_run() {   # $1 = función (public.revisar_pago | tests.revisar_pago_viejo), $2 = sufijo de pedido/declaración, $3 = etiqueta
  ("${P[@]}" -c "begin; $TO select 1 from public.orders where id = tests.id('p1a1_o$2') for update; select pg_sleep(1.5); select 1 from public.payment_claims where id = tests.id('p1a1_c$2') for update; commit;" > "$T/fx_$3.out" 2>&1) &
  sleep 0.4
  ("${P[@]}" -c "$(as p1a1_bil) select $1(gen_random_uuid(), tests.id('p1a1_c$2'), 'verificar') ->> 'status'" > "$T/fy_$3.out" 2>&1) &
  wait
}
f_run tests.revisar_pago_viejo 7 viejo
if grep -qi 'deadlock detected' "$T/fx_viejo.out" "$T/fy_viejo.out"; then echo "PASS: F · control: el revisar_pago VIEJO (declaración → pedido) SÍ produce deadlock"; else echo "FAIL: F · control: se esperaba deadlock con el orden viejo: $(cat "$T"/f*_viejo.out | tr '\n' ' ' | cut -c1-200)"; FAILED=1; fi
f_run public.revisar_pago 8 nuevo
if grep -qiE 'deadlock|ERROR' "$T/fx_nuevo.out" "$T/fy_nuevo.out"; then echo "FAIL: F · el revisar_pago NUEVO falló: $(cat "$T"/f*_nuevo.out | tr '\n' ' ' | cut -c1-200)"; FAILED=1; else echo "PASS: F · el revisar_pago NUEVO (pedido → declaración) NO produce deadlock: espera y completa"; fi
check "F · la declaración del caso nuevo quedó verificada con UN asiento" "select status = 'verificado' and (select count(*) from public.payment_entries where claim_id = c.id) = 1 from public.payment_claims c where c.id = tests.id('p1a1_c8')"
"${P[@]}" -c "drop function if exists tests.revisar_pago_viejo(uuid, uuid, text, numeric, date, text);" >/dev/null 2>&1

exit $FAILED
