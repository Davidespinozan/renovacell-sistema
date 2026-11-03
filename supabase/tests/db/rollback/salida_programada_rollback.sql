-- SALIDA-PROGRAMADA (20270320) · el down regresa la regla y quita el comando; se reaplica idéntica.
begin;
create temp table _sp as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/salida_programada/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.entrega_salida_programar(uuid,date,jsonb,text)') is null and pg_get_functiondef('public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)'::regprocedure) not like '%SALIDA PROGRAMADA%', 'SALIDA-PROGRAMADA down · como antes');
end $t$;
\ir ../../../migrations/20270320120000_salida_programada.sql
do $t$ begin
  perform tests.ok((select todas from _sp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'SALIDA-PROGRAMADA · se reaplica idéntica');
end $t$;
rollback;
