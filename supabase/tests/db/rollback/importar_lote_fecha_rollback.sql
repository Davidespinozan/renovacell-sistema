-- IMPORTAR-LOTE-FECHA (20270319) · el down regresa la conversión anterior; se reaplica idéntica.
begin;
create temp table _il as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/importar_lote_fecha/99_down.sql
do $t$ begin
  perform tests.ok(pg_get_functiondef('public.importar_lote(uuid,text,text,text,integer)'::regprocedure) not like '%AAAA-MM-DD%', 'IMPORTAR-LOTE-FECHA down · como antes');
end $t$;
\ir ../../../migrations/20270319120000_importar_lote_fecha.sql
do $t$ begin
  perform tests.ok((select todas from _il) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'IMPORTAR-LOTE-FECHA · se reaplica idéntica');
end $t$;
rollback;
