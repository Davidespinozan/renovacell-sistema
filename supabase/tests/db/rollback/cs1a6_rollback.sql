-- CS-1A.6 (186) · el down devuelve la máquina de estados de la 184; se reaplica idéntica.
begin;
create temp table _cs16 as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas;
\ir ../../../rollback/cs1a6_reversa/99_down.sql
do $t$ begin
  perform tests.ok(not public._cs_transicion_valida('authorized', 'declined') and public._cs_transicion_valida('authorized', 'captured'), '186 down · authorized ya no va a declined; lo demás igual');
end $t$;
\ir ../../../migrations/20270108120000_cs1a6_reversa_autorizacion.sql
do $t$ begin
  perform tests.ok((select todas from _cs16) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '186 · se reaplica idéntica');
end $t$;
rollback;
