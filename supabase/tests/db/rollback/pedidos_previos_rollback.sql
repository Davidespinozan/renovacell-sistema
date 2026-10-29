-- PEDIDOS-PREVIOS (20270207) · el down devuelve políticas y funciones exactas; la migración se reaplica idéntica.
begin;
create temp table _pp as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(tablename || '.' || policyname || ':' || md5(coalesce(qual, '') || '|' || coalesce(with_check, '')), ',' order by tablename, policyname)) from pg_policies where schemaname = 'public') pol;
\ir ../../../rollback/pedidos_previos/99_down.sql
do $t$ begin
  perform tests.ok(md5(pg_get_functiondef('public.estado_dinero_pedido(uuid)'::regprocedure)) = '7744d815fd05b6d654e6076f9c530b62'
               and md5(pg_get_functiondef('public.reportar_pago(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)) = 'a41ef8615e80f0834c2e6b48e75d4004'
               and md5(pg_get_functiondef('public.order_owner(uuid)'::regprocedure)) = '57dc33250d48b3b53f9fc5909a8d015d'
               and to_regprocedure('public._pedido_es_del_doctor(uuid)') is null, 'PEDIDOS-PREVIOS down · funciones exactas de antes');
  perform tests.ok((select md5(coalesce(qual, '') || '|' || coalesce(with_check, '')) from pg_policies where policyname = 'orders_select_scoped') = '81c3652ea0f4fe83d31ca496540c5209', 'PEDIDOS-PREVIOS down · política de pedidos exacta');
end $t$;
\ir ../../../migrations/20270207120000_pedidos_previos_portal.sql
do $t$ begin
  perform tests.ok((select todas from _pp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
               and (select pol from _pp) = (select md5(string_agg(tablename || '.' || policyname || ':' || md5(coalesce(qual, '') || '|' || coalesce(with_check, '')), ',' order by tablename, policyname)) from pg_policies where schemaname = 'public'), 'PEDIDOS-PREVIOS · se reaplica idéntica');
end $t$;
rollback;
