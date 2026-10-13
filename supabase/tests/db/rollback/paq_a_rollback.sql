-- PAQ-A (148) · el down elimina solo el rastreo (función y dos tablas); envíos, pedidos y sus funciones quedan igual.
begin;
\ir ../../../rollback/paq_b/99_down.sql   -- PAQ-B (149) se baja primero (anular_guia consulta el rastreo de la 148)
create temp table _paq as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'registrar_rastreo') fns,
  (select md5(string_agg(policyname || coalesce(qual, '') || coalesce(with_check, ''), ',' order by tablename, policyname)) from pg_policies where schemaname = 'public' and tablename not like 'shipment_tracking%') pol,
  (select count(*) from public.shipments) n_s, (select count(*) from public.orders) n_o;
\ir ../../../rollback/paq_a/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.shipment_tracking') is null and to_regclass('public.shipment_tracking_events') is null and not exists (select 1 from pg_proc where proname = 'registrar_rastreo'), '148 down · sin tablas ni función de rastreo');
  perform tests.ok((select fns from _paq) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
               and (select pol from _paq) = (select md5(string_agg(policyname || coalesce(qual, '') || coalesce(with_check, ''), ',' order by tablename, policyname)) from pg_policies where schemaname = 'public'),
    '148 down · todas las demás funciones y políticas quedan idénticas');
  perform tests.ok((select n_s = (select count(*) from public.shipments) and n_o = (select count(*) from public.orders) from _paq), '148 down · envíos y pedidos intactos');
end $t$;
\ir ../../../migrations/20261201120000_paq_a_rastreo.sql
do $t$ begin
  perform tests.ok(to_regclass('public.shipment_tracking') is not null and has_function_privilege('service_role', 'public.registrar_rastreo(uuid,text,text,text,text,timestamptz,jsonb,text)', 'execute'), '148 up tras down · el rastreo vuelve a quedar instalado');
end $t$;
rollback;
