-- CX-0b (136) · el down restaura EXACTAMENTE crear_pedido y orders_guard y vender_pos de producción (md5), la política
-- orders_insert_scoped y el INSERT de authenticated; sin cambios de datos.
begin;
create temp table _cx0b as select (select count(*) from public.orders) o, (select count(*) from public.customers) c;
\ir ../../../rollback/cx0b/99_down.sql
do $t$
begin
  perform tests.eq(md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)), '408d0b2d90ae8431a3f4583988d11a32', '136 down · crear_pedido idéntico al de producción (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.orders_guard()'::regprocedure)), 'acc92355dbeb6b9adaf901a859369849', '136 down · orders_guard idéntico al de producción (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)), '82bf405665b9e9b1cc6ccc4edc0b6b00', '136 down · vender_pos idéntico al de producción (md5)');
  perform tests.ok(has_function_privilege('authenticated', 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)', 'execute') and not has_function_privilege('anon', 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)', 'execute'), '136 down · permisos de vender_pos como en producción');
  perform tests.ok(has_table_privilege('authenticated', 'public.orders', 'INSERT') and exists (select 1 from pg_policy where polrelid = 'public.orders'::regclass and polname = 'orders_insert_scoped'), '136 down · INSERT y política restaurados');
  perform tests.ok(has_function_privilege('authenticated', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'execute') and not has_function_privilege('anon', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'execute'), '136 down · permisos de crear_pedido como en producción');
  perform tests.ok((select o = (select count(*) from public.orders) and c = (select count(*) from public.customers) from _cx0b), '136 down · sin cambios de datos');
end $t$;
rollback;
