#!/usr/bin/env bash
# ============================================================================
# CHV2-A · Concurrencia REAL de la reasignación de handler (sesiones paralelas).
#   M1. Dirección reasigna la MISMA solicitud a s2 y a s3 a la vez → sin error/deadlock; handler final único
#       (uno de los dos); UNA alerta por asignación efectiva; la cartera NO cambia.
#   M2. Dirección reasigna dos veces a la vez al MISMO vendedor → UNA asignación, UNA alerta, UN evento.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
noerr() { if grep -qiE 'ERROR|deadlock' "$@"; then echo "FAIL: $(basename "$1") con error: $(cat "$@" | tr '\n' ' ' | cut -c1-180)"; FAILED=1; return 1; fi; return 0; }
ADM="select tests.act_as(tests.id('chv2_adm'));"

"${P[@]}" -c "do \$\$ declare dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); s3 uuid := tests.user('pos'); pA uuid; sem jsonb; kA uuid; kB uuid; r jsonb; begin
  delete from tests.ctx where key like 'chv2_%';
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{\"capabilities\":[\"conversaciones\",\"nuevos_clientes\"]}' where id in (s1, s2, s3);
  perform tests.cliente(dA); perform tests.cliente(dB);
  pA := tests.producto_cat('Rellenos', 1000); perform tests.stock(pA, 'V2C-A', 100);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1), (dB, s1);
  perform tests.act_as(tests.fixture_admin());
  sem := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar('America/Mazatlan', sem);
  perform tests.act_as_service();
  kA := (public.cc_carrito_abrir('doctor', null, dA) ->> 'cart_id')::uuid; r := public.cc_carrito_agregar(kA, 'doctor', null, dA, pA, 1, 'ca-1');
  kB := (public.cc_carrito_abrir('doctor', null, dB) ->> 'cart_id')::uuid; r := public.cc_carrito_agregar(kB, 'doctor', null, dB, pA, 1, 'cb-1');
  insert into tests.ctx values ('chv2_adm', tests.fixture_admin()), ('chv2_s1', s1), ('chv2_s2', s2), ('chv2_s3', s3), ('chv2_dA', dA),
    ('chv2_cA', (select id from public.cc_conversations where profile_id = dA and estado = 'abierta')), ('chv2_cB', (select id from public.cc_conversations where profile_id = dB and estado = 'abierta'));
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-200)"; exit 1; }

# ── M1) dos destinos distintos a la vez
("${P[@]}" -c "$ADM select public.cc_solicitud_reasignar(tests.id('chv2_cA'), tests.id('chv2_s2'), 'M1 a Carlos') ->> 'seller'" > "$T/m1a.out" 2>&1) &
("${P[@]}" -c "$ADM select public.cc_solicitud_reasignar(tests.id('chv2_cA'), tests.id('chv2_s3'), 'M1 a Pedro') ->> 'seller'" > "$T/m1b.out" 2>&1) &
wait
noerr "$T/m1a.out" "$T/m1b.out"
check "M1 · handler final único (s2 o s3)" "select (select seller_profile_id from public.cc_conversations where id = tests.id('chv2_cA')) in (tests.id('chv2_s2'), tests.id('chv2_s3'))"
check "M1 · exactamente un asesor participando" "select count(*) = 1 from public.cc_participants where conversation_id = tests.id('chv2_cA') and rol = 'asesor' and left_at is null"
check "M1 · una alerta por asignación efectiva (2 reasignaciones + 1 inicial = 3)" "select count(*) = 3 from public.notifications where conversation_id = tests.id('chv2_cA') and kind = 'handoff_asignado'"
check "M1 · la alerta del ganador existe UNA vez" "select count(*) = 1 from public.notifications n where n.conversation_id = tests.id('chv2_cA') and n.kind = 'handoff_asignado' and n.user_ids = array[(select seller_profile_id from public.cc_conversations where id = tests.id('chv2_cA'))]"
check "M1 · la cartera sigue siendo s1" "select seller_profile_id = tests.id('chv2_s1') from public.cc_cartera where profile_id = tests.id('chv2_dA')"
check "M1 · modo asignado (no activo) y IA disponible" "select modo = 'human_assigned' and public._cc_ia_puede(modo) from public.cc_conversations where id = tests.id('chv2_cA')"

# ── M2) el mismo destino dos veces a la vez
("${P[@]}" -c "$ADM select public.cc_solicitud_reasignar(tests.id('chv2_cB'), tests.id('chv2_s2'), 'M2 a Carlos') ->> 'seller'" > "$T/m2a.out" 2>&1) &
("${P[@]}" -c "$ADM select public.cc_solicitud_reasignar(tests.id('chv2_cB'), tests.id('chv2_s2'), 'M2 a Carlos') ->> 'seller'" > "$T/m2b.out" 2>&1) &
wait
noerr "$T/m2a.out" "$T/m2b.out"
check "M2 · handler s2" "select seller_profile_id = tests.id('chv2_s2') from public.cc_conversations where id = tests.id('chv2_cB')"
check "M2 · UNA alerta a s2" "select count(*) = 1 from public.notifications where conversation_id = tests.id('chv2_cB') and kind = 'handoff_asignado' and user_ids = array[tests.id('chv2_s2')]"
check "M2 · UN evento de reasignación a s2" "select count(*) = 1 from public.cc_conversation_events where conversation_id = tests.id('chv2_cB') and tipo = 'human_assigned' and (detalle ->> 'seller')::uuid = tests.id('chv2_s2')"

exit $FAILED
