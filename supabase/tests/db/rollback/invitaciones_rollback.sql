-- INVITACIONES (153) · el down retira el mecanismo sin tocar ninguna otra función; se puede volver a aplicar.
begin;
create temp table _iv as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not like 'cliente_invitacion_%' and p.proname not in ('_puede_verificar', 'doctor_verificacion_ver', 'doctor_verificar', 'doctor_verificacion_de_conversacion', 'cc_contacto_de') and p.proname <> 'mi_verificacion' and p.proname not in ('_ligar_prerregistro', 'admin_approve_doctor')) resto;
\ir ../../../rollback/continuidad/99_down.sql   -- CONTINUIDAD (156) se baja primero
\ir ../../../rollback/mi_verificacion/99_down.sql   -- MI-VERIFICACION (155) se baja primero
\ir ../../../rollback/verificacion_vendedor/99_down.sql   -- VERIF-VENDEDOR (154) se baja primero
\ir ../../../rollback/invitaciones/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cliente_invitaciones') is null and not exists (select 1 from pg_proc where proname like 'cliente_invitacion_%'), '153 down · sin tabla ni comandos');
  perform tests.ok((select resto from _iv) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'admin_approve_doctor' and p.proname <> 'cc_contacto_de'), '153 down · ninguna otra función cambió (además de la que baja 154)');
end $t$;
\ir ../../../migrations/20261206120000_invitaciones_clientes.sql
\ir ../../../migrations/20261207120000_verificacion_vendedor.sql
\ir ../../../migrations/20261208120000_mi_verificacion.sql
\ir ../../../migrations/20261209120000_continuidad_aprobacion.sql
do $t$ begin
  perform tests.ok((select todas from _iv) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '153 · se vuelve a aplicar y queda idéntica');
end $t$;
rollback;
