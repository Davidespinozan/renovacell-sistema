-- IA EXAMEN (20270228) · el down retira todo lo nuevo; se reaplica idéntica (60 casos sembrados).
begin;
\ir ../../../rollback/ia_examen_cola/99_down.sql   -- IA-EXAMEN-COLA (20270303) cuelga de las corridas: se baja antes de la foto inicial
create temp table _ie as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/ia_examen/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_ia_config') is null and to_regclass('public.cc_ia_examen_casos') is null and to_regprocedure('public.ia_vs_humano(int)') is null, 'IA-EXAMEN down · sin lo nuevo');
end $t$;
\ir ../../../migrations/20270228120000_ia_examen.sql
do $t$ begin
  perform tests.ok((select todas from _ie) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
               and (select count(*) from public.cc_ia_examen_casos) = 60, 'IA-EXAMEN · se reaplica idéntica con sus 60 casos');
end $t$;
rollback;
