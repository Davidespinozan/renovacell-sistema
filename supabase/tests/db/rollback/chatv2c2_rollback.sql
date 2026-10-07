-- Chat V2-C2 (127) · El down retira cron, motor, vista previa y configuración de sesiones, y restaura la regla
-- de actividad y el cierre de C1, sin tocar sesiones, mensajes ni eventos.
begin;
create temp table _c2_antes as select (select count(*) from public.cc_conversation_sessions) s, (select count(*) from public.cc_conversation_events) e, (select count(*) from public.cc_messages) m;
\ir ../../../rollback/ci1/99_down.sql   -- Commercial Intent CI-1 (128) se baja primero
\ir ../../../rollback/chatv2c2/99_down.sql
do $t$
begin
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-sesiones-inactivas'), 0, '127 down · job retirado');
  perform tests.eq((select count(*)::int from cron.job where jobname in ('renovacell-atencion-comercial', 'renovacell-alertas-diarias')), 2, '127 down · los otros jobs intactos');
  perform tests.ok(to_regprocedure('public.cc_sesiones_cerrar_inactivas(integer)') is null and to_regprocedure('public.cc_sesiones_inactivas_preview(integer,integer,integer,integer)') is null
                   and to_regprocedure('public._cc_sesion_cerrar_con(uuid,text,text,uuid,jsonb)') is null, '127 down · funciones C2 retiradas');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'cc_atencion_config' and column_name like 'sesion%'), '127 down · configuración de sesiones retirada');
  perform tests.ok(position('_cc_mensaje_renueva' in pg_get_functiondef('public._cc_sesion_mensaje()'::regprocedure)) = 0, '127 down · regla de actividad de C1 restaurada');
  perform tests.ok(to_regprocedure('public._cc_sesion_cerrar(uuid,text,text,uuid)') is not null and to_regclass('public.cc_conversation_sessions') is not null, '127 down · la infraestructura de C1 sigue');
  perform tests.ok((select s = (select count(*) from public.cc_conversation_sessions) and e = (select count(*) from public.cc_conversation_events) and m = (select count(*) from public.cc_messages) from _c2_antes), '127 down · sin cambios de datos');
end $t$;
rollback;
