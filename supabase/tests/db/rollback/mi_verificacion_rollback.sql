-- MI VERIFICACIÓN (155) · el down retira mi_verificacion y devuelve doctor_verificar; se puede volver a aplicar.
begin;
create temp table _mv as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not in ('mi_verificacion', 'doctor_verificar') and p.proname not in ('_ligar_prerregistro', 'admin_approve_doctor')) resto;
\ir ../../../rollback/continuidad/99_down.sql   -- CONTINUIDAD (156) se baja primero
\ir ../../../rollback/mi_verificacion/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.mi_verificacion()') is null and md5(pg_get_functiondef('public.doctor_verificar(uuid,boolean,text)'::regprocedure)) = '8cf4dbc5e9e32d09f5b125f51d92c6ad', '155 down · sin mi_verificacion y doctor_verificar como en producción');
  perform tests.ok((select resto from _mv) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'admin_approve_doctor' and p.proname <> 'doctor_verificar'), '155 down · ninguna otra función cambió');
end $t$;
\ir ../../../migrations/20261208120000_mi_verificacion.sql
\ir ../../../migrations/20261209120000_continuidad_aprobacion.sql
do $t$ begin
  perform tests.ok((select todas from _mv) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '155 · se vuelve a aplicar y queda idéntica');
end $t$;
rollback;
