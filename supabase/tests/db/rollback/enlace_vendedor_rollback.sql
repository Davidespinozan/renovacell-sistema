-- ENLACE-VENDEDOR (20270211) · el down devuelve ruteo, prerregistro y vendedor del doctor EXACTAMENTE a producción, retira
-- enlaces y atribución, y la migración se reaplica idéntica.
begin;
create temp table _ev as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/enlace_vendedor/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_enlaces') is null and to_regprocedure('public.cc_mi_enlace()') is null and to_regprocedure('public.cc_enlace_publico(text)') is null
               and not exists (select 1 from information_schema.columns where table_name = 'cc_visitors' and column_name in ('enlace_codigo', 'referido_por')), 'ENLACE down · sin enlaces ni atribución');
  perform tests.ok(md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) = '50b9c94b4539b4be1b1deeaa296ee55c'
               and md5(pg_get_functiondef('public.cc_visitante_prerregistrar(text,text,text,text,boolean,text,boolean)'::regprocedure)) = '51005fbf4b824fc4f4df3f3d58bc7249'
               and md5(pg_get_functiondef('public._vendedor_de_doctor(uuid)'::regprocedure)) = '8439a9703ecb07fe85bec8e5291038a0', 'ENLACE down · ruteo, prerregistro y vendedor del doctor idénticos a producción');
end $t$;
\ir ../../../migrations/20270211120000_enlace_vendedor_referidos.sql
do $t$ begin
  perform tests.ok((select todas from _ev) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'ENLACE · se reaplica idéntica');
end $t$;
rollback;
