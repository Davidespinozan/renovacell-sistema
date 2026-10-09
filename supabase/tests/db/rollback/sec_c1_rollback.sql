-- SEC-C1 (140) · el down restaura EXACTAMENTE las 6 políticas SELECT y las 4 funciones de producción (md5), elimina el helper
-- interno, conserva permisos, dueño y la política de orders, sin cambios de datos. Revertir REABRE F3 (se comprueba).
begin;
create temp table _secc1 as select (select count(*) from public.order_items) i, (select count(*) from public.payment_entries) e,
  (select count(*) from public.payment_claims) c, (select count(*) from public.refunds) r, (select count(*) from public.cash_closings) k, (select count(*) from public.orders) o;
\ir ../../../rollback/sec_c1/99_down.sql
do $t$
declare v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor'); p uuid := tests.product(100); v_o uuid; v_err text;
begin
  perform tests.eq((select string_agg(tablename || '=' || md5(qual), ',' order by tablename) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
                    and tablename in ('order_items','payment_entries','payment_claims','refunds','cash_closings','inventory_movements','orders')),
    'cash_closings=1659cc7fac6d1594fbc1f4b61d6b0160,inventory_movements=ab9d17be8bde4335fd7540163362d974,order_items=e4e98df6bfa86331b7bf996f37e69d48,'
    'orders=457f39b6ea229576071c7c7f4f4a389d,payment_claims=aca71eb26ba9bd9475887ae97f39eafb,payment_entries=1659cc7fac6d1594fbc1f4b61d6b0160,refunds=1659cc7fac6d1594fbc1f4b61d6b0160',
    '140 down · las 6 políticas idénticas a producción y orders intacta (md5)');
  perform tests.eq((select string_agg(proname || '=' || md5(pg_get_functiondef(oid)), ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace
                    and proname in ('estado_dinero_pedido','estado_fiscal_pedido','efectivo_esperado','tramo_corte_caja')),
    'efectivo_esperado=8ab12fb796a7e64eb3e7c093e8fb8e90,estado_dinero_pedido=0f5bee324f73fe4505a62824674557d8,estado_fiscal_pedido=fd25730aaab4572c4e4cffb3fe351312,'
    'tramo_corte_caja=7559ec6775f850d70f9a797885fa8b19', '140 down · las 4 funciones idénticas a producción (md5)');
  perform tests.ok(to_regprocedure('public._sec_c1_pos_ve_pedido(uuid)') is null, '140 down · helper interno eliminado');
  perform tests.ok((select bool_and(prosecdef and proconfig = array['search_path=public'] and proowner = 'postgres'::regrole
                                    and proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
                    from pg_proc where pronamespace = 'public'::regnamespace and proname in ('estado_dinero_pedido','estado_fiscal_pedido','efectivo_esperado','tramo_corte_caja'))
               and obj_description('public.estado_dinero_pedido(uuid)'::regprocedure, 'pg_proc') is null
               and obj_description('public.estado_fiscal_pedido(uuid)'::regprocedure, 'pg_proc') is not null,
    '140 down · misma forma, permisos y comentarios que producción');
  perform tests.ok((select i = (select count(*) from public.order_items) and e = (select count(*) from public.payment_entries) and c = (select count(*) from public.payment_claims)
                           and r = (select count(*) from public.refunds) and k = (select count(*) from public.cash_closings) and o = (select count(*) from public.orders) from _secc1),
    '140 down · sin cambios de datos');
  -- el down reabre F3 (documentado): un POS sin relación vuelve a obtener el estado de un pedido ajeno
  perform tests.act_as_owner();
  v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  perform tests.act_as(v_pos);
  begin perform public.estado_dinero_pedido(v_o); exception when others then v_err := sqlerrm; end;
  perform tests.act_as_owner();
  perform tests.ok(v_err is null, '140 down · REABRE F3: POS vuelve a leer el estado de un pedido ajeno (por eso no se revierte sin decisión)');
end $t$;
rollback;
