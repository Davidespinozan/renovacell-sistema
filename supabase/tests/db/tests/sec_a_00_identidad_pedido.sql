-- SEC-A · order_owner / order_vendor_email solo responden por el llamador; anon sin EXECUTE; las políticas de shipments y
-- orders dan exactamente la misma visibilidad (dueño, chofer, Dirección, vendedor, autor POS, ruta heredada meta.owner);
-- pedido ajeno e inexistente son indistinguibles; service_role (BYPASSRLS) conserva su acceso a tablas.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); dC uuid := tests.user('doctor');
  v_drv uuid := tests.user('driver'); v_vend uuid := tests.user('pos', 'vend@t.local'); v_owner uuid := tests.user('pos', 'owner@t.local');
  v_otro uuid := tests.user('pos', 'otro@t.local'); v_sinperfil uuid := gen_random_uuid();
  p uuid := tests.product(100); cA uuid; o uuid; ox uuid; oc uuid; opos uuid; lot uuid; ok boolean; n int;
begin
  perform tests.act_as_service();
  cA := tests.cliente(dA);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, v_vend);
  update public.profiles set meta = coalesce(meta, '{}') || '{"owner":"owner@t.local"}' where id = dC;   -- ruta heredada meta.owner
  perform tests.act_as_owner();
  o  := tests.order(dA, 'shipped', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  ox := tests.order(dC, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  insert into public.shipments (order_id, driver_id, status) values (o, v_drv, 'en_camino');
  perform tests.act_as(v_admin);
  oc := (public.crear_pedido(gen_random_uuid(), null, dA, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), null, false, cA) ->> 'order_id')::uuid;  -- vendedor = cartera
  perform tests.act_as_owner();
  lot := tests.stock(p, 'SECA', 5);
  perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated', 'email', 'otro@t.local')::text, true); perform set_config('role', 'authenticated', true);
  opos := gen_random_uuid();
  ok := public.vender_pos(opos, 'SECA-1', 1, 'efectivo', null, '{}', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1)),
          jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 1)));                 -- venta POS hecha por "otro"
  perform tests.act_as_owner();

  -- ══ FORMA Y PERMISOS ═════════════════════════════════════════════════════════════════════════
  perform tests.ok(not has_function_privilege('anon', 'public.order_owner(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.order_vendor_email(uuid)', 'EXECUTE'), 'G1 · anon sin EXECUTE');
  perform tests.ok(not exists (select 1 from pg_proc pr, aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) a
                               where pr.oid in ('public.order_owner(uuid)'::regprocedure, 'public.order_vendor_email(uuid)'::regprocedure) and a.grantee = 0), 'G2 · PUBLIC sin EXECUTE');
  perform tests.ok(has_function_privilege('authenticated', 'public.order_owner(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'public.order_vendor_email(uuid)', 'EXECUTE')
               and has_function_privilege('service_role', 'public.order_owner(uuid)', 'EXECUTE') and has_function_privilege('service_role', 'public.order_vendor_email(uuid)', 'EXECUTE'),
    'G3 · authenticated y service_role conservan EXECUTE (las políticas RLS lo necesitan)');
  perform tests.ok((select prosecdef and provolatile = 's' and proconfig @> array['search_path=public'] and prorettype = 'uuid'::regtype from pg_proc where oid = 'public.order_owner(uuid)'::regprocedure)
               and (select prosecdef and provolatile = 's' and proconfig @> array['search_path=public'] and prorettype = 'text'::regtype from pg_proc where oid = 'public.order_vendor_email(uuid)'::regprocedure),
    'G4 · misma forma: SECURITY DEFINER, STABLE, search_path fijo, mismo retorno');
  perform tests.ok((select md5(qual) from pg_policies where tablename = 'shipments' and policyname = 'shipments_select_scoped') = '5726c48548f6e0d9e6d69f5205bdc64b'
               and (select md5(qual) from pg_policies where tablename = 'orders' and policyname = 'orders_select_scoped') = '457f39b6ea229576071c7c7f4f4a389d', 'G5 · políticas intactas');
  perform tests.ok(not has_table_privilege('authenticated', 'public.orders', 'INSERT') and not exists (select 1 from pg_policy where polrelid = 'public.orders'::regclass and polcmd = 'a'),
    'G6 · no se amplían permisos de orders (CX-0b intacto)');

  -- ══ NEGATIVAS ════════════════════════════════════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws(format('select public.order_owner(%L)', o), 'permission denied', 'N1 · anon no obtiene el comprador con un UUID conocido');
  perform tests.throws(format('select public.order_vendor_email(%L)', ox), 'permission denied', 'N2 · anon no obtiene meta.owner');
  perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated', 'email', 'otro@t.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.ok(public.order_owner(o) is null and public.order_owner(oc) is null, 'N3 · POS ajeno: order_owner = NULL');
  perform tests.ok(public.order_vendor_email(ox) is null, 'N3 · POS ajeno: no obtiene el correo de otro vendedor');
  perform tests.ok(public.order_owner(gen_random_uuid()) is null and public.order_owner(o) is null, 'N6 · pedido inexistente y ajeno son indistinguibles (ambos NULL)');
  perform tests.ok((select count(*) from public.orders where id in (o, ox, oc)) = 0 and (select count(*) from public.shipments where order_id = o) = 0, 'N7 · sin exposición indirecta por RLS (orders/shipments)');
  perform public.registrar_cobro(gen_random_uuid(), oc, 'efectivo', 0.01);
  perform tests.ok((select count(*) from public.orders where id = oc) = 0, 'N9 · F1 sigue cerrado: un cobro no da visibilidad');
  perform tests.act_as(dB);
  perform tests.ok(public.order_owner(o) is null and (select count(*) from public.shipments where order_id = o) = 0 and (select count(*) from public.orders where id in (o, oc)) = 0,
    'N4 · doctor ajeno: NULL, sin envíos ni pedidos ajenos (aislamiento del portal)');
  perform tests.act_as(v_sinperfil);
  perform tests.ok(public.order_owner(o) is null and public.order_vendor_email(ox) is null and (select count(*) from public.shipments) = 0, 'N5 · autenticado sin relación: NULL y nada visible');
  perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated', 'email', 'owner@t.local')::text, true);
  perform tests.ok(public.order_owner(o) is null, 'N8 · un correo coincidente no da el comprador (order_owner usa auth.uid, no correo)');

  -- ══ POSITIVAS ════════════════════════════════════════════════════════════════════════════════
  perform tests.act_as(dA);
  perform tests.eq(public.order_owner(o), dA, 'P2 · el doctor dueño obtiene su propia identidad');
  perform tests.eq((select count(*) from public.shipments where order_id = o)::int, 1, 'P1 · el doctor dueño conserva sus envíos (shipments_select_scoped)');
  perform tests.ok((select count(*) from public.orders where id in (o, oc)) = 2, 'P7 · el doctor ve sus pedidos');
  perform tests.act_as(v_drv);
  perform tests.eq((select count(*) from public.shipments where order_id = o)::int, 1, 'P3 · chofer conserva su envío asignado');
  perform tests.act_as(v_admin);
  perform tests.ok((select count(*) from public.shipments where order_id = o) = 1 and (select count(*) from public.orders where id in (o, ox, oc, opos)) = 4, 'P4 · Dirección conserva pedidos y envíos');
  perform set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated', 'email', 'vend@t.local')::text, true); perform set_config('role', 'authenticated', true);
  perform tests.ok((select count(*) from public.orders where id = oc) = 1, 'P5 · vendedor de cartera conserva su pedido (CX-0c)');
  perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated', 'email', 'otro@t.local')::text, true);
  perform tests.ok((select count(*) from public.orders where id = opos) = 1, 'P5b · autor de la venta POS la conserva (CX-0c-R1)');
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'email', 'owner@t.local')::text, true);
  perform tests.ok((select count(*) from public.orders where id = ox) = 1 and public.order_vendor_email(ox) = 'owner@t.local', 'P6 · ruta heredada meta.owner conserva su visibilidad (devuelve SU correo)');
  perform tests.ok((select count(*) from public.orders where id in (o, oc)) = 0, 'P6b · y no ve pedidos ajenos');

  -- ══ service_role (BYPASSRLS): acceso a tablas intacto; llamada directa ya no revela datos ═════
  perform tests.act_as_service();
  perform tests.ok((select count(*) from public.shipments where order_id = o) = 1 and (select count(*) from public.orders where id in (o, ox, oc, opos)) = 4, 'P8 · service_role conserva su acceso (no depende de estas funciones)');
  perform tests.ok(public.order_owner(o) is null and public.order_vendor_email(ox) is null, 'P8b · service_role: llamada directa = NULL (sin consumidores; contrato documentado)');
  perform tests.ok((select rolbypassrls from pg_roles where rolname = 'service_role'), 'P8c · service_role tiene BYPASSRLS (las políticas no evalúan estas funciones para él)');
  perform tests.act_as_owner();
end $t$;
rollback;
