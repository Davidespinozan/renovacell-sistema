-- PAQ-A (148) · Rastreo de paquetería: lo escribe SOLO el servicio; lo lee quien ya ve el envío (logística, chofer
-- asignado, dueño del pedido). No toca shipments ni orders. "Entregado" es terminal; un error de consulta no borra lo conocido.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos'); v_bill uuid := tests.user('billing');
  dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); v_drv uuid := tests.user('driver'); v_drv2 uuid := tests.user('driver');
  p uuid := tests.product(100); oA uuid; oB uuid; sA uuid := gen_random_uuid(); sB uuid := gen_random_uuid(); sC uuid := gen_random_uuid(); r jsonb; n int; h0 text;
  ev jsonb := '[{"at":"2026-10-13T18:00:00Z","code":"PU","description":"Recolectado","location":"Culiacán"},{"at":"2026-10-13T22:10:00Z","code":"DF","description":"Salió de la instalación","location":"Culiacán"}]';
  F text := 'public.registrar_rastreo(uuid,text,text,text,text,timestamptz,jsonb,text)';
begin
  oA := tests.order(dA, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  oB := tests.order(dB, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  insert into public.shipments (id, order_id, carrier, tracking_number, status, provider) values (sA, oA, 'DHL', '1111111111', 'in_transit', 'dhl'), (sB, oB, 'DHL', '2222222222', 'in_transit', 'dhl');
  insert into public.shipments (id, order_id, driver_id, status) values (sC, oB, v_drv, 'despachado');
  h0 := (select md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.shipments s) || (select md5(string_agg(o.id::text || o.status, ',' order by o.id)) from public.orders o);

  -- ══ 0 · FORMA ══
  perform tests.ok(md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) = 'b1e791b99ca8043cb1e2913e0b294600'
               and md5(pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure)) = '3da25f3db1514408463b5fb38f61d0b6', '0.1 · shipments_guard y confirmar_entrega NO cambiaron');
  perform tests.ok(not has_function_privilege('authenticated', F, 'execute') and not has_function_privilege('anon', F, 'execute') and has_function_privilege('service_role', F, 'execute'), '0.2 · registrar_rastreo solo es del servicio');

  -- ══ A · ESCRITURA: solo el servicio ══
  perform tests.act_as(v_admin); perform tests.throws(format('select public.registrar_rastreo(%L, ''dhl'', ''en_transito'')', sA), 'permission denied', 'A1 · Dirección no escribe el rastreo');
  perform tests.act_as(v_wh);    perform tests.throws(format('select public.registrar_rastreo(%L, ''dhl'', ''entregado'')', sA), 'permission denied', 'A2 · Almacén tampoco');
  perform tests.act_as(dA);      perform tests.throws(format('select public.registrar_rastreo(%L, ''dhl'', ''entregado'')', sA), 'permission denied', 'A3 · ni el dueño del pedido');
  perform tests.act_as(dA);
  perform tests.throws(format('insert into public.shipment_tracking (shipment_id, provider, estado) values (%L, ''dhl'', ''entregado'')', sA), 'permission denied', 'A4 · sin INSERT directo en el rastreo');
  perform tests.throws(format('insert into public.shipment_tracking_events (shipment_id, ocurrido_at) values (%L, now())', sA), 'permission denied', 'A5 · sin INSERT directo en eventos');
  perform tests.act_as_service();
  r := public.registrar_rastreo(sA, 'dhl', 'sin_eventos');
  perform tests.ok(r ->> 'status' = 'registrado', 'A6 · el servicio registra "sin eventos todavía"');
  r := public.registrar_rastreo(sA, 'dhl', 'en_transito', 'Salió de la instalación', null, null, ev);
  perform tests.ok((r ->> 'eventos_nuevos')::int = 2 and (r ->> 'cambio')::boolean, 'A7 · registra estado y 2 eventos');
  r := public.registrar_rastreo(sA, 'dhl', 'en_transito', 'Salió de la instalación', null, null, ev);
  perform tests.ok((r ->> 'eventos_nuevos')::int = 0 and not (r ->> 'cambio')::boolean, 'A8 · repetir la misma consulta no duplica eventos ni reporta cambio');
  perform tests.throws(format('select public.registrar_rastreo(%L, ''dhl'', ''volando'')', sA), 'ESTADO_INVALIDO', 'A9 · estado desconocido rechazado');
  perform tests.throws(format('select public.registrar_rastreo(%L, ''dhl'', ''en_transito'')', gen_random_uuid()), 'ENVIO_INEXISTENTE', 'A10 · envío inexistente');
  perform tests.throws(format('select public.registrar_rastreo(%L, ''dhl'', ''en_transito'', null, null, null, %L::jsonb)', sA, '{"at":"x"}'), 'EVENTOS_INVALIDOS', 'A11 · eventos mal formados');
  r := public.registrar_rastreo(sA, 'dhl', 'en_transito', null, null, null, '[{"at":"no-es-fecha","code":"X"},{"code":"Y"}]'::jsonb);
  perform tests.ok((r ->> 'eventos_nuevos')::int = 0, 'A12 · un evento sin fecha válida se ignora sin romper la consulta');
  -- error de consulta: no borra lo conocido
  r := public.registrar_rastreo(sA, 'dhl', null, null, null, null, '[]'::jsonb, 'DHL 503');
  perform tests.ok((select estado = 'en_transito' and error = 'DHL 503' and ultimo_evento_at = '2026-10-13T22:10:00Z' from public.shipment_tracking where shipment_id = sA), 'A13 · un error de consulta se anota y NO borra el último estado conocido');
  -- entregado, con firma; terminal
  r := public.registrar_rastreo(sA, 'dhl', 'entregado', 'Entregado', 'JUAN PEREZ', '2026-10-14T16:30:00Z', '[{"at":"2026-10-14T16:30:00Z","code":"OK","description":"Entregado"}]'::jsonb);
  perform tests.ok((select estado = 'entregado' and firmado_por = 'JUAN PEREZ' and entregado_at = '2026-10-14T16:30:00Z' and error is null from public.shipment_tracking where shipment_id = sA), 'A14 · entregado: guarda quién firmó y cuándo; limpia el error');
  r := public.registrar_rastreo(sA, 'dhl', 'en_transito', 'respuesta vieja');
  perform tests.ok(r ->> 'status' = 'sin_cambio' and (select estado = 'entregado' and firmado_por = 'JUAN PEREZ' from public.shipment_tracking where shipment_id = sA), 'A15 · "entregado" es terminal: una respuesta posterior no lo degrada');
  perform tests.ok((select count(*) = 3 from public.shipment_tracking_events where shipment_id = sA), 'A16 · historial: 3 eventos, sin duplicados');

  -- ══ B · LECTURA: quien ve el envío ══
  perform public.registrar_rastreo(sB, 'dhl', 'en_reparto', 'Con el repartidor', null, null, '[{"at":"2026-10-14T15:00:00Z","code":"WC","description":"Con el repartidor"}]'::jsonb);
  perform public.registrar_rastreo(sC, 'dhl', 'en_transito');
  perform tests.act_as(dA);
  perform tests.ok((select count(*) = 1 and min(shipment_id::text) = sA::text from public.shipment_tracking) and (select count(*) = 3 from public.shipment_tracking_events), 'B1 · el doctor ve SOLO el rastreo de su pedido');
  perform tests.act_as(dB);
  perform tests.ok((select count(*) = 2 from public.shipment_tracking) and not exists (select 1 from public.shipment_tracking where shipment_id = sA), 'B2 · otro doctor ve los suyos y NO el ajeno');
  perform tests.act_as(v_wh);  perform tests.ok((select count(*) = 3 from public.shipment_tracking), 'B3 · Almacén ve todos');
  perform tests.act_as(v_admin); perform tests.ok((select count(*) = 3 from public.shipment_tracking) and (select count(*) = 4 from public.shipment_tracking_events), 'B4 · Dirección ve todos');
  perform tests.act_as(v_drv); perform tests.ok((select count(*) = 1 and min(shipment_id::text) = sC::text from public.shipment_tracking), 'B5 · el chofer ve solo el de su envío');
  perform tests.act_as(v_drv2); perform tests.ok((select count(*) = 0 from public.shipment_tracking) and (select count(*) = 0 from public.shipment_tracking_events), 'B6 · otro chofer no ve nada');
  perform tests.act_as(v_pos); perform tests.ok((select count(*) = 0 from public.shipment_tracking), 'B7 · Ventas no gana lectura nueva (no ve envíos)');
  perform tests.act_as(v_bill); perform tests.ok((select count(*) = 0 from public.shipment_tracking), 'B8 · Facturación tampoco');
  perform tests.act_as_anon(); perform tests.throws('select count(*) from public.shipment_tracking', 'permission denied', 'B9 · anónimo: sin lectura');
  perform tests.act_as(v_wh);
  perform tests.sin_efecto(format('update public.shipment_tracking set estado = ''entregado'', entregado_at = now() where shipment_id = %L', sB), format('select estado from public.shipment_tracking where shipment_id = %L', sB), 'en_reparto', 'B10 · Almacén no puede editar el rastreo a mano');
  perform tests.sin_efecto(format('delete from public.shipment_tracking_events where shipment_id = %L', sA), format('select count(*)::text from public.shipment_tracking_events where shipment_id = %L', sA), '3', 'B11 · ni borrar eventos');

  -- ══ C · SIN EFECTOS FUERA DEL RASTREO ══
  perform tests.act_as_owner();
  perform tests.eq((select md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.shipments s) || (select md5(string_agg(o.id::text || o.status, ',' order by o.id)) from public.orders o), h0,
    'C1 · registrar el rastreo (incluido "entregado") NO cambió envíos ni pedidos: el cierre sigue siendo de confirmar_entrega');
  delete from public.shipments where id = sC;
  perform tests.ok(not exists (select 1 from public.shipment_tracking where shipment_id = sC), 'C2 · al borrar un envío se va su rastreo');
end $t$;
rollback;
