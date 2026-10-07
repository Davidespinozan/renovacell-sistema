-- Chat V2-C1 (125) · 25 · rollback y FRONTERA.
--   · Antes de la frontera (solo sesiones abiertas ordinal 1 / respaldo): el down es viable SIN forzar.
--   · Cruzada (una sesión real cerrada u ordinal > 1): el down se niega (FORWARD-FIX ONLY) salvo override explícito.
--   · En ambos casos los mensajes quedan intactos (modelo de rangos: cc_messages nunca se tocó).
begin;
do $t$
declare d uuid := tests.user('doctor'); s uuid := tests.user('pos'); c uuid; k uuid; p uuid; r jsonb; cruzada boolean; v_hash text;
begin
  perform tests.act_as_owner();
  select exists (select 1 from public.cc_conversation_sessions where ordinal > 1 or (estado = 'cerrada' and origen <> 'migracion')) into cruzada;
  perform tests.act_as_service();
  c := (public.cc_abrir_conversacion(null, d) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(c, 'doctor', null, d, 'rb-1', 'Hola');
  perform tests.act_as_owner();
  if not cruzada then
    perform tests.lives('select public._cc_chatv2c1_rollback_guard()', '25 · antes de la frontera el rollback estructural es viable (sin forzar)');
  else
    perform tests.ok(true, '25 · (otras pruebas ya cruzaron la frontera en este cluster; el caso "antes" se verifica en corrida aislada)');
  end if;
  -- cruzar la frontera: cerrar una sesión real y abrir la 2
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id = s;
  perform public.cc_solicitar_asesor(c, 'doctor', null, d);
  perform tests.act_as(tests.fixture_admin()); perform public.cc_solicitud_reasignar(c, s, 'rollback'); perform tests.act_as_service();
  perform public.cc_iniciar_asesoria(c, s);
  perform public.cc_terminar_asesoria(c, s);
  perform public.cc_enviar_mensaje(c, 'doctor', null, d, 'rb-2', 'Otra vez');
  perform tests.act_as_owner();
  perform tests.throws('select public._cc_chatv2c1_rollback_guard()', 'FORWARD-FIX ONLY', '25 · cruzada la frontera, el down se niega');
end $t$;
create temp table _c1rb_antes as select conversation_id, string_agg(id::text || ':' || seq || ':' || content_hash, ',' order by seq) h, count(*) n from public.cc_messages group by conversation_id;
set app.chatv2c1_rollback_forzado = 'on';   -- override explícito (decisión del dueño) para probar la restauración estructural
\ir ../../../rollback/chatv2c2/99_down.sql   -- Chat V2-C2 (127) se baja primero
\ir ../../../rollback/chatv2c1/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.cc_conversation_sessions') is null, '25 · tabla de sesiones retirada');
  perform tests.ok(not exists (select 1 from pg_trigger where tgname = 'trg_ccm_sesion'), '25 · trigger retirado');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'cc_conversation_events' and column_name = 'session_id'), '25 · columna session_id retirada');
  perform tests.ok(to_regprocedure('public.cc_sesiones_listar(uuid,text,text,uuid)') is null and to_regprocedure('public.cc_ia_contexto(uuid,bigint,integer)') is null, '25 · RPC de sesiones retiradas');
  perform tests.ok(position('cc_conversation_sessions' in pg_get_functiondef('public.cc_terminar_asesoria(uuid,uuid)'::regprocedure)) = 0
                   and position('human_ended' in pg_get_functiondef('public.cc_terminar_asesoria(uuid,uuid)'::regprocedure)) > 0, '25 · cc_terminar_asesoria vuelve al texto de la 124');
  perform tests.eq((select count(*)::int from _c1rb_antes a where a.h is distinct from (select string_agg(id::text || ':' || seq || ':' || content_hash, ',' order by seq) from public.cc_messages m where m.conversation_id = a.conversation_id)), 0, '25 · ningún mensaje perdido ni alterado');
end $t$;
rollback;
