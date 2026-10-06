-- CC-4 · El rollback retira libro de turnos, traza y herramientas de IA sin tocar CC-2/CC-3.
begin;
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
