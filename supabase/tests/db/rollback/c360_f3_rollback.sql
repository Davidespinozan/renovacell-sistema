-- C360-F3 · El rollback devuelve EXACTAMENTE las funciones de 120, la firma de 4 argumentos del checkout y las
-- escrituras directas a doctor_locations; retira tablas, columnas y comandos nuevos.
begin;
\ir ../../../rollback/c360_f3/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.customer_phones') is null and to_regclass('public.customer_fiscal_profiles') is null and to_regclass('public.customer_notes') is null and to_regclass('public.customer_events') is null, 'tablas retiradas');
  perform tests.ok(to_regprocedure('public.cliente_360(uuid)') is null and to_regprocedure('public._c360_actor(uuid)') is null, 'comandos retirados');
  perform tests.ok(to_regprocedure('public.cc_checkout_confirmar(uuid,text,integer,boolean)') is not null and to_regprocedure('public.cc_checkout_confirmar(uuid,text,integer,boolean,uuid)') is null, 'firma de 120 restaurada');
  perform tests.ok(pg_get_functiondef('public.upsert_customer_fiscal(uuid,jsonb)'::regprocedure) ~ '''pos''', 'upsert_customer_fiscal de 120 restaurado');
  perform tests.ok(has_table_privilege('authenticated', 'public.doctor_locations', 'INSERT') and has_table_privilege('authenticated', 'public.doctor_locations', 'UPDATE'), 'escrituras directas restauradas');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'doctor_locations' and column_name in ('tipo', 'municipio')), 'columnas retiradas');
  perform tests.ok(not exists (select 1 from pg_trigger where tgname = 'trg_customers_phone_c360'), 'trigger retirado');
end $t$;
rollback;
