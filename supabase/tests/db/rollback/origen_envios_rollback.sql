-- ORIGEN-ENVIOS (183) · el down retira trigger y columnas; shipping_address se conserva; se reaplica igual.
begin;
create temp table _oe as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
update public.company_settings set shipping_street = 'Nuevo Mundo', shipping_ext_number = '1045-17' where id = 'default';
\ir ../../../rollback/origen_envios/99_down.sql
do $t$ begin
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'company_settings' and column_name = 'shipping_street') and to_regprocedure('public._origen_envios_sync()') is null, '183 down · sin columnas ni trigger');
  perform tests.eq((select shipping_address from public.company_settings where id = 'default'), 'Nuevo Mundo 1045-17', '183 down · shipping_address conserva la última línea armada (DHL sigue igual)');
end $t$;
\ir ../../../migrations/20270105120000_origen_envios.sql
do $t$ begin
  perform tests.ok((select todas from _oe) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '183 · se reaplica idéntica');
end $t$;
rollback;
