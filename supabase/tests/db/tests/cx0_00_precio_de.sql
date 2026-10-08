-- CX-0A · Barrera de precio_de (ambas firmas). Mismo alcance que la RLS de product_prices:
--   personal comercial/operativo → cualquier lista; doctor verificado / chofer → base o SU lista;
--   no verificado, sin perfil, lista ajena → PRECIO_NO_AUTORIZADO; anon sin EXECUTE; suspendido falla cerrado;
--   contexto de servidor (service_role / BD sin JWT) sin barrera. Los consumidores siguen igual.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse');
  v_pack uuid := tests.user('packing'); v_comm uuid := tests.user('comm'); v_pos uuid := tests.user('pos');
  v_drv uuid := tests.user('driver'); v_doc uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor');
  v_sinlista uuid := tests.user('doctor'); v_sus uuid := tests.user('warehouse'); v_rech uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_l1 uuid; v_l2 uuid; v_o uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid(); r jsonb; f text; n numeric;
begin
  perform tests.act_as_service();
  update public.profiles set verified = false where id in (v_nov, v_rech);
  update public.profiles set meta = coalesce(meta, '{}'::jsonb) || '{"verification":{"status":"rejected"}}' where id = v_rech;
  insert into public.price_lists (name, is_default, sort) values ('CX0-Mayoreo', false, 1) returning id into v_l1;
  insert into public.price_lists (name, is_default, sort) values ('CX0-VIP', false, 2) returning id into v_l2;
  insert into public.product_prices (product_id, list_id, price) values (v_p, v_l1, 80), (v_p, v_l2, 50);
  insert into public.product_volume_prices (product_id, min_quantity, price, discount_percent) values (v_p, 5, 90, 10);
  update public.profiles set price_list_id = v_l1 where id in (v_doc, v_nov, v_rech);
  perform tests.act_as_owner();

  foreach f in array array['public.precio_de(%L, %L)', 'public.precio_de(%L, %L, 1)'] loop
    -- ══ A · anónimo: ni siquiera puede invocarla ══
    perform tests.act_as_anon();
    perform tests.throws('select ' || format(f, v_p, null), 'permission denied', 'ANON · ' || f || ' sin EXECUTE');

    -- ══ B · doctor pendiente / rechazado / sin perfil: denegado, también sin lista ══
    perform tests.act_as(v_nov);
    perform tests.throws('select ' || format(f, v_p, null), 'PRECIO_NO_AUTORIZADO', 'DOCTOR NO VERIFICADO · base denegada · ' || f);
    perform tests.throws('select ' || format(f, v_p, v_l1), 'PRECIO_NO_AUTORIZADO', 'DOCTOR NO VERIFICADO · su lista denegada · ' || f);
    perform tests.act_as(v_rech);
    perform tests.throws('select ' || format(f, v_p, v_l1), 'PRECIO_NO_AUTORIZADO', 'DOCTOR RECHAZADO · denegado · ' || f);
    perform tests.act_as(gen_random_uuid());
    perform tests.throws('select ' || format(f, v_p, null), 'PRECIO_NO_AUTORIZADO', 'AUTENTICADO SIN PERFIL · denegado · ' || f);

    -- ══ C · doctor verificado: base y SU lista; ninguna otra ══
    perform tests.act_as(v_doc);
    perform tests.eq((select public.precio_de(v_p, null, 1)), 100::numeric, 'DOCTOR VERIFICADO · base');
    execute 'select ' || format(f, v_p, v_l1) into n; perform tests.eq(n, 80::numeric, 'DOCTOR VERIFICADO · su lista · ' || f);
    perform tests.throws('select ' || format(f, v_p, v_l2), 'PRECIO_NO_AUTORIZADO', 'DOCTOR VERIFICADO · lista AJENA denegada · ' || f);
    perform tests.throws('select ' || format(f, v_p, gen_random_uuid()), 'PRECIO_NO_AUTORIZADO', 'DOCTOR VERIFICADO · lista inexistente denegada (no cae a General) · ' || f);
    perform tests.act_as(v_sinlista);
    execute 'select ' || format(f, v_p, null) into n; perform tests.eq(n, 100::numeric, 'DOCTOR VERIFICADO SIN LISTA · base · ' || f);
    perform tests.throws('select ' || format(f, v_p, v_l1), 'PRECIO_NO_AUTORIZADO', 'DOCTOR VERIFICADO SIN LISTA · no elige lista · ' || f);

    -- ══ D · chofer (puede_ver_precio sin lectura de listas): solo base ══
    perform tests.act_as(v_drv);
    execute 'select ' || format(f, v_p, null) into n; perform tests.eq(n, 100::numeric, 'CHOFER · base (como products_safe) · ' || f);
    perform tests.throws('select ' || format(f, v_p, v_l1), 'PRECIO_NO_AUTORIZADO', 'CHOFER · listas denegadas (como product_prices) · ' || f);

    -- ══ E · personal con lectura de listas: cualquier lista ══
    perform tests.act_as(v_admin);  execute 'select ' || format(f, v_p, v_l2) into n; perform tests.eq(n, 50::numeric, 'ADMIN · cualquier lista · ' || f);
    perform tests.act_as(v_bill);   execute 'select ' || format(f, v_p, v_l2) into n; perform tests.eq(n, 50::numeric, 'BILLING · cualquier lista · ' || f);
    perform tests.act_as(v_pos);    execute 'select ' || format(f, v_p, v_l1) into n; perform tests.eq(n, 80::numeric, 'POS · cualquier lista · ' || f);
    perform tests.act_as(v_wh);     execute 'select ' || format(f, v_p, v_l1) into n; perform tests.eq(n, 80::numeric, 'WAREHOUSE · cualquier lista · ' || f);
    perform tests.act_as(v_pack);   execute 'select ' || format(f, v_p, v_l1) into n; perform tests.eq(n, 80::numeric, 'PACKING · cualquier lista · ' || f);
    perform tests.act_as(v_comm);   execute 'select ' || format(f, v_p, v_l1) into n; perform tests.eq(n, 80::numeric, 'COMM · cualquier lista · ' || f);

    -- ══ F · contexto de servidor: service_role y BD sin JWT ══
    perform tests.act_as_service(); execute 'select ' || format(f, v_p, v_l2) into n; perform tests.eq(n, 50::numeric, 'SERVICE_ROLE · sin barrera · ' || f);
    perform tests.act_as_owner();   execute 'select ' || format(f, v_p, v_l2) into n; perform tests.eq(n, 50::numeric, 'BD SIN JWT · sin barrera · ' || f);
  end loop;

  -- ══ G · suspendido: falla cerrado; claims vacíos bajo rol de API no son "servidor" ══
  perform tests.suspender(v_sus, 'prueba cx0');
  perform tests.act_as(v_sus);
  perform tests.throws(format('select public.precio_de(%L, null, 1)', v_p), 'CUENTA_SUSPENDIDA', 'SUSPENDIDO · falla cerrado (no precio)');
  perform set_config('role', 'authenticated', true); perform set_config('request.jwt.claims', '{}', true);
  perform tests.throws(format('select public.precio_de(%L, null, 1)', v_p), 'PRECIO_NO_AUTORIZADO', 'authenticated con claims vacíos · NO se trata como servidor');
  perform set_config('request.jwt.claims', '', true);
  perform tests.throws(format('select public.precio_de(%L, null, 1)', v_p), 'PRECIO_NO_AUTORIZADO', 'authenticated sin claims · NO se trata como servidor');
  perform tests.act_as_owner();

  -- ══ H · el cálculo no cambió (lista, volumen, LEAST, inexistente) ══
  perform tests.eq(public.precio_de(v_p, v_l1, 1), 80::numeric, 'cálculo · lista');
  perform tests.eq(public.precio_de(v_p, v_l1, 5), 80::numeric, 'cálculo · least(lista, volumen)');
  perform tests.eq(public.precio_de(v_p, null, 5), 90::numeric, 'cálculo · volumen sobre base');
  perform tests.eq(public.precio_de(v_p, v_l2, 5), 50::numeric, 'cálculo · lista por debajo del volumen');
  perform tests.ok(public.precio_de(gen_random_uuid(), null, 1) is null, 'cálculo · producto inexistente → null (crear_pedido lo rechaza)');

  -- ══ I · consumidores indirectos ══
  -- crear_pedido: el doctor verificado cobra con SU lista; el no verificado no llega al precio.
  perform tests.act_as(v_doc);
  r := public.crear_pedido(v_o, null, v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 5)));
  perform tests.eq((r ->> 'total')::numeric, 400::numeric, 'crear_pedido · doctor verificado: 5 × 80 (su lista)');
  perform tests.act_as(v_nov);
  perform tests.throws(format('select public.crear_pedido(%L, null, %L, %L)', gen_random_uuid(), v_nov, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1))),
    'No autorizado', 'crear_pedido · no verificado: niega antes del precio');
  -- Dirección captura para un doctor: usa la lista de ESE doctor (personal con alcance de todas las listas).
  perform tests.act_as(v_admin);
  r := public.crear_pedido(v_o2, null, v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.eq((r ->> 'total')::numeric, 80::numeric, 'crear_pedido · Dirección para un doctor: lista del doctor');
  -- cc_ia_precio: solo la Edge (service_role); el perfil decide; no es una puerta para authenticated.
  perform tests.act_as_service();
  r := public.cc_ia_precio(v_doc, v_p, 1);
  perform tests.ok((r ->> 'autorizado')::boolean and (r ->> 'precio_unitario')::numeric = 80, 'cc_ia_precio (Edge) · doctor verificado: su lista');
  r := public.cc_ia_precio(v_nov, v_p, 1);
  perform tests.ok(not (r ->> 'autorizado')::boolean and r ->> 'motivo' = 'PRICE_REQUIRES_VERIFICATION' and r -> 'precio_unitario' is null, 'cc_ia_precio (Edge) · no verificado: sin precio');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.cc_ia_precio(%L, %L, 1)', v_nov, v_p), 'permission denied', 'cc_ia_precio · authenticated no puede invocarla (ni para otro perfil)');
  perform tests.act_as_owner();

  -- ══ J · privilegios y firma ══
  perform tests.ok(not has_function_privilege('anon', 'public.precio_de(uuid,uuid)', 'execute') and not has_function_privilege('anon', 'public.precio_de(uuid,uuid,integer)', 'execute'), 'anon sin EXECUTE en ambas firmas');
  perform tests.ok(has_function_privilege('authenticated', 'public.precio_de(uuid,uuid,integer)', 'execute'), 'authenticated conserva EXECUTE (la barrera está dentro)');
  perform tests.ok((select prosecdef and proconfig @> array['search_path=public'] from pg_proc where oid = 'public.precio_de(uuid,uuid,integer)'::regprocedure), 'precio_de/3 · SECURITY DEFINER con search_path fijo');
  perform tests.eq(md5(pg_get_functiondef('public.precio_de(uuid,uuid)'::regprocedure)), 'b256810a5e089355712bdeffcb423832', 'precio_de/2 · envoltorio sin cambios (hereda la barrera)');
end $t$;
rollback;
