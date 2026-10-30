-- HERRAMIENTAS DEL VENDEDOR · bloque A (20270214) · el down retira solo lo nuevo; se reaplica idéntica.
begin;
create temp table _ba as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/busqueda_compradores/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_buscar_mensajes(text,integer)') is null and to_regclass('public.idx_order_items_product') is null, 'BLOQUE-A down · sin búsqueda ni índices');
end $t$;
\ir ../../../migrations/20270214120000_busqueda_y_compradores.sql
do $t$ begin
  perform tests.ok((select todas from _ba) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'BLOQUE-A · se reaplica idéntica');
end $t$;
rollback;
