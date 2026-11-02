-- IA CLÍNICA (20270227) · el down devuelve cc_ia_contexto_actor sin 'clinico'; se reaplica idéntica.
begin;
create temp table _ic as select md5(pg_get_functiondef('public.cc_ia_contexto_actor(uuid)'::regprocedure)) f;
\ir ../../../rollback/ia_clinico/99_down.sql
do $t$ begin
  perform tests.ok(pg_get_functiondef('public.cc_ia_contexto_actor(uuid)'::regprocedure) not like '%clinico%', 'IA-CLÍNICA down · contexto del actor como antes');
end $t$;
\ir ../../../migrations/20270227120000_ia_clinico.sql
do $t$ begin
  perform tests.ok((select f from _ic) = md5(pg_get_functiondef('public.cc_ia_contexto_actor(uuid)'::regprocedure)), 'IA-CLÍNICA · se reaplica idéntica');
end $t$;
rollback;
