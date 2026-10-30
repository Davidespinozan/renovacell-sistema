-- PUSH DEL EQUIPO (20270220) · mensajes del Chat del equipo y Avisos del equipo avisan al dispositivo de quien debe verlos:
-- directo → el otro; grupo → quien puede leerlo; aviso → su área o todo el equipo. Nunca a quien escribió ni a doctores.
-- El trigger solo despierta a la Edge si alguien tiene avisos activados, y nunca impide guardar el mensaje.
begin;
do $t$
declare
  a1 uuid := tests.user('admin'); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); w1 uuid := tests.user('warehouse');
  k1 uuid := tests.user('packing'); d1 uuid := tests.user('doctor'); dm uuid; gv uuid; ga uuid; m uuid; av uuid; r jsonb; p uuid[]; n0 bigint; n1 bigint;
begin
  perform tests.act_as_owner();
  update public.profiles set full_name = 'Roberto Ibarra' where id = s1;
  insert into public.conversations (kind, title, member_ids) values ('dm', 'Roberto', array[s1, s2]) returning id into dm;
  insert into public.conversations (kind, title, area, member_ids) values ('group', 'Ventas', 'pos', '{}') returning id into gv;
  insert into public.conversations (kind, title, area, member_ids) values ('group', 'Almacén', 'warehouse', '{}') returning id into ga;

  -- ══ 1 · a quién ══
  perform tests.eq(public._equipo_destinatarios(dm, s1), array[s2], '1 · directo: solo el otro');
  p := public._equipo_destinatarios(gv, s1);
  perform tests.ok(s2 = any (p) and a1 = any (p) and not s1 = any (p) and not w1 = any (p) and not d1 = any (p), '1 · grupo de Ventas: ventas y Dirección, sin quien escribe ni otras áreas');
  p := public._equipo_destinatarios(ga, w1);
  perform tests.ok(k1 = any (p) and not s1 = any (p), '1 · grupo de Almacén incluye a empaque');

  -- ══ 2 · qué dice ══
  insert into public.messages (conversation_id, sender_id, sender_name, body) values (dm, s1, 'Roberto Ibarra · Ventas', 'Oye, ¿ya salió   el pedido de la Dra. Ruiz?') returning id into m;
  perform tests.act_as_service();
  r := public.equipo_push_carga('mensaje', m);
  perform tests.ok(r ->> 'title' = 'Roberto Ibarra' and r ->> 'body' = 'Oye, ¿ya salió el pedido de la Dra. Ruiz?' and r ->> 'url' = '/sistema?abrir=chat&conv=' || dm and r -> 'perfiles' = to_jsonb(array[s2]), '2 · directo: su nombre, el texto y el enlace a ese chat');
  perform tests.act_as_owner();
  insert into public.messages (conversation_id, sender_id, sender_name, body) values (gv, s1, 'Roberto Ibarra', repeat('x', 200)) returning id into m;
  perform tests.act_as_service();
  r := public.equipo_push_carga('mensaje', m);
  perform tests.ok(r ->> 'title' = 'Ventas' and r ->> 'body' like 'Roberto Ibarra: xxx%…' and length(r ->> 'body') < 130, '2 · grupo: título del grupo y "Nombre: adelanto" recortado');
  perform tests.act_as_owner();
  insert into public.announcements (title, body, created_by, metadata) values ('Inventario el sábado', 'Llegan a las 9', a1, '{"kind":"aviso","audience":"warehouse","author":"David"}') returning id into av;
  perform tests.act_as_service();
  r := public.equipo_push_carga('aviso', av);
  perform tests.ok(r ->> 'title' = 'Nuevo aviso · David' and r ->> 'body' = 'Inventario el sábado — Llegan a las 9' and r ->> 'url' = '/sistema?abrir=avisos', '2 · aviso: tipo, autor y título');
  perform tests.ok(w1 = any (array(select jsonb_array_elements_text(r -> 'perfiles'))::uuid[]) and k1 = any (array(select jsonb_array_elements_text(r -> 'perfiles'))::uuid[])
    and not s1 = any (array(select jsonb_array_elements_text(r -> 'perfiles'))::uuid[]) and not a1 = any (array(select jsonb_array_elements_text(r -> 'perfiles'))::uuid[]), '2 · aviso para Almacén: almacén y empaque, no ventas ni quien lo publicó');
  perform tests.act_as_owner();
  insert into public.announcements (title, body, created_by, metadata) values ('Junta', 'Lunes', a1, '{"kind":"anuncio","audience":null}') returning id into av;
  p := public._equipo_destinatarios_aviso(av);
  perform tests.ok(s1 = any (p) and w1 = any (p) and not d1 = any (p) and not a1 = any (p), '2 · sin área: todo el equipo, sin doctores');

  -- ══ 3 · el trigger despierta a la Edge solo si alguien tiene avisos, y nunca impide guardar ══
  select count(*) into n0 from net._llamadas;
  insert into public.messages (conversation_id, sender_id, sender_name, body) values (dm, s1, 'Roberto', 'sin avisos activos');
  select count(*) into n1 from net._llamadas;
  perform tests.eq(n1, n0, '3 · nadie con avisos: no se llama a la Edge');
  perform tests.act_as_service();
  perform public.push_suscribir(s2, null, 'https://push.example/equipo', repeat('k', 87), repeat('s', 22));
  perform tests.act_as_owner();
  insert into vault.decrypted_secrets (name, decrypted_secret) values ('project_url', 'http://127.0.0.1:54321'), ('comm_cron_secret', repeat('c', 40))
    on conflict (name) do nothing;
  insert into public.messages (conversation_id, sender_id, sender_name, body) values (dm, s1, 'Roberto', 'con avisos');
  perform tests.ok(exists (select 1 from net._llamadas where url like '%/functions/v1/push' and body ->> 'action' = 'equipo' and body ->> 'tipo' = 'mensaje' and headers ? 'x-cron-secret'), '3 · con avisos: despierta a la Edge push con el secreto');
  perform tests.act_as(s1);
  insert into public.messages (conversation_id, sender_id, sender_name, body) values (dm, s1, 'Roberto', 'desde la sesión del vendedor');
  perform tests.ok(true, '3 · un vendedor escribe normal con el trigger puesto');

  -- ══ 4 · permisos ══
  perform tests.throws(format('select public.equipo_push_carga(%L, %L)', 'mensaje', m), 'permission denied', '4 · la carga solo la pide el servidor');
  perform tests.throws(format('select public._equipo_destinatarios(%L, null)', dm), 'permission denied', '4 · ni se consulta a quién');
end $t$;
rollback;

-- PUSH SIEMPRE (20270221) · Dirección ve quién tiene avisos y en cuántos dispositivos; nadie más.
begin;
do $t$
declare a1 uuid := tests.user('admin'); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); r jsonb;
begin
  perform tests.act_as_service();
  perform public.push_suscribir(s1, null, 'https://push.example/s1a', repeat('k', 87), repeat('s', 22));
  perform public.push_suscribir(s1, null, 'https://push.example/s1b', repeat('k', 87), repeat('s', 22));
  perform tests.act_as(a1);
  r := public.push_estado_cuentas();
  perform tests.ok((r -> s1::text ->> 'dispositivos')::int = 2 and r -> s2::text is null and not (r -> s1::text) ? 'endpoint', '5 · Dirección: 2 dispositivos de uno, nada del otro, sin direcciones');
  perform tests.act_as(s1);
  perform tests.throws('select public.push_estado_cuentas()', 'NO_AUTORIZADO', '5 · un vendedor no lo ve');
end $t$;
rollback;
