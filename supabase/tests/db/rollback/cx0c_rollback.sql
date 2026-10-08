-- CX-0c (137) · el down vuelve EXACTAMENTE a CX-0b (136): 4 funciones (md5), política POS original (md5), sin el
-- auxiliar; CX-0b intacto (sin INSERT directo, guarda de identidad, validaciones de cuenta); sin cambios de datos.
begin;
create temp table _cx0c as select (select count(*) from public.orders) o, (select count(*) from public.cc_cartera) k, (select count(*) from public.payment_entries) e;
\ir ../../../rollback/cx0c/99_down.sql
do $t$
begin
  perform tests.eq(md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)), '0de9f17fbe0a9e1efeb0ebcb6ada55d1', '137 down · crear_pedido = CX-0b (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)), '0bf3c975bb998fa0685fd36def671f0f', '137 down · vender_pos = CX-0b (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.orders_guard()'::regprocedure)), '3dcc8ade6c0107d77d2c07b7830f8e6b', '137 down · orders_guard = CX-0b (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,integer,boolean,uuid)'::regprocedure)), '9e8af913a8cbe42f26a80ffa6db98823', '137 down · cc_checkout_confirmar = CX-0b (md5)');
  perform tests.eq((select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_select_scoped'), '11eed2578d4cec08ec2fa114ae747a27', '137 down · política POS original (md5)');
  perform tests.ok(to_regprocedure('public._cx0c_atribucion(uuid,uuid)') is null and to_regprocedure('public._cx0c_venta_pos_propia(uuid)') is null, '137 down · auxiliares retirados');
  perform tests.ok(not has_table_privilege('authenticated', 'public.orders', 'INSERT') and not exists (select 1 from pg_policy where polrelid = 'public.orders'::regclass and polcmd = 'a'), '137 down · CX-0b intacto: sin INSERT directo');
  perform tests.ok(has_function_privilege('authenticated', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'execute') and not has_function_privilege('anon', 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)', 'execute'), '137 down · permisos como en CX-0b');
  perform tests.ok((select o = (select count(*) from public.orders) and k = (select count(*) from public.cc_cartera) and e = (select count(*) from public.payment_entries) from _cx0c), '137 down · sin cambios de datos');
end $t$;
rollback;
