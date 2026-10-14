-- CAPTURAR CÉDULA (158) · el down retira el comando sin tocar nada más; se reaplica igual.
begin;
create temp table _cc as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'doctor_capturar_cedula') resto;
\ir ../../../rollback/capturar_cedula/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.doctor_capturar_cedula(uuid,text)') is null and (select resto from _cc) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '158 down · sin el comando y nada más cambió');
end $t$;
\ir ../../../migrations/20261211120000_capturar_cedula.sql
do $t$ begin
  perform tests.ok((select todas from _cc) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '158 · se reaplica idéntica');
end $t$;
rollback;
