-- R4-C5-A2 · el down se NIEGA en modo prueba o con permisos vigentes; cerrado, devuelve EXACTAMENTE B2 (las 13 funciones, los
-- CHECK y los triggers de cc_wa_config), archiva los permisos en el historial y se reaplica idéntico.
begin;
create temp table _c5 as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') as todas,
  (select string_agg(conname || '=' || pg_get_constraintdef(oid), '|' order by conname) from pg_constraint where conrelid = 'public.cc_wa_config'::regclass) as ck,
  (select count(*) from public.cc_canal_control_hist) as n_hist;
-- con un permiso vigente y modo prueba: se niega
do $t$
declare v_admin uuid := tests.fixture_admin(); r jsonb; c uuid;
begin
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670009201', 'Rollback', 'wamid.C5R.1', 'hola', false); c := (r ->> 'conversation_id')::uuid;
  perform tests.act_as(v_admin);
  perform public.cc_canal_prueba_autorizar(c, 30, 'Prueba de rollback');
  perform public.cc_canal_cambiar('whatsapp', '{"modo":"prueba"}', 'Prueba de rollback');
  perform tests.act_as_owner();
end $t$;
\set ON_ERROR_STOP 0
savepoint antes_down;
\ir ../../../rollback/canal_prueba_contacto/99_down.sql
rollback to savepoint antes_down;
\set ON_ERROR_STOP 1
do $t$ begin
  perform tests.ok(to_regclass('public.cc_canal_prueba') is not null, 'R4-C5 down · se niega en modo prueba (la tabla sigue)');
end $t$;
-- cerrar (espejo revoca los vigentes) y bajar
update public.cc_wa_config set modo = 'espejo' where id;
\ir ../../../rollback/canal_prueba_contacto/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_canal_prueba') is null and to_regprocedure('public._cc_wa_modo_efectivo(text,boolean)') is null
                   and to_regprocedure('public.cc_canal_prueba_autorizar(uuid,integer,text)') is null, 'R4-C5 down · sin tabla, función central ni RPC');
  perform tests.ok(md5(pg_get_functiondef('public.cc_wa_entrante(text,text,text,text,boolean)'::regprocedure)) = '8c928393e68010e7d8cbacb9791454a4'
                   and md5(pg_get_functiondef('public.cc_wa_salida_reclamar(integer)'::regprocedure)) = '719a854eb9b295545454d117de64095e'
                   and md5(pg_get_functiondef('public.cc_wa_salida_puede_enviar(uuid)'::regprocedure)) = 'c0f149bd4d90c48f10524e85e82c87cb', 'R4-C5 down · funciones B2 con la huella de producción');
  perform tests.ok((select ck from _c5) <> (select string_agg(conname || '=' || pg_get_constraintdef(oid), '|' order by conname) from pg_constraint where conrelid = 'public.cc_wa_config'::regclass)
                   and not exists (select 1 from pg_constraint where conrelid = 'public.cc_wa_config'::regclass and pg_get_constraintdef(oid) like '%prueba%'), 'R4-C5 down · CHECK de cc_wa_config sin prueba');
  perform tests.ok((select count(*) from public.cc_canal_control_hist where despues ->> 'r4c5_down' = 'true') >= 1, 'R4-C5 down · permisos archivados en el historial');
end $t$;
\ir ../../../migrations/20270123120000_canal_prueba_contacto.sql
do $t$ begin
  perform tests.ok((select todas from _c5) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
                   and (select ck from _c5) = (select string_agg(conname || '=' || pg_get_constraintdef(oid), '|' order by conname) from pg_constraint where conrelid = 'public.cc_wa_config'::regclass), 'R4-C5 · se reaplica idéntica (funciones y CHECK)');
end $t$;
rollback;
