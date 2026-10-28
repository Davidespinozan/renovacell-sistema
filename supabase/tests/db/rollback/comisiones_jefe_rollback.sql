-- METAS Y COMISIONES PARA EL JEFE DE VENTAS · el down retira solo sus dos funciones; se reaplica idéntica.
begin;
\ir ../../../rollback/internas_solo_si_mismas/99_down.sql   -- INTERNAS-2 se baja antes de tomar la foto (redefine políticas, cc_vendedores y comisiones_equipo)
create temp table _cj as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not in ('comisiones_equipo', '_jefe_ventas')) resto;
\ir ../../../rollback/comisiones_jefe/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.comisiones_equipo(date,date)') is null and to_regprocedure('public._jefe_ventas()') is null
               and (select resto from _cj) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'COMISIONES-JEFE down · solo se van sus dos funciones');
end $t$;
\ir ../../../migrations/20270130120000_comisiones_jefe_ventas.sql
do $t$ begin
  perform tests.ok((select todas from _cj) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'COMISIONES-JEFE · se reaplica idéntica');
end $t$;
rollback;
