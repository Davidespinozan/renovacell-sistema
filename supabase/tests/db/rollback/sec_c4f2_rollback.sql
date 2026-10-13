-- SEC-C4-FISCAL-2 (146) · el down restaura vender_pos y _w3_receptor EXACTAMENTE como en producción antes de la 146
-- (misma huella, dueño, permisos y forma), elimina las auxiliares y no toca datos. Revertir REABRE los dos hallazgos
-- (se demuestra abajo). Después se vuelve a aplicar la 146 sobre el estado revertido y queda igual que antes.
begin;
create temp table _f2 as select (select count(*) from public.orders) n_o, (select count(*) from public.fiscal_documents) n_f, (select count(*) from public.customer_fiscal_profiles) n_p,
  md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) vp, md5(pg_get_functiondef('public._w3_receptor(uuid,jsonb)'::regprocedure)) wr;
\ir ../../../rollback/sec_c4_fiscal2/99_down.sql
do $t$
declare v_admin uuid := tests.fixture_admin(); posA uuid := tests.user('pos'); p uuid := tests.product(100); lot uuid; cP uuid; v_o uuid := gen_random_uuid();
        lines jsonb; allocs jsonb; SIG text := 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'; r jsonb;
begin
  perform tests.ok(md5(pg_get_functiondef(SIG::regprocedure)) = '3b85cb0590122e4e9056455780fb7231' and md5(pg_get_functiondef('public._w3_receptor(uuid,jsonb)'::regprocedure)) = '79f888d3185d4ba0e4c97802b24115c2',
    '146 down · vender_pos y _w3_receptor idénticas a producción (md5)');
  perform tests.ok(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_fiscal_entrada_error', '_fiscal_entrada_pos')), '146 down · sin funciones auxiliares');
  perform tests.ok((select proowner = 'postgres'::regrole and prosecdef and proconfig = array['search_path=public']
                      and (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text) from aclexplode(coalesce(proacl, acldefault('f', proowner))) a) = array['authenticated', 'postgres', 'service_role']
                    from pg_proc where oid = SIG::regprocedure) and not has_function_privilege('authenticated', 'public._w3_receptor(uuid,jsonb)', 'execute'), '146 down · dueño, SECURITY DEFINER, search_path y permisos como en producción');
  perform tests.ok((select n_o = (select count(*) from public.orders) and n_f = (select count(*) from public.fiscal_documents) and n_p = (select count(*) from public.customer_fiscal_profiles) from _f2), '146 down · sin cambios de datos');
  -- El down reabre los hallazgos (documentado).
  perform tests.act_as_service(); insert into public.customers (full_name, source) values ('Cuenta RB F2', 'odoo') returning id into cP;
  perform tests.act_as_owner(); lot := tests.stock(p, 'F2-RB', 5);
  perform tests.act_as(v_admin); perform public.cliente_fiscal_guardar(cP, null, tests.fiscal('PPP010101PP1'), true);
  lines := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 100)); allocs := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 1));
  perform tests.act_as(posA);
  perform public.vender_pos(v_o, 'F2-RB1', 100, 'efectivo', null, '{}', lines, allocs, true, '{"status":"timbrada","uuid":"inventado","receiver":{"rfc":"MAL"}}'::jsonb, cP, null, null);
  perform tests.act_as_owner();
  perform tests.ok((select invoice_meta ->> 'status' = 'timbrada' and invoice_meta ->> 'uuid' = 'inventado' from public.orders where id = v_o), '146 down · REABRE: vender_pos vuelve a guardar un estado timbrada inventado');
  perform tests.ok(public._w3_receptor(v_o, null) ->> 'rfc' = 'PPP010101PP1', '146 down · REABRE: el receptor capturado inválido vuelve a sustituirse en silencio por el perfil del cliente');
end $t$;
\ir ../../../migrations/20261129120000_sec_c4_fiscal2_pos_validation.sql
do $t$
begin
  perform tests.ok((select vp = md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure))
                       and wr = md5(pg_get_functiondef('public._w3_receptor(uuid,jsonb)'::regprocedure)) from _f2), '146 up tras down · las funciones vuelven a la huella de la 146 (ciclo reproducible)');
  perform tests.ok((select public._w3_receptor(id, null) is null from public.orders where external_ref = 'F2-RB1'), '146 up tras down · el receptor inválido heredado deja de sustituirse');
end $t$;
rollback;
