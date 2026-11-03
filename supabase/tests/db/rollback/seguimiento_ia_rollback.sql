-- SEGUIMIENTO IA (20270301) · el down retira cron, push y tablas; se reaplica idéntica.
begin;
\ir ../../../rollback/cliente_de_conversacion/99_down.sql   -- CLIENTE-CONV (20270316) parcha pedidos/comprobante/seguimientos del chat: se baja antes
create temp table _sg as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/seguimiento_ia/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_seguimiento_envios') is null and not exists (select 1 from cron.job where jobname = 'renovacell-seguimiento')
               and not exists (select 1 from pg_trigger where tgname = 'cc_proactivo_push'), 'SEGUIMIENTO down · sin tablas, cron ni push');
end $t$;
\ir ../../../migrations/20270301120000_seguimiento_ia.sql
do $t$ begin
  perform tests.ok((select todas from _sg) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'SEGUIMIENTO · se reaplica idéntica');
end $t$;
rollback;
