-- CONTINUIDAD (156) · el down devuelve doctor_verificar y admin_approve_doctor y retira la función; se reaplica igual.
begin;
create temp table _co as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not in ('_ligar_prerregistro', 'doctor_verificar', 'admin_approve_doctor')) resto;
\ir ../../../rollback/continuidad/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._ligar_prerregistro(uuid)') is null and md5(pg_get_functiondef('public.admin_approve_doctor(uuid,uuid,jsonb)'::regprocedure)) = 'ae578fcf8652206d6db0c611d7a4a5ef'
    and md5(pg_get_functiondef('public.doctor_verificar(uuid,boolean,text)'::regprocedure)) = '2125839d158c065129007966c969a4f9', '156 down · funciones como antes');
  perform tests.ok((select resto from _co) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not in ('doctor_verificar', 'admin_approve_doctor')), '156 down · ninguna otra función cambió');
end $t$;
\ir ../../../migrations/20261209120000_continuidad_aprobacion.sql
do $t$ begin
  perform tests.ok((select todas from _co) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '156 · se reaplica idéntica');
end $t$;
rollback;
