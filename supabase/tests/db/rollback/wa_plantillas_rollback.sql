-- WA-PLANTILLAS (20270403) · el down quita las plantillas y la cola vuelve a retener todo fuera de ventana; se reaplica idéntica.
begin;
create temp table _wp as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/wa_plantillas/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_wa_plantillas') is null and position('tpl:' in pg_get_functiondef('public._cc_wa_encolar()'::regprocedure)) = 0, 'WA-PLANTILLAS down · como antes');
end $t$;
\ir ../../../migrations/20270403120000_wa_plantillas.sql
do $t$ begin
  perform tests.ok((select todas from _wp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'WA-PLANTILLAS · se reaplica idéntica');
end $t$;
rollback;
