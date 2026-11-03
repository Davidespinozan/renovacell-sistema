-- AVISOS-EXACTOS (20270317) · el down regresa los avisos y el disparador inmediato; se reaplica idéntica.
begin;
create temp table _ae as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/avisos_pedido_exactos/99_down.sql
do $t$ begin
  perform tests.ok(pg_get_functiondef('public._aviso_pedido_nuevo()'::regprocedure) not like '%select * into new%' and pg_get_functiondef('public._cancelacion_avisos()'::regprocedure) not like '%cancel_admin%' and not (select tgdeferrable from pg_trigger where tgname = 'trg_aviso_pedido_nuevo'), 'AVISOS-EXACTOS down · como antes');
end $t$;
\ir ../../../migrations/20270317120000_avisos_pedido_exactos.sql
do $t$ begin
  perform tests.ok((select todas from _ae) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'AVISOS-EXACTOS · se reaplica idéntica');
end $t$;
rollback;
