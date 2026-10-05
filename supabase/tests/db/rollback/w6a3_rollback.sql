-- W6-A3.1 · El rollback restaura las funciones ORIGINALES (md5 de producción pre-A3.1),
-- el job anterior y el SELECT de PUBLIC sobre cron.*; retira los objetos nuevos.
begin;
\ir ../../../rollback/w6a3/99_down.sql
do $t$
begin
  perform tests.eq(md5(pg_get_functiondef('public.avisar_cuentas_por_cobrar()'::regprocedure)), '014e3fb889d2ddad395ed26371c95760',
    'avisar_cuentas_por_cobrar() vuelve con su texto exacto de producción');
  perform tests.eq(md5(pg_get_functiondef('public.avisar_lotes_por_caducar()'::regprocedure)), 'ffdb9fbcdc59daf6be7442d134238187',
    'avisar_lotes_por_caducar() vuelve con CURRENT_DATE (texto exacto de producción)');
  perform tests.ok(to_regproc('public.salud_sistema') is null and to_regproc('public.correr_alertas_diarias') is null
               and to_regclass('public.sistema_latidos') is null, 'objetos A3.1 retirados');
  perform tests.eq((select command from cron.job where jobname = 'renovacell-alertas-diarias'),
    'SELECT public.avisar_lotes_por_caducar(); SELECT public.avisar_cuentas_por_cobrar();', 'job anterior restaurado');
  perform tests.ok((select proacl::text like '%service_role=X%' from pg_proc where proname = 'avisar_cuentas_por_cobrar'), 'grants originales (service_role)');
end $t$;
rollback;
