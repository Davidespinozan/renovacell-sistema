-- AVISO RUIDOSO (20270305) · el vendedor dueño del cliente se entera cuando éste escribe y lo atiende la IA (una vez por
-- sesión), y las alertas comerciales también salen como push urgente (el disparador despierta a la Edge push).
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); c1 uuid; r jsonb; v_n uuid; n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id = s1;
  perform tests.cliente(d1);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  perform tests.act_as_owner();
  insert into vault.decrypted_secrets (name, decrypted_secret) values ('project_url', 'http://127.0.0.1:54321'), ('comm_cron_secret', repeat('c', 40)) on conflict (name) do nothing;
  perform tests.act_as_service();

  -- ══ 1 · su cliente escribe y lo atiende la IA: el vendedor se entera, una vez por sesión ══
  c1 := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'ar-1', 'Hola, ¿tienen Nabota?');
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'ar-2', '¿y Botox?');
  select count(*) into n from public.notifications where kind = 'cliente_escribe' and s1 = any (user_ids) and conversation_id = c1;
  perform tests.eq(n, 1, '1 · "tu cliente está escribiendo" una sola vez por sesión');
  perform tests.ok((select body from public.notifications where kind = 'cliente_escribe' and conversation_id = c1) like '%está escribiendo; la IA lo atiende%', '1 · dice que la IA lo atiende');

  -- ══ 2 · la alerta sale como push urgente ══
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from net._llamadas where url like '%/functions/v1/push' and body ->> 'action' = 'aviso' and headers ? 'x-cron-secret'), '2 · despierta a la Edge push con el secreto');
  perform tests.act_as_service();
  select id into v_n from public.notifications where kind = 'cliente_escribe' and conversation_id = c1;
  r := public.aviso_push_carga(v_n);
  perform tests.ok((r -> 'perfiles' ->> 0)::uuid = s1 and r ->> 'title' = '💬 Tu cliente está escribiendo', '2 · carga: a su vendedor, con título claro');
  perform public._cc_notificar('handoff_escalado', c1, null, array['admin'], 'Cliente sin atender', 'av_atencion', 'esc:test');
  select id into v_n from public.notifications where event_key = 'esc:test';
  perform tests.ok(public.aviso_push_carga(v_n) -> 'perfiles' @> to_jsonb(array[v_admin]), '2 · las de Dirección van a Dirección (por rol)');

  -- ══ 3 · con un asesor ya asignado no se duplica (avisa el push del chat) ══
  perform tests.act_as_owner(); update public.cc_conversations set modo = 'human_active', seller_profile_id = s1 where id = c1; perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'ar-3', '¿sigues ahí?');
  select count(*) into n from public.notifications where kind = 'cliente_escribe' and conversation_id = c1;
  perform tests.eq(n, 1, '3 · con asesor atendiendo no se agrega otra');
  perform tests.ok(not has_function_privilege('authenticated', 'public.aviso_push_carga(uuid)', 'EXECUTE'), '4 · la carga del push es del servidor');
end $t$;
rollback;
