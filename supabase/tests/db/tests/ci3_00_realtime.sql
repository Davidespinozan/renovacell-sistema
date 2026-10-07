-- Commercial Intent · CI-3 (129) · cc_messages publicada en supabase_realtime SIN ampliar permisos. Realtime
-- (Postgres Changes) aplica el RLS de la tabla con el JWT del suscriptor: estas pruebas fijan exactamente qué
-- filas puede recibir cada identidad (dueño, vendedor actual, otro vendedor, otro doctor, Dirección, anon).
begin;
do $t$
declare
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); wh uuid := tests.user('warehouse');
  v_admin uuid := tests.fixture_admin(); c1 uuid; c2 uuid; n int;
begin
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cc_messages'), 'CI3 · cc_messages está en supabase_realtime');
  perform tests.ok(not (select puballtables from pg_publication where pubname = 'supabase_realtime'), 'CI3 · la publicación NO es FOR ALL TABLES');
  perform tests.ok((select relrowsecurity from pg_class where oid = 'public.cc_messages'::regclass), 'CI3 · RLS activo en cc_messages');
  perform tests.ok(not has_table_privilege('anon', 'public.cc_messages', 'SELECT'), 'CI3 · anon sin SELECT (visitantes: sondeo, sin canal)');
  perform tests.eq((select count(*)::int from pg_policy where polrelid = 'public.cc_messages'::regclass), 1, 'CI3 · una sola política (la auditada), sin políticas nuevas');
  perform tests.ok(not exists (select 1 from pg_policy where polrelid = 'public.cc_messages'::regclass and polcmd <> 'r'), 'CI3 · ninguna política de escritura');

  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (s1, s2);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  c1 := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'ci3-1', 'Hola');
  perform public.cc_solicitar_asesor(c1, 'doctor', null, d1);        -- asignada a s1 (vendedor actual)
  c2 := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(c2, 'doctor', null, d2, 'ci3-2', 'Privado de d2');
  n := (select count(*) from public.cc_messages where conversation_id = c1);

  perform tests.act_as(d1);
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = c1), n, 'CI3-28 · el dueño recibe los mensajes de SU conversación');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = c2), 0, 'CI3-28 · el dueño NO recibe mensajes de otra conversación (aunque filtre por su id)');
  perform tests.act_as(d2);
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = c1), 0, 'CI3-17 · otra cuenta de doctor no recibe nada ajeno');
  perform tests.act_as(s1);
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = c1), n, 'CI3 · el vendedor ACTUAL recibe (igual que en Asesorías)');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = c2), 0, 'CI3 · el vendedor no recibe conversaciones que no atiende');
  perform tests.act_as(s2);
  perform tests.eq((select count(*)::int from public.cc_messages), 0, 'CI3 · otro vendedor no recibe nada');
  perform tests.act_as(wh);
  perform tests.eq((select count(*)::int from public.cc_messages), 0, 'CI3 · almacén no recibe nada');
  perform tests.act_as(v_admin);
  perform tests.ok((select count(*) from public.cc_messages where conversation_id in (c1, c2)) = n + 1, 'CI3 · Dirección recibe (supervisión, como hoy)');
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.cc_messages', 'permission denied', 'CI3 · anon: permiso denegado');
  perform tests.act_as(d1);
  perform tests.throws(format('insert into public.cc_messages (conversation_id, seq, actor_type, content, content_hash) values (%L, 999, %L, %L, %L)', c1, 'doctor', 'x', md5('x')), 'permission denied', 'CI3 · el cliente no escribe en la tabla (solo lectura vía RLS)');
  perform tests.act_as_owner();
  perform tests.throws(format('update public.cc_messages set content = %L where conversation_id = %L', 'x', c1), 'APPEND_ONLY', 'CI3 · append-only: solo se publican INSERT');
end $t$;
rollback;
