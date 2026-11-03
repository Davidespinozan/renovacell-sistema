-- REPARTO POR TURNO (20270312) · el down regresa al azar, el aviso a Dirección y los permisos de promociones; se reaplica idéntica.
begin;
\ir ../../../rollback/cartera_plazo/99_down.sql   -- CARTERA-PLAZO (20270327) parcha ruteo, responsable y herencia de cartera: se baja antes de la foto inicial
create temp table _rt as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/reparto_turno/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._cc_vendedor_turno(uuid[])') is null and to_regclass('public.cc_reparto_turnos') is null
               and pg_get_functiondef('public._cc_reparto_elegir(uuid)'::regprocedure) like '%random()%'
               and pg_get_functiondef('public._promo_puede_administrar()'::regprocedure) not like '%warehouse%', 'TURNO down · como antes');
end $t$;
\ir ../../../migrations/20270312120000_reparto_turno.sql
do $t$ begin
  perform tests.ok((select todas from _rt) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'TURNO · se reaplica idéntica');
end $t$;
rollback;
