-- CC-0A · El rollback devuelve políticas, vistas y profiles_guard (md5 W6-A1 de producción)
-- a su texto anterior y retira las funciones nuevas.
begin;
\ir ../../../rollback/cc0a/99_down.sql
do $t$
declare v_opts text[];
begin
  perform tests.eq(md5(pg_get_functiondef('public.profiles_guard()'::regprocedure)), 'e701d0cb758330d71210eac028df7211',
    'profiles_guard() vuelve con su texto exacto W6-A1 (producción)');
  perform tests.eq((select qual from pg_policies where tablename = 'product_volume_prices' and policyname = 'pvp_read'), 'true', 'pvp_read vuelve a using (true)');
  perform tests.eq((select qual from pg_policies where tablename = 'price_lists' and policyname = 'price_lists_read'), 'true', 'price_lists_read vuelve a using (true)');
  perform tests.ok((select qual from pg_policies where tablename = 'product_prices' and policyname = 'product_prices_read') not like '%puede_ver_precio%',
    'product_prices_read vuelve sin la frontera');
  perform tests.ok(pg_get_viewdef('public.v_order_money'::regclass) not like '%pedido_visible%', 'v_order_money vuelve sin filtro');
  select reloptions into v_opts from pg_class where oid = 'public.v_stock_disponible'::regclass;
  perform tests.ok(v_opts is null or 'security_invoker=false' = any (v_opts), 'v_stock_disponible vuelve a owner-run');
  perform tests.ok(to_regprocedure('public.puede_ver_precio()') is null and to_regprocedure('public.pedido_visible(uuid)') is null, 'funciones CC-0A retiradas');
  perform tests.ok(has_table_privilege('authenticated', 'public.v_order_money', 'SELECT') and has_table_privilege('authenticated', 'public.v_stock_disponible', 'SELECT'),
    'authenticated conserva SELECT en las vistas');
end $t$;
rollback;
