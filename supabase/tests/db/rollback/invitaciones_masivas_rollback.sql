-- INVITA-1 · el down retira el envío masivo sin tocar ninguna otra función; se puede volver a aplicar idéntica.
begin;
create temp table _im as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not like '\_invm\_%' and p.proname not like 'invitaciones\_masivas\_%') resto;
\ir ../../../rollback/invitaciones_masivas/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.invitacion_campanas') is null and to_regclass('public.invitacion_envios') is null
                   and not exists (select 1 from pg_proc where proname like '\_invm\_%' or proname like 'invitaciones\_masivas\_%')
                   and not exists (select 1 from cron.job where jobname = 'renovacell-invitaciones'), 'INVITA-1 down · sin tablas, comandos ni tarea');
  perform tests.ok((select resto from _im) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'INVITA-1 down · ninguna otra función cambió');
  perform tests.ok(to_regclass('public.cliente_invitaciones') is not null, 'INVITA-1 down · la invitación individual sigue');
end $t$;
\ir ../../../migrations/20270127120000_invitaciones_masivas.sql
do $t$ begin
  perform tests.ok((select todas from _im) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'INVITA-1 · se vuelve a aplicar y queda idéntica');
end $t$;
rollback;
