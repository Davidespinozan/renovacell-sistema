-- REPARTO (181) · el down retira el reparto y devuelve las 6 funciones a su texto exacto anterior; se reaplica igual.
begin;
create temp table _rp as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/internas_solo_si_mismas/99_down.sql   -- INTERNAS-2 se baja antes (redefine políticas, cc_vendedores y comisiones_equipo)
\ir ../../../rollback/comisiones_jefe/99_down.sql   -- COMISIONES-JEFE usa _es_interna: se baja primero
\ir ../../../rollback/cuentas_internas/99_down.sql   -- CUENTAS INTERNAS se baja primero (redefine reparto, cc_vendedores y conteos)
\ir ../../../rollback/reparto_asesores/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._cc_reparto_elegir(uuid)') is null and not exists (select 1 from information_schema.columns where table_name = 'cc_atencion_config' and column_name = 'reparto_activo')
               and not exists (select 1 from information_schema.columns where table_name = 'cc_conversations' and column_name = 'reparto_probados'), '181 down · sin reparto');
  perform tests.ok(md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) = 'aee657ea83e0cbff9ce673b3fd6ef25e' and md5(pg_get_functiondef('public.cc_atencion_evaluar()'::regprocedure)) = '8065aeee3b8f31dced9b1f0ca77b6963'
               and md5(pg_get_functiondef('public._cc_atencion(uuid)'::regprocedure)) = '7f6d6c3c5f65d2463766b17e9c02484b' and md5(pg_get_functiondef('public.cc_atencion_config_ver()'::regprocedure)) = '87052e507ae90134b0aeb590bf251610'
               and md5(pg_get_functiondef('public.cc_iniciar_asesoria(uuid,uuid)'::regprocedure)) = '35dbad3d69dc1bf2288309a19adee3bc' and md5(pg_get_functiondef('public.cc_ruteo_resumen()'::regprocedure)) = '40a5a685d6ca0451bf23d0ed591f4497', '181 down · las 6 funciones como antes (md5)');
end $t$;
\ir ../../../migrations/20270103120000_reparto_asesores.sql
\ir ../../../migrations/20270129120000_cuentas_internas.sql   -- CUENTAS INTERNAS se reaplica encima
\ir ../../../migrations/20270130120000_comisiones_jefe_ventas.sql
\ir ../../../migrations/20270131120000_internas_solo_si_mismas.sql
do $t$ begin
  perform tests.ok((select todas from _rp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '181 · se reaplica idéntica');
end $t$;
rollback;
