-- 126 · El down de la 126 restaura el guard de la 125 y nada más (no toca tablas ni datos).
begin;
create temp table _g_antes as select (select count(*) from public.cc_conversation_sessions) s, (select count(*) from public.cc_conversation_events) e, (select count(*) from public.cc_messages) m;
\ir ../../../rollback/chatv2c1_guard/99_down.sql
do $t$
begin
  perform tests.ok(position('session_closed' in pg_get_functiondef('public._cc_chatv2c1_rollback_guard()'::regprocedure)) = 0
                   and position('origen <> ''migracion''' in pg_get_functiondef('public._cc_chatv2c1_rollback_guard()'::regprocedure)) > 0, '126 down · guard restaurado al texto de la 125');
  perform tests.ok((select s = (select count(*) from public.cc_conversation_sessions) and e = (select count(*) from public.cc_conversation_events) and m = (select count(*) from public.cc_messages) from _g_antes), '126 down · sin cambios de datos');
  perform tests.ok(to_regclass('public.cc_conversation_sessions') is not null, '126 down · la infraestructura de sesiones (125) sigue intacta');
end $t$;
rollback;
