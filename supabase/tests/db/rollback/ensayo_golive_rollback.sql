-- ENSAYO GO-LIVE (20270204) · el down devuelve el aviso de pedido nuevo y el saludo a su texto exacto anterior; la
-- migración se reaplica idéntica.
begin;
create temp table _eg as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/ensayo_golive/99_down.sql
do $t$ begin
  perform tests.ok(md5(pg_get_functiondef('public._aviso_pedido_nuevo()'::regprocedure)) = 'b25cf35197e6fd43a35003bb75d728a9'
               and md5(pg_get_functiondef('public._cc_texto_saludo(text,text,boolean,text)'::regprocedure)) = 'f5c98f12f0cbcb65b8e064927762651d', 'ENSAYO-GOLIVE down · funciones exactas de antes');
end $t$;
\ir ../../../migrations/20270204120000_ensayo_golive.sql
do $t$ begin
  perform tests.ok((select todas from _eg) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'ENSAYO-GOLIVE · se reaplica idéntica');
end $t$;
rollback;
