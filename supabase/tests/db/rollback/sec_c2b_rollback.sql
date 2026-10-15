-- SEC-C2b (142) · el down restaura estado_custodia y vender_pos EXACTAMENTE como en producción antes de la 142 (misma huella,
-- dueño, permisos y forma); SEC-C2 (141), políticas y datos intactos. Revertir REABRE el P1 (se demuestra abajo).
begin;
create temp table _secc2b as select (select count(*) from public.custodies) c, (select count(*) from public.custody_lines) l, (select count(*) from public.orders) o;
\ir ../../../rollback/sec_c4_fiscal3/99_down.sql   -- SEC-C4-FISCAL-3 (147) se baja primero
\ir ../../../rollback/sec_c4_fiscal2/99_down.sql   -- SEC-C4-FISCAL-2 (146) se baja primero (redefine vender_pos sobre la de SEC-C2b)
\ir ../../../rollback/sec_c2b/99_down.sql
do $t$
declare v_admin uuid := tests.fixture_admin(); posX uuid := tests.user('pos'); dN uuid := tests.user('doctor'); dT uuid := tests.user('doctor');
        p uuid := tests.product(100); lot uuid; cT uuid; cusT uuid := gen_random_uuid(); lines jsonb; allocs jsonb; leyo boolean := false; vendio boolean := false;
begin
  perform tests.ok(md5(pg_get_functiondef('public.estado_custodia(uuid)'::regprocedure)) = '6f9172476ed18bbec738e7b545c49f5d'
               and md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) = '9ae71e2fbe55825514202b99d4bec03b',
    '142 down · estado_custodia y vender_pos idénticas a producción (md5)');
  perform tests.ok((select count(*) = 2 and bool_and(proowner = 'postgres'::regrole and prosecdef and proconfig = array['search_path=public']
                      and (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text) from aclexplode(coalesce(proacl, acldefault('f', proowner))) a) = array['authenticated', 'postgres', 'service_role'])
                    from pg_proc where pronamespace = 'public'::regnamespace and proname in ('estado_custodia', 'vender_pos')), '142 down · dueño, SECURITY DEFINER, search_path y permisos como en producción');
  perform tests.ok((select count(*) = 2 from pg_class where oid in ('public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass) and reloptions = array['security_invoker=true'])
               and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('custodies', 'custody_lines')) = 2, '142 down · SEC-C2 (141) y las políticas no se tocan');
  perform tests.ok((select c = (select count(*) from public.custodies) and l = (select count(*) from public.custody_lines) and o = (select count(*) from public.orders) from _secc2b), '142 down · sin cambios de datos');
  -- El down reabre el P1 (documentado): con una custodia de titular tercero, un doctor sin relación la lee y un pos sin relación vende de ella.
  perform tests.act_as_service();
  insert into public.customers (full_name, email, source, profile_id) values ('Tercero RB', 'rb@clinica.test', 'portal', dT) returning id into cT;
  perform tests.act_as_owner(); lot := tests.stock(p, 'C2B-RB', 10);
  perform tests.act_as(v_admin); perform public.abrir_custodia(cusT, 'vendedor', 'tercero', null, cT, null, null, null);
  perform tests.act_as_owner(); perform tests.entregar(cusT, lot, 3);
  lines := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1)); allocs := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 1));
  perform tests.act_as(dN);   begin perform public.estado_custodia(cusT); leyo := true; exception when others then leyo := false; end;
  perform tests.act_as(posX); begin vendio := public.vender_pos(gen_random_uuid(), 'C2B-RB', 1, 'efectivo', null, '{}', lines, allocs, false, null, null, 300, cusT); exception when others then vendio := false; end;
  perform tests.act_as_owner();
  perform tests.ok(leyo, '142 down · REABRE el P1 de lectura: un doctor sin relación vuelve a leer la custodia de un tercero');
  perform tests.ok(vendio and tests.en_poder(cusT, lot) = 2, '142 down · REABRE el P1 de venta: un pos sin relación vuelve a vender de la custodia de un tercero (por eso no se revierte sin decisión)');
end $t$;
rollback;
