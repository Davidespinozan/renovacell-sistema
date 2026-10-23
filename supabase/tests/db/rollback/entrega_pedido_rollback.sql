-- ENTREGA DEL PEDIDO (171) · el down retira la entrega (tabla, columnas, funciones, guarda) y el checkout vuelve a la 119/137;
-- se reaplica idéntica. Con pedidos que ya llevan entrega o flete, el down se niega (no destruye información).
begin;
create temp table _ent as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas;
set app.entrega_rollback_forzado = 'on';
\ir ../../../rollback/entrega_horarios/99_down.sql   -- ENT-H (189) se baja primero (redefine normalizar/aplicar/checkout y añade columnas a entrega_config)
\ir ../../../rollback/entrega_pedido/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.entrega_config') is null and to_regprocedure('public.crear_pedido_con_entrega(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb,jsonb)') is null
               and to_regprocedure('public.entrega_opciones(text,numeric,text,timestamptz)') is null and to_regprocedure('public.cc_checkout_revisar(uuid,uuid,jsonb)') is not null
               and not exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'shipping_cost')
               and not exists (select 1 from information_schema.columns where table_name = 'cc_checkout_reviews' and column_name = 'entrega')
               and not exists (select 1 from pg_trigger where tgname = 'orders_shipping_cost_guard')
               and md5(pg_get_functiondef('public.cc_checkout_revisar(uuid,uuid,jsonb)'::regprocedure)) = 'de58088479a7c4a5ee971c240f442802'
               and md5(pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,integer,boolean,uuid)'::regprocedure)) = '49129e57d5f044e624a6d61621fb3bce'
               and (select n_tablas from _ent) = (select count(*) + 2 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'),   -- entrega_config y entrega_horarios (ENT-H)
    '171 down · sin entrega; el checkout como en la 119/137; crear_pedido y la 147 intactos');
end $t$;
\ir ../../../migrations/20261224120000_entrega_pedido.sql
\ir ../../../migrations/20270111120000_entrega_horarios.sql   -- ENT-H (189) se reaplica encima para comparar el estado completo
do $t$ begin
  perform tests.ok((select todas from _ent) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '171 · se reaplica idéntica');
end $t$;
-- con un pedido que lleva flete, el down se niega
savepoint con_datos;
do $t$ declare v_pos uuid := tests.user('pos'); cu uuid; p uuid; begin
  perform tests.act_as_service();
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'RB-ENT', 5);
  insert into public.customers (full_name, phone, source) values ('Rb Entrega', '6670001111', 'odoo') returning id into cu;
  perform tests.act_as(v_pos);
  perform public.crear_pedido_con_entrega(gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), '{"address":{"line1":"Calle 1","cp":"82000","phone":"6691234567"}}'::jsonb, false, cu, null, '{"opcion":"foraneo_dhl"}');
  perform tests.act_as_owner();
end $t$;
set app.entrega_rollback_forzado = 'off';
do $t$ begin
  begin
    execute $d$ do $pre$ begin if coalesce(current_setting('app.entrega_rollback_forzado', true), '') <> 'on' and exists (select 1 from public.orders where shipping_cost <> 0 or shipping_meta ? 'entrega') then raise exception 'ENTREGA down: hay pedidos con entrega o flete registrados; no se revierte en automático'; end if; end $pre$ $d$;
    perform tests.ok(false, '171 down · con pedidos con entrega debe negarse');
  exception when others then
    perform tests.ok(sqlerrm like 'ENTREGA down: hay pedidos%', '171 down · con pedidos con entrega se niega (la guarda del down)');
  end;
end $t$;
rollback to savepoint con_datos;
rollback;
