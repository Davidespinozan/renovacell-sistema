-- PAQUETERÍA ELEGIDA AL VENDER (20270314) · el servicio elegido se valida contra la cotización, deja la FECHA EXACTA y
-- cobra la regla de siempre + la diferencia del servicio más rápido; sin servicio, la regla de siempre.
begin;
do $t$
declare q uuid := gen_random_uuid(); qv uuid := gen_random_uuid(); r jsonb; ok boolean; d1 uuid := tests.user('doctor'); v_admin uuid := tests.fixture_admin(); pr uuid; cart uuid; rv uuid; ord uuid;
begin
  perform tests.act_as_owner();
  insert into public.entrega_cotizaciones (id, proveedor, cp, piezas, paquete, servicios) values
    (q, 'dhl', '44100', 2, '{"kg":1.6}', '[{"codigo":"N","nombre":"EXPRESS DOMESTIC","costo":330.62,"llega_fecha":"2026-11-05","llega_at":"2026-11-05T23:59:00"},
                                         {"codigo":"1","nombre":"EXPRESS DOMESTIC 12:00","costo":421.68,"llega_fecha":"2026-11-05","llega_at":"2026-11-05T12:00:00"}]'),
    (qv, 'dhl', '44100', 2, '{}', '[{"codigo":"N","nombre":"EXPRESS DOMESTIC","costo":330.62,"llega_fecha":"2026-11-05"}]');
  update public.entrega_cotizaciones set expira_at = now() - interval '1 minute' where id = qv;
  perform set_config('request.jwt.claims', json_build_object('sub', d1, 'role', 'authenticated')::text, true);   -- identidad del doctor, como la usan las funciones del servidor

  r := public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', 'N')));
  perform tests.ok((r ->> 'flete')::numeric = 600 and r ->> 'llega_desde' = '2026-11-05' and r ->> 'llega_hasta' = '2026-11-05' and r -> 'servicio' ->> 'nombre' = 'EXPRESS DOMESTIC', '1 · servicio normal: la regla (600) y la fecha exacta');
  r := public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', '1')));
  perform tests.ok((r ->> 'flete')::numeric = 692 and (r -> 'servicio' ->> 'diferencia')::numeric = 92, '1 · más rápido: regla + la diferencia (92)');
  r := public._entrega_normalizar('doctor', 6000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', '1')));
  perform tests.ok((r ->> 'flete')::numeric = 92, '1 · desde 5,000 el normal es gratis; el rápido paga solo la diferencia');

  begin perform public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', 'X'))); ok := false; exception when check_violation then ok := sqlerrm like 'ENTREGA_SERVICIO_INVALIDO%'; end;
  perform tests.ok(ok, '2 · un servicio que no se cotizó no pasa');
  begin perform public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', qv, 'codigo', 'N'))); ok := false; exception when check_violation then ok := sqlerrm like 'ENTREGA_COTIZACION_VENCIDA%'; end;
  perform tests.ok(ok, '2 · cotización vencida: se vuelve a cotizar');
  begin perform public._entrega_normalizar('doctor', 1000, '64000', jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', 'N'))); ok := false; exception when check_violation then ok := sqlerrm like 'ENTREGA_COTIZACION_INVALIDA%'; end;
  perform tests.ok(ok, '2 · cotización de otra dirección no pasa');

  r := public._entrega_normalizar('doctor', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl'));
  perform tests.ok((r ->> 'flete')::numeric = 600 and not (r ? 'servicio') and r ->> 'llega_desde' is not null, '3 · sin servicio (o si la paquetería no respondió): la regla de siempre');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  r := public._entrega_normalizar('staff', 1000, '44100', jsonb_build_object('opcion', 'foraneo_dhl', 'flete', 0, 'motivo', 'cortesía al cliente', 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', '1')));
  perform tests.ok((r ->> 'flete')::numeric = 0 and r -> 'servicio' ->> 'codigo' = '1', '3 · un ajuste del personal con motivo manda');
  -- ══ 5 · portal: revisar → confirmar con el servicio elegido; el pedido queda con su fecha exacta y el flete ══
  perform tests.act_as_service();
  pr := tests.producto_cat('Rellenos', 1000); perform tests.stock(pr, 'ENT-S', 50); perform tests.cliente(d1);
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, contact_phone, is_default) values (d1, 'Consultorio', 'Av. Juárez 1', '44100', 'Guadalajara', 'Jalisco', '3331234567', true);
  cart := (public.cc_carrito_abrir('doctor', null, d1) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart, 'doctor', null, d1, pr, 1, 'es1');
  perform tests.act_as(d1);
  r := public.cc_checkout_revisar(cart, null, null, jsonb_build_object('opcion', 'foraneo_dhl', 'servicio', jsonb_build_object('cotizacion_id', q, 'codigo', '1')));
  rv := (r ->> 'review_id')::uuid;
  perform tests.ok((r ->> 'listo')::boolean and (r ->> 'envio')::numeric = 692 and r -> 'entrega' -> 'servicio' ->> 'codigo' = '1' and r -> 'entrega' ->> 'llega_hasta' = '2026-11-05', '5 · la revisión del portal cobra regla + diferencia y muestra la fecha exacta');
  r := public.cc_checkout_confirmar(rv, 'op-es-1');
  ord := (r ->> 'order_id')::uuid;
  perform tests.act_as_owner();
  perform tests.ok((select shipping_cost = 692 and total = 1692 and shipping_meta -> 'entrega' -> 'servicio' ->> 'nombre' = 'EXPRESS DOMESTIC 12:00' from public.orders where id = ord), '5 · el pedido queda con el servicio elegido y su flete');
  perform tests.ok(not has_table_privilege('authenticated', 'public.entrega_cotizaciones', 'SELECT') and not has_function_privilege('authenticated', 'public._entrega_servicio(jsonb,jsonb,timestamptz)', 'EXECUTE'), '4 · cotizaciones y validación, solo del servidor');
end $t$;
rollback;
