-- DHL D1 (190) · el down retira reconciliar_guia, las columnas de evidencia y el tipo de operación; la 190 se reaplica idéntica.
begin;
create temp table _d1 as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shipping_attempts') n_cols;
\ir ../../../rollback/dhl_d1_reconciliacion/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)') is null, '190 down · sin comando');
  perform tests.eq((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shipping_attempts' and column_name in ('request', 'reconciliacion', 'reconciled_by', 'reconciled_at')), 0::bigint, '190 down · sin columnas de evidencia');
  perform tests.ok(not exists (select 1 from pg_constraint where conrelid = 'public.inventory_operations'::regclass and pg_get_constraintdef(oid) like '%reconciliacion_guia%')
               and exists (select 1 from pg_constraint where conrelid = 'public.inventory_operations'::regclass and pg_get_constraintdef(oid) like '%alta_compra%'), '190 down · tipos de operación como en la 122');
  perform tests.eq((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), (select n_tablas from _d1), '190 down · mismas tablas');
  perform tests.ok(md5(pg_get_functiondef('public.finalize_shipment(uuid,jsonb)'::regprocedure)) = 'a1cf5c01877e87f41ee0e9635b478e34' and md5(pg_get_functiondef('public.anular_guia(uuid,uuid,text)'::regprocedure)) = '35015b5940b8848f001e18ce8d6e1356', '190 down · comandos existentes intactos');
end $t$;
\ir ../../../migrations/20270112120000_dhl_d1_reconciliacion_guia.sql
do $t$ begin
  perform tests.ok((select todas from _d1) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '190 up · todas las funciones idénticas');
  perform tests.eq((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shipping_attempts'), (select n_cols from _d1), '190 up · mismas columnas');
  perform tests.ok(exists (select 1 from pg_constraint where conrelid = 'public.inventory_operations'::regclass and pg_get_constraintdef(oid) like '%reconciliacion_guia%'), '190 up · tipo de operación de vuelta');
end $t$;
rollback;
