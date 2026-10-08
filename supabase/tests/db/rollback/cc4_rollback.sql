-- CC-4 · El rollback retira libro de turnos, traza y herramientas de IA sin tocar CC-2/CC-3.
begin;
set app.chatv2c1_rollback_forzado = 'on';   -- prueba estructural de la cadena completa (la frontera se prueba en chatv2c1_rollback.sql)
\ir ../../../rollback/chatv2d1/99_down.sql   -- CHAT V2-D1 (130) se baja primero
\ir ../../../rollback/ci1/99_down.sql   -- Commercial Intent CI-1 (128) se baja primero
\ir ../../../rollback/chatv2c2/99_down.sql   -- Chat V2-C2 (127) se baja primero
\ir ../../../rollback/chatv2c1/99_down.sql   -- Chat V2-C1 (125) se baja primero
\ir ../../../rollback/chv2a_cron/99_down.sql   -- CHV2-A cron fix (124) se baja primero
\ir ../../../rollback/chv2a/99_down.sql   -- CHV2-A (123) se baja primero
\ir ../../../rollback/c360_f3/99_down.sql   -- C360-F3 (121) se baja primero
\ir ../../../rollback/c360_0/99_down.sql   -- C360-0 (120) se baja primero
\ir ../../../rollback/cc7/99_down.sql   -- CC-7 se baja primero (depende de CC-2/5/6)
\ir ../../../rollback/cc4/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.cc_ai_turns') is null and to_regclass('public.cc_ai_tool_calls') is null, 'tablas CC-4 retiradas');
  perform tests.ok(to_regprocedure('public.cc_ia_turno_reclamar(uuid,bigint,text,text,int)') is null and to_regprocedure('public.cc_ia_precio(uuid,uuid,int)') is null and to_regprocedure('public._cc_ia_puede(text)') is null, 'funciones CC-4 retiradas');
  perform tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'cc\_ia\_%'), 'sin residuos');
  perform tests.ok(to_regclass('public.cc_conversations') is not null and to_regprocedure('public.cc_enviar_mensaje(uuid,text,text,uuid,text,text)') is not null, 'CC-2 intacto');
  perform tests.ok(to_regprocedure('public.cc_ficha_producto(uuid,text)') is not null and to_regprocedure('public.precio_de(uuid,uuid,int)') is not null, 'CC-3 y precio_de intactos');
end $t$;
rollback;
