-- MIS-CONVERSACIONES (20270325) · el down quita la lista y la retoma; se reaplica idéntica.
begin;
create temp table _mc as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/cartera_plazo/99_down.sql   -- CARTERA-PLAZO (20270327) parcha la lista y el ruteo: se baja antes
\ir ../../../rollback/mis_conversaciones_prospecto/99_down.sql
\ir ../../../rollback/mis_conversaciones/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_retomar_conversacion(uuid)') is null, 'MIS-CONVERSACIONES down · como antes');
end $t$;
\ir ../../../migrations/20270325120000_mis_conversaciones.sql
\ir ../../../migrations/20270326120000_mis_conversaciones_prospecto.sql
\ir ../../../migrations/20270327120000_cartera_plazo.sql
do $t$ begin
  perform tests.ok((select todas from _mc) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'MIS-CONVERSACIONES · se reaplica idéntica');
end $t$;
rollback;
