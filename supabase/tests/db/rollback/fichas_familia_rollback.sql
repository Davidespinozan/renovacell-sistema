-- FICHAS POR FAMILIA (20270225) · el down quita la herencia y la aprobación en un paso; se reaplica idéntica.
begin;
create temp table _ff as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/fichas_familia/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_conocimiento_aprobar_ficha(uuid,boolean)') is null and pg_get_functiondef('public._cc_secciones_visibles(uuid,text)'::regprocedure) not like '%parent_product_id%', 'FICHAS-FAMILIA down · sin herencia ni aprobación en un paso');
end $t$;
\ir ../../../migrations/20270225120000_fichas_familia.sql
do $t$ begin
  perform tests.ok((select todas from _ff) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'FICHAS-FAMILIA · se reaplica idéntica');
end $t$;
rollback;
