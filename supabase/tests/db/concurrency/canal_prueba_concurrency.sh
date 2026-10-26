#!/usr/bin/env bash
# ============================================================================
# R4-C5-A2 · Concurrencia REAL del modo prueba por contacto (intercalaciones DETERMINISTAS con transacciones sostenidas):
#   A. el último chequeo antes del POST (puede_enviar) sostiene su candado; una revocación llega después → ESPERA a que
#      termine; esa verificación ya dijo "sí" (límite: ese POST puede salir), pero toda verificación posterior dice "no".
#   B. un reclamo sostenido y una revocación detrás: la fila reclamada ya no pasa el último chequeo y, resuelta como
#      'retener', queda retenida (no se pierde ni sale).
#   C. dos reclamos simultáneos: cada salida se reclama UNA vez.
#   D. dos autorizaciones simultáneas del mismo contacto: queda UN permiso vigente.
# Deja WhatsApp en espejo, sin IA, sin pausa y sin permisos vigentes.
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"; "${P[@]}" -c "update public.cc_wa_config set modo = '"'"'espejo'"'"', ia_habilitada = false, envio_pausado = false where id; alter table public.cc_wa_config enable trigger trg_cc_wa_config_guardia" >/dev/null 2>&1' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1 | tail -1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
SVC="select tests.act_as_service();"
q() { "${P[@]}" -c "$1" | tail -1; }

ADM=$(q "select tests.fixture_admin()")
CA=$(q "$SVC select public.cc_wa_entrante('5216670009101', 'Conc', 'wamid.C5C.A0', 'hola', false) ->> 'conversation_id'")
CD=$(q "$SVC select public.cc_wa_entrante('5216670009102', 'Conc2', 'wamid.C5C.D0', 'hola', false) ->> 'conversation_id'")
q "select tests.act_as('$ADM'); select public.cc_canal_prueba_autorizar('$CA', 60, 'Concurrencia A') ->> 'contacto'" >/dev/null
q "select tests.act_as('$ADM'); select public.cc_canal_cambiar('whatsapp', '{\"modo\":\"prueba\"}', 'Concurrencia R4-C5') ->> 'cambiado'" >/dev/null
nueva() { q "$SVC select (public.cc_enviar_mensaje('$CA', 'system', null, null, 'sys:solicitud:c5c$1', 'aviso $1') ->> 'id')"; }

# A) puede_enviar sostenido vs revocación
M1=$(nueva 1); q "$SVC select count(*) from public.cc_wa_salida_reclamar(20)" >/dev/null
S1=$(q "select id from public.cc_wa_salida where message_id = '$M1'")
("${P[@]}" -c "begin; $SVC select public.cc_wa_salida_puede_enviar('$S1'); select pg_sleep(1.2); select 'fin_chequeo=' || extract(epoch from clock_timestamp()); commit;" > "$T/a1.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "select tests.act_as('$ADM'); select public.cc_canal_prueba_revocar('$CA', 'Revocación concurrente') ->> 'revocados'; select 'fin_revocar=' || extract(epoch from clock_timestamp());" > "$T/a2.out" 2>&1) & wait
FC=$(grep -oE 'fin_chequeo=[0-9.]+' "$T/a1.out" | cut -d= -f2); FR=$(grep -oE 'fin_revocar=[0-9.]+' "$T/a2.out" | cut -d= -f2)
check "A · el chequeo sostenido había dicho que sí (antes de revocar)" "select $(grep -c '^t$' "$T/a1.out") = 1"
check "A · la revocación ESPERÓ a que terminara el chequeo" "select ${FR:-0} >= ${FC:-9e18}"
check "A · después de revocar, el mismo envío ya no pasa el último chequeo" "$SVC select not public.cc_wa_salida_puede_enviar('$S1')"

# B) reclamo sostenido vs revocación (nuevo permiso)
q "select tests.act_as('$ADM'); select public.cc_canal_prueba_autorizar('$CA', 60, 'Concurrencia B') ->> 'contacto'" >/dev/null
M2=$(nueva 2)
("${P[@]}" -c "begin; $SVC select count(*) from public.cc_wa_salida_reclamar(20); select pg_sleep(1.2); commit;" > "$T/b1.out" 2>&1) &
sleep 0.4; ("${P[@]}" -c "select tests.act_as('$ADM'); select public.cc_canal_prueba_revocar('$CA', 'Revocación tras reclamo') ->> 'revocados'" > "$T/b2.out" 2>&1) & wait
S2=$(q "select id from public.cc_wa_salida where message_id = '$M2'")
check "B · la fila quedó reclamada (enviando) antes de la revocación" "select estado = 'enviando' from public.cc_wa_salida where id = '$S2'"
check "B · y no pasa el último chequeo" "$SVC select not public.cc_wa_salida_puede_enviar('$S2')"
q "$SVC select public.cc_wa_salida_resolver('$S2', false, null, 'retener|permiso revocado antes del envío')" >/dev/null
check "B · resuelta como retener: retenida (ni sale ni se pierde)" "select estado = 'retenido' from public.cc_wa_salida where id = '$S2'"

# C) dos reclamos simultáneos
q "select tests.act_as('$ADM'); select public.cc_canal_prueba_autorizar('$CA', 60, 'Concurrencia C') ->> 'contacto'" >/dev/null
for i in 3 4 5 6; do nueva $i >/dev/null; done
("${P[@]}" -c "$SVC select count(*) from public.cc_wa_salida_reclamar(20)" > "$T/c1.out" 2>&1) & ("${P[@]}" -c "$SVC select count(*) from public.cc_wa_salida_reclamar(20)" > "$T/c2.out" 2>&1) & wait
check "C · entre los dos reclamos, 4 filas exactamente una vez" "select $(tail -1 "$T/c1.out") + $(tail -1 "$T/c2.out") = 4 and (select count(*) from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id in ('sys:solicitud:c5c3', 'sys:solicitud:c5c4', 'sys:solicitud:c5c5', 'sys:solicitud:c5c6') and s.estado = 'enviando' and s.intentos = 1) = 4"

# D) dos autorizaciones simultáneas del mismo contacto
("${P[@]}" -c "select tests.act_as('$ADM'); select pg_sleep(0.1); select public.cc_canal_prueba_autorizar('$CD', 60, 'Concurrencia D1') ->> 'contacto'" > "$T/d1.out" 2>&1) &
("${P[@]}" -c "select tests.act_as('$ADM'); select pg_sleep(0.1); select public.cc_canal_prueba_autorizar('$CD', 60, 'Concurrencia D2') ->> 'contacto'" > "$T/d2.out" 2>&1) & wait
check "D · un solo permiso vigente para el contacto" "select count(*) = 1 from public.cc_canal_prueba where contacto = '5216670009102' and revocado_at is null"
check "D · la otra autorización fue rechazada" "select $(cat "$T"/d1.out "$T"/d2.out | grep -cE 'PRUEBA_YA_AUTORIZADA|uq_ccp_vigente') = 1"

# cierre: volver a espejo revoca lo vigente
q "select tests.act_as('$ADM'); select public.cc_canal_cambiar('whatsapp', '{\"modo\":\"espejo\"}', 'Fin concurrencia') ->> 'cambiado'" >/dev/null
check "cierre · espejo y sin permisos vigentes" "select (select modo = 'espejo' from public.cc_wa_config) and not exists (select 1 from public.cc_canal_prueba where revocado_at is null)"
exit $FAILED
