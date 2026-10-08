#!/usr/bin/env bash
# ============================================================================
# CHAT V2-D1 · Concurrencia REAL del saludo: dos señales fuertes simultáneas sin episodio → UN episodio y UN
# saludo; tras cerrar el episodio, dos señales simultáneas → UN saludo nuevo (2 en total).
# ============================================================================
set -uo pipefail
P=("${PSQL_BIN:-psql}" -X -q -At)
T="$(mktemp -d)"; FAILED=0
trap 'rm -rf "$T"' EXIT
check() { local r; r=$("${P[@]}" -c "$2" 2>&1); if [ "$r" = "t" ]; then echo "PASS: $1"; else echo "FAIL: $1 (obtenido: $r)"; FAILED=1; fi; }
noerr() { if grep -qiE 'ERROR|deadlock' "$@"; then echo "FAIL: $(basename "$1") con error: $(cat "$@" | tr '\n' ' ' | cut -c1-180)"; FAILED=1; return 1; fi; return 0; }
SVC="select tests.act_as_service();"
"${P[@]}" -c "do \$\$ declare d uuid := tests.user('doctor'); s uuid := tests.user('pos'); pa uuid; pb uuid; k uuid; begin
  delete from tests.ctx where key like 'd1c_%';
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{\"capabilities\":[\"conversaciones\"]}' where id = s;
  perform tests.cliente(d); insert into public.cc_cartera (profile_id, seller_profile_id) values (d, s);
  pa := tests.producto_cat('Rellenos', 1000); pb := tests.producto_cat('Rellenos', 500);
  perform tests.stock(pa, 'D1C-A', 100); perform tests.stock(pb, 'D1C-B', 100);
  k := (public.cc_carrito_abrir('doctor', null, d) ->> 'cart_id')::uuid;
  insert into tests.ctx values ('d1c_d', d), ('d1c_s', s), ('d1c_pa', pa), ('d1c_pb', pb), ('d1c_k', k);
end \$\$;" > "$T/prep.out" 2>&1 || { echo "FAIL: preparación: $(tr '\n' ' ' < "$T/prep.out" | cut -c1-200)"; exit 1; }
C="(select id from public.cc_conversations where profile_id = tests.id('d1c_d') and estado = 'abierta')"
("${P[@]}" -c "$SVC select public.cc_carrito_agregar(tests.id('d1c_k'), 'doctor', null, tests.id('d1c_d'), tests.id('d1c_pa'), 1, 'c-a') ->> 'rev'" > "$T/a.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_carrito_agregar(tests.id('d1c_k'), 'doctor', null, tests.id('d1c_d'), tests.id('d1c_pb'), 1, 'c-b') ->> 'rev'" > "$T/b.out" 2>&1) &
wait; noerr "$T/a.out" "$T/b.out"
check "D1 · dos señales simultáneas → UN saludo" "select count(*) = 1 from public.cc_messages where conversation_id = $C and client_message_id like 'tpl:saludo:%'"
check "D1 · un solo aviso de episodio" "select count(*) = 1 from public.cc_messages where conversation_id = $C and client_message_id like 'sys:handoff:%'"
"${P[@]}" -c "$SVC select public.cc_iniciar_asesoria($C, tests.id('d1c_s')); select public.cc_terminar_asesoria($C, tests.id('d1c_s'));" > "$T/c.out" 2>&1; noerr "$T/c.out"
("${P[@]}" -c "$SVC select public.cc_carrito_actualizar(tests.id('d1c_k'), 'doctor', null, tests.id('d1c_d'), tests.id('d1c_pa'), 2, 'c-c') ->> 'rev'" > "$T/d.out" 2>&1) &
("${P[@]}" -c "$SVC select public.cc_carrito_actualizar(tests.id('d1c_k'), 'doctor', null, tests.id('d1c_d'), tests.id('d1c_pb'), 2, 'c-d') ->> 'rev'" > "$T/e.out" 2>&1) &
wait; noerr "$T/d.out" "$T/e.out"
check "D1 · episodio nuevo con señales simultáneas → UN saludo nuevo (2 en total)" "select count(*) = 2 from public.cc_messages where conversation_id = $C and client_message_id like 'tpl:saludo:%'"
check "D1 · seq contiguo sin colisiones" "select count(*) = max(seq) and count(distinct seq) = count(*) from public.cc_messages where conversation_id = $C"
exit $FAILED
