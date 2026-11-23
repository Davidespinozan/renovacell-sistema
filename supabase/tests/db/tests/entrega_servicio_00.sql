-- PAQ-SIMPLE (20270407460000, 23 nov 2026) · al vender solo se elige la paquetería (DHL o Estafeta); el cliente paga SOLO
-- la regla; DHL promete la llegada MÁS TARDÍA de los servicios cotizados; si la cotización no sirve, el rango de la regla;
-- Estafeta: opción con la misma regla de precio y fecha por regla, apagable desde la configuración.
begin;
do $t$
declare q uuid := gen_random_uuid(); qv uuid := gen_random_uuid(); r jsonb; o jsonb; d1 uuid := tests.user('doctor'); v_admin uuid := tests.fixture_admin(); ok boolean; pr uuid; cart uuid; rv uuid; ord uuid;
begin
  perform tests.act_as_owner();
  insert into public.entrega_cotizaciones (id, proveedor, cp, piezas, paquete, servicios) values
    (q, 'dhl', '44100', 2, '{"kg":1.6}', '[{"codigo":"N","nombre":"EXPRESS DOMESTIC","costo":330.62,"llega_fecha":"2026-11-05","llega_at":"2026-11-05T23:59:00"},
                                         {"codigo":"1","nombre":"EXPRESS DOMESTIC 12:00","costo":421.68,"llega_fecha":"2026-11-04","llega_at":"2026-11-04T12:00:00"}]'),
    (qv, 'dhl', '44100', 2, '{}', '[{"codigo":"N","nombre":"EXPRESS DOMESTIC","costo":330.62,"llega_fecha":"2026-11-09"}]');
  update public.entrega_cotizaciones set expira_at = now() - interval '1 minute' where id = qv;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);   -- identidad del doctor, como la usan las funciones del servidor

  -- ══ 1 · DHL: la regla de precio y la llegada más tardía de los servicios cotizados ══
  r := public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', '1')));
  perform tests.ok((r ->> 'flete')::numeric = 600 and r ->> 'llega_desde' = '2026-11-05' and r ->> 'llega_hasta' = '2026-11-05' and r -> 'servicio' ->> 'llega_fecha' = '2026-11-05'
    and not (r -> 'servicio' ? 'diferencia') and not (r -> 'servicio' ? 'codigo'), '1 · DHL: flete = regla (600, sin recargo) y la fecha más tardía (5 nov); el servicio no queda atado');
  r := public._entrega_normalizar('doctor', 6000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q)));
  perform tests.ok((r ->> 'flete')::numeric = 0, '1 · desde 5,000 el envío es gratis, sin importar la cotización');

  -- ══ 2 · si la cotización no sirve, se vende con el rango de la regla (nunca se detiene la venta) ══
  r := public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', qv)));
  perform tests.ok((r ->> 'flete')::numeric = 600 and not (r ? 'servicio') and r ->> 'llega_desde' <> '2026-11-09', '2 · cotización vencida: el rango de la regla');
  r := public._entrega_normalizar('doctor', 1000, '64000', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q)));
  perform tests.ok(not (r ? 'servicio'), '2 · cotización de otra dirección: el rango de la regla');
  r := public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', 'no-es-uuid')));
  perform tests.ok(not (r ? 'servicio'), '2 · id de cotización inválido: el rango de la regla');
  r := public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl'));
  perform tests.ok((r ->> 'flete')::numeric = 600 and not (r ? 'servicio') and r ->> 'llega_desde' is not null and r ->> 'llega_hasta' >= r ->> 'llega_desde', '2 · sin cotización: la regla de siempre');

  -- ══ 3 · Estafeta: misma regla de precio, fecha por regla (2–4 días), sin cotización ══
  o := (select x from jsonb_array_elements(public.entrega_opciones('doctor', 1000, '44100') -> 'opciones') x where x ->> 'id' = 'foraneo_estafeta');
  perform tests.ok(o ->> 'paqueteria' = 'estafeta' and (o ->> 'flete')::numeric = 600 and (o ->> 'permitido')::boolean and (o ->> 'disponible')::boolean and o ->> 'texto' = 'Envío por Estafeta', '3 · la opción de Estafeta existe con la regla de precio');
  r := public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_estafeta', 'servicio', jsonb_build_object('cotizacion_id', q)));
  perform tests.ok(r ->> 'paqueteria' = 'estafeta' and (r ->> 'flete')::numeric = 600 and not (r ? 'servicio') and r ->> 'llega_desde' = o ->> 'llega_desde' and r ->> 'llega_hasta' = o ->> 'llega_hasta', '3 · Estafeta: la fecha de la regla (la cotización DHL no aplica)');
  perform tests.ok(o ->> 'llega_hasta' > o ->> 'llega_desde', '3 · Estafeta promete un rango (2 a 4 días)');
  perform tests.ok((select x ->> 'permitido' from jsonb_array_elements(public.entrega_opciones('doctor', 1000, '80020') -> 'opciones') x where x ->> 'id' = 'foraneo_estafeta') = 'false', '3 · en Culiacán Estafeta no aplica al doctor');

  -- ══ 4 · el personal: ajuste con motivo manda; Dirección apaga Estafeta y cambia sus días ══
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  r := public._entrega_normalizar('staff', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'flete', 0, 'motivo', 'cortesía al cliente', 'servicio', jsonb_build_object('cotizacion_id', q)));
  perform tests.ok((r ->> 'flete')::numeric = 0 and r -> 'servicio' ->> 'llega_fecha' = '2026-11-05', '4 · un ajuste del personal con motivo manda; la fecha sigue');
  perform tests.act_as(v_admin);
  r := public.entrega_config_guardar('{"estafeta_activo": false, "estafeta_transito_min": 3, "estafeta_transito_max": 6}');
  perform tests.ok(r ->> 'estafeta_activo' = 'false' and (r ->> 'estafeta_transito_min')::int = 3 and (r ->> 'estafeta_transito_max')::int = 6, '4 · Dirección edita Estafeta en la regla de entrega');
  perform tests.ok((select x ->> 'disponible' from jsonb_array_elements(public.entrega_opciones('staff', 1000, '44100') -> 'opciones') x where x ->> 'id' = 'foraneo_estafeta') = 'false', '4 · apagada, Estafeta no se ofrece');
  perform tests.throws($$select public.entrega_config_guardar('{"estafeta_transito_min": 5, "estafeta_transito_max": 2}')$$, 'ck_entcfg_estafeta', '4 · mínimo mayor que máximo no pasa');
  perform tests.act_as_owner();
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin perform public._entrega_normalizar('staff', 1000, '44100', '{"opcion":"foraneo_estafeta"}'); ok := false; exception when check_violation then ok := sqlerrm like 'ENTREGA_NO_DISPONIBLE%'; end;
  perform tests.ok(ok, '4 · ni se puede vender apagada');
  perform tests.act_as(v_admin);
  perform public.entrega_config_guardar('{"estafeta_activo": true, "estafeta_transito_min": 2, "estafeta_transito_max": 4}');

  -- ══ 5 · portal: revisar → confirmar con DHL; el pedido queda con la regla y la fecha prometida ══
  perform tests.act_as_service();
  pr := tests.producto_cat('Rellenos', 1000); perform tests.stock(pr, 'ENT-S', 50); perform tests.cliente(d1);
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, contact_phone, is_default) values (d1, 'Consultorio', 'Av. Juárez 1', '44100', 'Guadalajara', 'Jalisco', '3331234567', true);
  cart := (public.cc_carrito_abrir('doctor', null, d1) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart, 'doctor', null, d1, pr, 1, 'es1');
  perform tests.act_as(d1);
  r := public.cc_checkout_revisar(cart, null, null, jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', '1')));
  rv := (r ->> 'review_id')::uuid;
  perform tests.ok((r ->> 'listo')::boolean and (r ->> 'envio')::numeric = 600 and r -> 'entrega' ->> 'llega_hasta' = '2026-11-05', '5 · la revisión del portal cobra solo la regla y muestra la fecha prometida');
  r := public.cc_checkout_confirmar(rv, 'op-es-1');
  ord := (r ->> 'order_id')::uuid;
  perform tests.act_as_owner();
  perform tests.ok((select shipping_cost = 600 and total = 1600 and shipping_meta -> 'entrega' -> 'servicio' ->> 'llega_fecha' = '2026-11-05' and shipping_meta -> 'entrega' ->> 'paqueteria' = 'dhl' from public.orders where id = ord), '5 · el pedido queda con la regla y la promesa');
  perform tests.ok(not has_table_privilege('authenticated', 'public.entrega_cotizaciones', 'SELECT') and not has_function_privilege('authenticated', 'public._entrega_servicio(jsonb,jsonb,timestamptz)', 'EXECUTE'), '6 · cotizaciones y promesa, solo del servidor');
end $t$;
rollback;
