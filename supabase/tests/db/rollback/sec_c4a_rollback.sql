-- SEC-C4-A (145) · el down retira SOLO buscar_clientes_pos, su auxiliar y los contadores de su limitador. No cambia
-- tablas, políticas ni permisos; no revierte SEC-C3/C3b. No reabre nada (la migración era aditiva). Después reaplica limpia.
begin;
create temp table _c4a as select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) f, (select count(*) from pg_policies) p,
  (select count(*) from pg_trigger where not tgisinternal) t, (select count(*) from public.customers) c,
  (select md5(string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations')) pol;
insert into public.rate_limit_buckets (scope, subject, window_start, count) values ('c4a_buscar_clientes_dia', 'rb', now(), 3), ('otro_scope_ajeno', 'rb', now(), 9);
\ir ../../../rollback/sec_c4a/99_down.sql
do $t$
declare posX uuid := tests.user('pos'); v_c uuid;
begin
  perform tests.ok(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible')), '145 down · las dos funciones de C4-A ya no existen');
  perform tests.ok((select f = (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) + 2 and p = (select count(*) from pg_policies) and t = (select count(*) from pg_trigger where not tgisinternal)
                      and c = (select count(*) from public.customers) from _c4a), '145 down · exactamente dos funciones menos; políticas, disparadores y clientes sin cambio');
  perform tests.ok((select pol = (select md5(string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations')) from _c4a),
    '145 down · políticas de customers y doctor_locations idénticas (no restaura ni amplía permisos)');
  perform tests.ok(not exists (select 1 from public.rate_limit_buckets where scope like 'c4a_buscar_clientes%') and exists (select 1 from public.rate_limit_buckets where scope = 'otro_scope_ajeno'),
    '145 down · retira sus contadores del limitador y no toca los de otros');
  perform tests.ok(md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) = 'b1e791b99ca8043cb1e2913e0b294600' and to_regprocedure('public._sec_c3_alcance_doctor(uuid)') is not null
               and md5(pg_get_functiondef('public.rate_limit_hit(text,text,integer,integer,integer)'::regprocedure)) = 'ee5590f8c5a2e843c0e2ab6b52605274', '145 down · SEC-C3, SEC-C3b y el limitador no se tocan');
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
end $t$;
rollback;
