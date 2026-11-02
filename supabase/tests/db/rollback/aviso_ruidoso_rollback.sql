-- AVISO RUIDOSO (20270305) · el down retira disparadores y funciones; se reaplica idéntica.
begin;
create temp table _av as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/aviso_ruidoso/99_down.sql
do $t$ begin
  perform tests.ok(not exists (select 1 from pg_trigger where tgname in ('cc_aviso_push', 'trg_ccm_zzescribe')) and to_regprocedure('public.aviso_push_carga(uuid)') is null, 'AVISO-RUIDOSO down · sin lo nuevo');
end $t$;
\ir ../../../migrations/20270305120000_aviso_ruidoso.sql
do $t$ begin
  perform tests.ok((select todas from _av) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'AVISO-RUIDOSO · se reaplica idéntica');
end $t$;
rollback;
