-- LINK DE PAGO (20270309) · el down deja el push, las plantillas de correo y todo lo demás como antes; se reaplica idéntica.
begin;
create temp table _lp as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/link_pago/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.pago_links') is null and to_regprocedure('public.link_pago_enviar(uuid,text)') is null
               and pg_get_functiondef('public.aviso_push_carga(uuid)'::regprocedure) not like '%link_pago%', 'LINK DE PAGO down · como antes');
end $t$;
\ir ../../../migrations/20270309120000_link_pago.sql
do $t$ begin
  perform tests.ok((select todas from _lp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'LINK DE PAGO · se reaplica idéntica');
end $t$;
rollback;
