-- RETOMA DEL ASESOR (20270304) · el down retira disparadores y columnas; se reaplica idéntica.
begin;
create temp table _ar as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/asesor_retoma/99_down.sql
do $t$ begin
  perform tests.ok(not exists (select 1 from pg_trigger where tgname in ('trg_ccm_zretoma', 'cc_preferir_ultimo_asesor', 'cc_ultimo_asesor'))
               and not exists (select 1 from information_schema.columns where table_name = 'cc_conversations' and column_name = 'ultimo_asesor_id'), 'RETOMA down · sin lo nuevo');
end $t$;
\ir ../../../migrations/20270304120000_asesor_retoma.sql
do $t$ begin
  perform tests.ok((select todas from _ar) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'RETOMA · se reaplica idéntica');
end $t$;
rollback;
