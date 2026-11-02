-- WA VÍNCULO (20270302) · el down retira columnas, códigos y funciones; se reaplica idéntica.
begin;
create temp table _wv as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/wa_vinculo/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_wa_codigos') is null and to_regprocedure('public.cc_ia_identidad_canal(uuid)') is null
               and not exists (select 1 from information_schema.columns where table_name = 'cc_wa_contactos' and column_name = 'vinculo_profile_id'), 'WA-VÍNCULO down · sin lo nuevo');
end $t$;
\ir ../../../migrations/20270302120000_wa_vinculo.sql
do $t$ begin
  perform tests.ok((select todas from _wv) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'WA-VÍNCULO · se reaplica idéntica');
end $t$;
rollback;
