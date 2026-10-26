-- R4-B2-4 · el down retira solo las lecturas del panel (sin datos) y se reaplica idéntica; B2-1…B2-3b intactos.
begin;
\ir ../../../rollback/canal_prueba_contacto/99_down.sql   -- R4-C5 (0123) se baja ANTES de la línea base de esta cadena
create temp table _pc as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas;
\ir ../../../rollback/panel_canal/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_canal_panel(text)') is null and to_regprocedure('public.cc_canal_conversacion_control(uuid)') is null and to_regprocedure('public._cc_nombre_personal(uuid)') is null, 'B2-4 down · sin lecturas del panel');
  perform tests.ok(to_regprocedure('public.cc_tomar_conversacion(uuid,text)') is not null and to_regprocedure('public.cc_salida_decidir(text,uuid[],text,text)') is not null and to_regprocedure('public.cc_canal_cambiar(text,jsonb,text)') is not null, 'B2-4 down · B2-1/B2-2/B2-3b intactos');
end $t$;
\ir ../../../migrations/20270122120000_panel_canal.sql
do $t$ begin
  perform tests.ok((select todas from _pc) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'B2-4 · se reaplica idéntica');
end $t$;
\ir ../../../migrations/20270123120000_canal_prueba_contacto.sql   -- R4-C5 (0123) se reaplica tras la comparación final
rollback;
