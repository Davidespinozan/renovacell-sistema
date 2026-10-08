-- SEC-A (138) · el down restaura EXACTAMENTE las funciones de producción (md5), sus permisos (PUBLIC/anon/authenticated/
-- service_role) y deja intactas las políticas que dependen de ellas; sin cambios de datos.
begin;
create temp table _seca as select (select count(*) from public.orders) o, (select count(*) from public.shipments) s;
\ir ../../../rollback/sec_a/99_down.sql
do $t$
begin
  perform tests.eq(md5(pg_get_functiondef('public.order_owner(uuid)'::regprocedure)), '275ca1cc439c1fe13e1610d0eab21416', '138 down · order_owner idéntica a producción (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.order_vendor_email(uuid)'::regprocedure)), 'b7de05a551bc0482e8421203949bc2a5', '138 down · order_vendor_email idéntica a producción (md5)');
  perform tests.ok(has_function_privilege('anon', 'public.order_owner(uuid)', 'EXECUTE') and has_function_privilege('anon', 'public.order_vendor_email(uuid)', 'EXECUTE')
               and has_function_privilege('authenticated', 'public.order_owner(uuid)', 'EXECUTE') and has_function_privilege('service_role', 'public.order_vendor_email(uuid)', 'EXECUTE')
               and exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.order_owner(uuid)'::regprocedure and a.grantee = 0),
    '138 down · permisos como en producción (PUBLIC + anon + authenticated + service_role)');
  perform tests.ok(obj_description('public.order_owner(uuid)'::regprocedure, 'pg_proc') is null and obj_description('public.order_vendor_email(uuid)'::regprocedure, 'pg_proc') is null, '138 down · sin comentario, como en producción');
  perform tests.ok((select md5(qual) from pg_policies where tablename = 'shipments' and policyname = 'shipments_select_scoped') = '5726c48548f6e0d9e6d69f5205bdc64b'
               and (select md5(qual) from pg_policies where tablename = 'orders' and policyname = 'orders_select_scoped') = '457f39b6ea229576071c7c7f4f4a389d', '138 down · políticas intactas');
  perform tests.ok((select o = (select count(*) from public.orders) and s = (select count(*) from public.shipments) from _seca), '138 down · sin cambios de datos');
end $t$;
rollback;
