-- VERIFICACIÓN POR WHATSAPP (20270306) · el down retira lo nuevo y regresa la carga del push; se reaplica idéntica.
begin;
create temp table _vw as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/verificacion_wa/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_solicitudes_alta') is null and to_regprocedure('public.cc_senal_interes(uuid,text)') is null
               and pg_get_functiondef('public.aviso_push_carga(uuid)'::regprocedure) not like '%senal_compra%', 'VERIFICACIÓN-WA down · como la 20270305');
end $t$;
\ir ../../../migrations/20270306120000_verificacion_wa.sql
do $t$ begin
  perform tests.ok((select todas from _vw) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'VERIFICACIÓN-WA · se reaplica idéntica');
end $t$;
rollback;
