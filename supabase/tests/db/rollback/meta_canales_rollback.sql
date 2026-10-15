-- CANALES DE META (170) · el down retira todo lo de Instagram/Messenger y _cc_nombre_dueno vuelve a la 167; se reaplica igual.
begin;
create temp table _mc as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas;
\ir ../../../rollback/meta_canales/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_meta_contactos') is null and to_regprocedure('public.cc_canales_bandeja()') is null and to_regprocedure('public.cc_wa_bandeja()') is not null
               and md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) = '39c39181b7af60d72a4bf0e1f849dae2'
               and not exists (select 1 from pg_trigger where tgname = 'trg_cc_meta_encolar') and (select n_tablas from _mc) = (select count(*) + 4 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'),
    '170 down · sin tablas ni funciones de Meta; WhatsApp (167–169) sigue; el nombre como en la 167');
end $t$;
\ir ../../../migrations/20261223120000_meta_canales.sql
do $t$ begin
  perform tests.ok((select todas from _mc) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '170 · se reaplica idéntica');
end $t$;
rollback;
