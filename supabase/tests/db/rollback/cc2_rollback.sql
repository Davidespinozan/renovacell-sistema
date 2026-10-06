-- CC-2 · El rollback retira el dominio de conversación y devuelve adopción/purga al texto CC-1.
begin;
-- CC-4 (cc_ai_turns → cc_conversations) baja primero.
\ir ../../../rollback/cc6/99_down.sql
\ir ../../../rollback/cc5/99_down.sql
\ir ../../../rollback/cc4/99_down.sql
\ir ../../../rollback/cc2/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.cc_conversations') is null and to_regclass('public.cc_messages') is null and to_regclass('public.cc_participants') is null and to_regclass('public.cc_conversation_events') is null, 'tablas cc_* de conversación retiradas');
  perform tests.ok(to_regprocedure('public.cc_enviar_mensaje(uuid,text,text,uuid,text,text)') is null and to_regprocedure('public.cc_cola_asesorias()') is null and to_regprocedure('public._cc_autoridad(uuid,text,uuid,uuid)') is null, 'comandos CC-2 retirados');
  perform tests.ok(pg_get_functiondef('public.cc_visitante_adoptar(text,uuid)'::regprocedure) not like '%_cc_adoptar_conversaciones%', 'cc_visitante_adoptar vuelve a CC-1');
  perform tests.ok(pg_get_functiondef('public.cc_visitantes_purgar(int)'::regprocedure) not like '%cc_conversations%', 'cc_visitantes_purgar vuelve a CC-1');
  perform tests.ok(to_regclass('public.cc_visitors') is not null and to_regprocedure('public.cc_visitante_abrir(text,text,jsonb,text)') is not null, 'CC-1 intacto tras bajar CC-2');
  perform tests.ok(has_function_privilege('service_role', 'public.cc_visitante_adoptar(text,uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.cc_visitante_adoptar(text,uuid)', 'EXECUTE'), 'privilegios CC-1 iguales');
end $t$;
rollback;
