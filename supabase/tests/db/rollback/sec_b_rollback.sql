-- SEC-B (139) · el down restaura EXACTAMENTE las cuatro funciones de producción (md5), sin comentario, con los mismos permisos,
-- forma y políticas; sin cambios de datos. Revertir REABRE F2 (se comprueba que pos vuelve a pasar la compuerta de cobro).
begin;
create temp table _secb as select (select count(*) from public.payment_entries) e, (select count(*) from public.payment_claims) c,
  (select count(*) from public.refunds) r, (select count(*) from public.cash_closings) k, (select count(*) from public.orders) o;
\ir ../../../rollback/sec_b/99_down.sql
do $t$
declare v_pos uuid := tests.user('pos'); v_o uuid; p uuid := tests.product(100); v_err text;
begin
  perform tests.eq(md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure)), '90a68ac2874f47c4f9bdb1c9dc5e29c3', '139 down · registrar_cobro idéntica a producción (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.autorizar_reembolso(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)), '507f882343f3a34383794040062e183b', '139 down · autorizar_reembolso idéntica a producción (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.reportar_pago(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)), 'bc88599cf93fdec6f8d19843c5bcef99', '139 down · reportar_pago idéntica a producción (md5)');
  perform tests.eq(md5(pg_get_functiondef('public.registrar_corte_caja(uuid,date,text,numeric,numeric,text,uuid)'::regprocedure)), 'a6f9ecaccf463945c63d092280d817c6', '139 down · registrar_corte_caja idéntica a producción (md5)');
  perform tests.ok((select bool_and(obj_description(oid, 'pg_proc') is null and prosecdef and proconfig = array['search_path=public'] and proowner = 'postgres'::regrole
                                    and proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
                    from pg_proc where oid in ('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure, 'public.autorizar_reembolso(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure,
                                               'public.reportar_pago(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure, 'public.registrar_corte_caja(uuid,date,text,numeric,numeric,text,uuid)'::regprocedure)),
    '139 down · sin comentario, misma forma y mismo ACL que producción');
  perform tests.eq((select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) from pg_policies
                    where schemaname = 'public' and tablename in ('payment_entries','payment_claims','refunds','cash_closings','orders','money_operations')),
    '7e0dff2ac0fb0839b52f02acaf324afc', '139 down · políticas intactas');
  perform tests.ok((select e = (select count(*) from public.payment_entries) and c = (select count(*) from public.payment_claims) and r = (select count(*) from public.refunds)
                           and k = (select count(*) from public.cash_closings) and o = (select count(*) from public.orders) from _secb), '139 down · sin cambios de datos');
  -- el down reabre F2 (documentado): pos vuelve a pasar la compuerta de registrar_cobro
  perform tests.act_as_owner();
  v_o := tests.order(tests.user('doctor'), 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  perform tests.act_as(v_pos);
  begin perform public.registrar_cobro(gen_random_uuid(), v_o, 'efectivo', 1); exception when others then v_err := sqlerrm; end;
  perform tests.act_as_owner();
  perform tests.ok(v_err is null, '139 down · REABRE F2: pos vuelve a registrar cobros (por eso no se revierte sin decisión)');
end $t$;
rollback;
