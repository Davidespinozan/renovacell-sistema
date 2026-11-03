-- CLIENTE-CONV (20270316) · el down regresa las 4 funciones; se reaplica idéntica.
begin;
create temp table _cc as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/cliente_de_conversacion/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._cc_cliente_conv(uuid)') is null and pg_get_functiondef('public.cc_cliente_pedidos(uuid)'::regprocedure) not like '%_cc_cliente_conv%', 'CLIENTE-CONV down · como antes');
end $t$;
\ir ../../../migrations/20270316120000_cliente_de_conversacion.sql
do $t$ begin
  perform tests.ok((select todas from _cc) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'CLIENTE-CONV · se reaplica idéntica');
end $t$;
rollback;
