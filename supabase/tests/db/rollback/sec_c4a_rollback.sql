-- SEC-C4-A (145) · el down retira SOLO los objetos de C4-A: la búsqueda, sus tres auxiliares y sus tres tablas. No cambia
-- customers, políticas ajenas ni permisos; no revierte SEC-C3/C3b; no reabre nada (la migración era aditiva).
-- ⚠️ Con las tablas se pierden el uso, los excesos anotados y las exclusiones manuales. Después reaplica limpia.
begin;
create temp table _c4a as select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) f, (select count(*) from pg_policies) p,
  (select count(*) from pg_trigger where not tgisinternal) t, (select count(*) from public.customers) c, (select count(*) from pg_tables where schemaname = 'public') tb,
  (select md5(string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations')) pol,
  (select count(*) from public.rate_limit_buckets) rl;
insert into public.c4a_excesos (user_id, dia, tipo) values (gen_random_uuid(), current_date, 'filas');
\ir ../../../rollback/sec_c4a/99_down.sql
do $t$
declare posX uuid := tests.user('pos'); v_c uuid;
begin
  perform tests.ok(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible', '_c4a_dia_local', '_c4a_exceso'))
               and to_regclass('public.c4a_cuota') is null and to_regclass('public.c4a_excesos') is null and to_regclass('public.c4a_exclusiones') is null, '145 down · las 4 funciones y las 3 tablas de C4-A ya no existen');
  perform tests.ok((select f = (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) + 4 and p = (select count(*) from pg_policies) + 3 and tb = (select count(*) from pg_tables where schemaname = 'public') + 3
                      and t = (select count(*) from pg_trigger where not tgisinternal) and c = (select count(*) from public.customers) and rl = (select count(*) from public.rate_limit_buckets) from _c4a),
    '145 down · exactamente 4 funciones, 3 tablas y sus 3 políticas menos; disparadores, clientes y el limitador ajeno sin cambio');
  perform tests.ok((select pol = (select md5(string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations')) from _c4a),
    '145 down · políticas de customers y doctor_locations idénticas (no restaura ni amplía permisos)');
  perform tests.ok(md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) = 'b1e791b99ca8043cb1e2913e0b294600' and to_regprocedure('public._sec_c3_alcance_doctor(uuid)') is not null
               and md5(pg_get_functiondef('public.auth_role()'::regprocedure)) = '663618f6d4eedf568db532bca55cddc5', '145 down · SEC-C3, SEC-C3b y auth_role() no se tocan');
  perform tests.act_as_service(); insert into public.customers (full_name, phone, source) values ('Rollback C4A', '6679990000', 'odoo') returning id into v_c;
  perform tests.act_as(posX);
  perform tests.ok((select count(*) from public.customers where id = v_c) = 1, '145 down · Ventas conserva exactamente el acceso que tenía (C4-A nunca lo cambió)');
  perform tests.act_as_owner();
end $t$;
\ir ../../../migrations/20261128120000_sec_c_c4a_buscar_clientes_pos.sql
do $t$
declare posX uuid := tests.user('pos');
begin
  perform tests.act_as(posX);
  perform tests.ok((select count(*) = 1 and bool_and(nombre = 'Rollback C4A' and telefono_mascara = '••••0000') from public.buscar_clientes_pos('rollback c4a')), '145 · reaplicada tras el down: la búsqueda vuelve a funcionar');
  perform tests.act_as_owner();
  perform tests.ok((select filas = 1 from public.c4a_cuota where user_id = posX) and not exists (select 1 from public.c4a_excesos), '145 · …con cuotas nuevas y el registro de excesos vacío (lo anotado antes del down se perdió: documentado)');
end $t$;
rollback;
