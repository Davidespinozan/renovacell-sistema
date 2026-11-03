-- SALIDA PROGRAMADA (20270320) · el personal agenda la salida (la regla se calcula como si fuera ese día); límites; el
-- doctor no programa; el chofer agenda desde esa fecha; la fecha exacta del servicio DHL se corre; reprogramar no cambia el precio.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); v_pos2 uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse'); d1 uuid := tests.user('doctor');
  p uuid; cu uuid; r jsonb; o uuid; ok boolean; v_norm date; v_prog date; v_dom date; q uuid := gen_random_uuid(); hor jsonb; tot numeric;
  mie timestamptz := '2026-10-21 10:00-07'::timestamptz;   -- miércoles 10:00 Culiacán
  dir jsonb := '{"line1":"Av. del Mar 10","colonia":"Centro","cp":"82000","city":"Mazatlán","state":"Sinaloa","phone":"6691234567"}';
begin
  perform tests.act_as_service();
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'SP-L', 50);
  cu := tests.cliente(d1);
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cu, v_pos) on conflict do nothing;
  perform tests.act_as_owner();
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- ══ 1 · regla como si fuera ese día ══
  v_norm := (select (x ->> 'salida')::date from jsonb_array_elements(public.entrega_opciones('staff', 1000, '82000', mie) -> 'opciones') x where x ->> 'id' = 'foraneo_dhl');
  v_prog := (select (x ->> 'salida')::date from jsonb_array_elements(public.entrega_opciones('staff', 1000, '82000', mie + interval '14 days') -> 'opciones') x where x ->> 'id' = 'foraneo_dhl');
  r := public._entrega_normalizar('staff', 1000, '82000', jsonb_build_object('opcion', 'foraneo_dhl', 'salida_programada', v_prog::text), mie);
  perform tests.ok((r ->> 'salida')::date = v_prog and (r ->> 'programada')::boolean and (r ->> 'llega_desde')::date > v_prog and (r ->> 'flete')::numeric = 600, '1 · sale el día agendado, con su promesa y el mismo flete');
  r := public._entrega_normalizar('staff', 1000, '82000', jsonb_build_object('opcion', 'foraneo_dhl', 'salida_programada', v_norm::text), mie);
  perform tests.ok(not (r ? 'programada'), '1 · agendar la salida de siempre no la marca como programada');

  -- ══ 2 · límites ══
  v_dom := v_prog + (7 - extract(dow from v_prog)::int) % 7;   -- el domingo de esa semana (sin salida de paquetería)
  begin perform public._entrega_normalizar('staff', 1000, '82000', jsonb_build_object('opcion', 'foraneo_dhl', 'salida_programada', v_dom::text), mie); ok := false; exception when check_violation then ok := sqlerrm like 'SALIDA_DIA_NO_VALIDO%'; end;
  perform tests.ok(ok, '2 · un día sin salida se rechaza diciendo cuál es la siguiente');
  begin perform public._entrega_normalizar('staff', 1000, '82000', jsonb_build_object('opcion', 'foraneo_dhl', 'salida_programada', (v_norm - 1)::text), mie); ok := false; exception when check_violation then ok := sqlerrm like 'SALIDA_ANTES_DE_TIEMPO%'; end;
  perform tests.ok(ok, '2 · no antes de lo que permite la regla');
  begin perform public._entrega_normalizar('staff', 1000, '82000', jsonb_build_object('opcion', 'foraneo_dhl', 'salida_programada', ((mie at time zone 'America/Mazatlan')::date + 120)::text), mie); ok := false; exception when check_violation then ok := sqlerrm like 'SALIDA_LEJANA%'; end;
  perform tests.ok(ok, '2 · hasta 90 días');
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);
  begin perform public._entrega_normalizar('doctor', 1000, '82000', jsonb_build_object('opcion', 'foraneo_dhl', 'salida_programada', v_prog::text), mie); ok := false; exception when check_violation then ok := sqlerrm like 'SALIDA_SOLO_PERSONAL%'; end;
  perform tests.ok(ok, '2 · el doctor no programa la salida (la agenda su asesor)');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- ══ 3 · servicio DHL: la fecha exacta cotizada se corre los mismos días ══
  perform tests.act_as_owner();
  insert into public.entrega_cotizaciones (id, proveedor, cp, piezas, paquete, servicios) values (q, 'dhl', '82000', 1, '{}',
    jsonb_build_array(jsonb_build_object('codigo', 'N', 'nombre', 'EXPRESS DOMESTIC', 'costo', 330, 'llega_fecha', (v_norm + 2)::text, 'llega_at', (v_norm + 2)::text || 'T23:59:00')));
  update public.entrega_cotizaciones set expira_at = mie + interval '2 hours' where id = q;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  r := public._entrega_normalizar('staff', 1000, '82000', jsonb_build_object('opcion', 'foraneo_dhl', 'salida_programada', v_prog::text, 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', 'N')), mie);
  perform tests.ok((r -> 'servicio' ->> 'llega_fecha')::date = v_prog + 2 and r ->> 'llega_hasta' = (v_prog + 2)::text and r -> 'servicio' ->> 'llega_at' like (v_prog + 2)::text || 'T23:59%', '3 · llega 2 días después de la salida agendada (como lo cotizó DHL)');

  -- ══ 4 · reprogramar un pedido hecho: no cambia el precio; permisos; motivo ══
  perform tests.act_as(v_pos);
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, d1, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), jsonb_build_object('address', dir), false, cu, null, '{"opcion":"foraneo_dhl"}');
  o := (r ->> 'order_id')::uuid; tot := (r ->> 'total')::numeric;
  v_prog := (select (x ->> 'salida')::date from jsonb_array_elements(public.entrega_opciones('staff', 1000, '82000', now() + interval '10 days') -> 'opciones') x where x ->> 'id' = 'foraneo_dhl');
  begin perform public.entrega_salida_programar(o, v_prog, null, ''); ok := false; exception when check_violation then ok := sqlerrm like 'MOTIVO_REQUERIDO%'; end;
  perform tests.ok(ok, '4 · pide motivo');
  perform tests.act_as(v_pos2);
  begin perform public.entrega_salida_programar(o, v_prog, null, 'el cliente lo pidió'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '4 · otro vendedor no mueve la salida de un pedido ajeno');
  perform tests.act_as(v_pos);
  r := public.entrega_salida_programar(o, v_prog, null, 'el cliente lo quiere para su apertura');
  perform tests.act_as_owner();
  perform tests.ok((select (shipping_meta -> 'entrega' ->> 'salida')::date = v_prog and (shipping_meta -> 'entrega' ->> 'programada')::boolean and total = tot and shipping_cost = 600
                      and shipping_meta -> 'entrega' -> 'reprogramado' ->> 'motivo' = 'el cliente lo quiere para su apertura' from public.orders where id = o), '4 · salida agendada, mismo total y flete, con su motivo');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'Salida del pedido agendada'), '4 · queda en la bitácora');
  perform tests.act_as(v_wh);
  r := public.entrega_salida_programar(o, (select (x ->> 'salida')::date from jsonb_array_elements(public.entrega_opciones('staff', 1000, '82000', now()) -> 'opciones') x where x ->> 'id' = 'foraneo_dhl'), null, 'el cliente lo necesita antes');
  perform tests.ok(not (r -> 'entrega' ? 'programada'), '4 · Almacén puede regresarla a la salida normal');
  perform tests.act_as_owner(); perform set_config('app.trusted', 'on', true); update public.orders set status = 'packed' where id = o; perform set_config('app.trusted', '', true);
  perform tests.act_as(v_admin);
  begin perform public.entrega_salida_programar(o, v_prog, null, 'tarde'); ok := false; exception when check_violation then ok := sqlerrm like 'PEDIDO_EN_CAMINO%'; end;
  perform tests.ok(ok, '4 · ya empacado no se mueve');
end $t$;
rollback;
