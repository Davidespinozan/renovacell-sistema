-- CONTACTO CONVERSACIONAL (20270212) · el down solo retira lo nuevo; se reaplica idéntica.
begin;
create temp table _cv as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/contacto_conversacional/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_ia_registrar_contacto(uuid,text,text,text,text,boolean,text)') is null and to_regprocedure('public.cc_bienvenida_contacto(uuid,text)') is null, 'CONTACTO-CONV down · sin funciones nuevas');
end $t$;
\ir ../../../migrations/20270212120000_contacto_conversacional.sql
do $t$ begin
  perform tests.ok((select todas from _cv) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'CONTACTO-CONV · se reaplica idéntica');
end $t$;
rollback;
