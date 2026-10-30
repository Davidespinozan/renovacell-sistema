-- ENT-0 (171) · ENTREGA DEL PEDIDO. La regla vive en el servidor: doctor en su portal (foráneo ≥ $5,000 gratis, si no $600;
-- (huellas de crear_pedido / vender_pos / precio re-ancladas por MAYOREO-REGLAS 20270222: precio con el pedido completo)
-- local ≥ $500 chofer gratis, si no recoge), personal en punto de venta (todas las opciones, flete propuesto y ajustable con
-- motivo); corte 15:30 hora local (antes sale hoy); días de salida y tránsito; la promesa (salida, llega desde/hasta) siempre
-- viaja con el pedido; el flete entra al total y solo lo escribe el servidor; recoger no exige dirección; permisos.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor');
  cu uuid; cuD uuid; p uuid; o jsonb; r jsonb; e jsonb; ops jsonb; n int; ord uuid; ord2 uuid; ord3 uuid; cart uuid; rv uuid; t0 numeric; k uuid; loc uuid;
  mie timestamptz := '2026-10-21 14:00-07'::timestamptz;   -- miércoles 14:00 Culiacán (antes del corte)
  mie_tarde timestamptz := '2026-10-21 15:30-07'::timestamptz;   -- miércoles 15:30 (ya no sale hoy)
  sab timestamptz := '2026-10-24 11:00-07'::timestamptz;   -- sábado antes del corte
  dom timestamptz := '2026-10-25 11:00-07'::timestamptz;   -- domingo
  dir jsonb := '{"line1":"Av. del Mar 10","colonia":"Centro","cp":"82000","city":"Mazatlán","state":"Sinaloa","phone":"6691234567"}'::jsonb;
  dir_loc jsonb := '{"line1":"Blvd. Culiacán 100","colonia":"Centro","cp":"80020","city":"Culiacán","state":"Sinaloa","phone":"6671234567"}'::jsonb;
  lin jsonb; lin_chica jsonb; lin_grande jsonb;
  f_h text; i_h text; hor jsonb; hor2 jsonb;   -- ENT-H (189): la entrega local por chofer exige un horario; se toma el primero disponible
  SIG text := 'public.crear_pedido_con_entrega(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb,jsonb)';
  function_count int;
begin
  perform tests.act_as_service();
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'ENT-L', 100);
  insert into public.customers (full_name, phone, source) values ('Cliente Entrega', '6670001111', 'odoo') returning id into cu;
  cuD := tests.cliente(v_doc); perform tests.cliente(v_doc2);
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, contact_phone, is_default) values (v_doc, 'Consultorio', 'Av. del Mar 10', '82000', 'Mazatlán', 'Sinaloa', '6691234567', true) returning id into loc;
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, contact_phone, is_default) values (v_doc2, 'Consultorio', 'Blvd. Culiacán 100', '80020', 'Culiacán', 'Sinaloa', '6671234567', true);
  lin := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2));          -- 2,000
  lin_chica := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1));    -- 1,000 (< 5,000 foráneo; ≥ 500 local)
  lin_grande := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 5));   -- 5,000 (envío gratis)
  perform tests.act_as_owner();
  perform tests.act_as(v_pos);
  select dd ->> 'fecha', x ->> 'inicio' into f_h, i_h from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where (x ->> 'disponible')::boolean limit 1;
  hor := jsonb_build_object('fecha', f_h, 'inicio', i_h);
  select jsonb_build_object('fecha', dd ->> 'fecha', 'inicio', x ->> 'inicio') into hor2 from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where (x ->> 'disponible')::boolean offset 1 limit 1;   -- otro horario (el cupo es 1)
  perform tests.act_as_owner();

  -- ══ 0 · forma y permisos ════════════════════════════════════════════════════════════════════════
  perform tests.ok(md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) = '62039cc835b93f7c0119b1c54c774495'
               and md5(pg_get_functiondef('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure)) = '5769c551e6ca60003ba0fcf9390d80d1', '0.1 · crear_pedido y crear_pedido_con_receptor NO cambiaron');
  select count(*) into function_count from pg_proc where pronamespace = 'public'::regnamespace and proname in ('cc_checkout_revisar', 'cc_checkout_confirmar');
  perform tests.eq(function_count, 2, '0.2 · una sola firma de revisar y de confirmar');
  perform tests.ok(has_function_privilege('authenticated', SIG, 'execute') and not has_function_privilege('anon', SIG, 'execute')
               and not has_function_privilege('authenticated', 'public._entrega_aplicar(uuid,jsonb)', 'execute')
               and not has_function_privilege('authenticated', 'public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)', 'execute')
               and not has_table_privilege('authenticated', 'public.entrega_config', 'select'), '0.3 · permisos: el pedido con entrega es de authenticated; lo interno y la configuración no');
  perform tests.eq((select count(*)::int from public.entrega_config), 1, '0.4 · una configuración');
  perform tests.eq((select shipping_cost from public.orders limit 1), null::numeric, '0.5 · (sin pedidos aún) la columna existe');
  perform tests.act_as_anon();
  perform tests.throws('select public.entrega_opciones(''doctor'', 100, ''80020'')', 'permission denied', '0.6 · anónimo no consulta opciones');
  perform tests.act_as(v_doc);
  perform tests.throws('select public.entrega_opciones(''otro'', 100, ''80020'')', 'ENTREGA_ACTOR_INVALIDO', '0.7 · actor desconocido');
  perform tests.ok((public.entrega_config_ver() ->> 'corte') = '15:30:00' and (public.entrega_config_ver() ->> 'foraneo_costo')::numeric = 600, '0.8 · el doctor lee la regla (para mostrarla)');
  perform tests.throws('select public.entrega_config_guardar(''{"foraneo_costo": 1}'')', 'NO_AUTORIZADO', '0.9 · el doctor no cambia la regla');
  perform tests.act_as(v_pos);
  perform tests.throws('select public.entrega_config_guardar(''{"foraneo_costo": 1}'')', 'NO_AUTORIZADO', '0.10 · Ventas tampoco');

  -- ══ 1 · opciones del DOCTOR ═══════════════════════════════════════════════════════════════════════
  perform tests.act_as(v_doc);
  ops := public.entrega_opciones('doctor', 1000, '82000', mie);   -- foráneo, < 5,000
  perform tests.ok(not (ops ->> 'local')::boolean and ops ->> 'sugerida' = 'foraneo_dhl', '1.1 · CP de Mazatlán es foráneo; sugiere DHL');
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'foraneo_dhl';
  perform tests.ok((o ->> 'permitido')::boolean and (o ->> 'flete')::numeric = 600 and o ->> 'salida' = '2026-10-21' and o ->> 'llega_desde' = '2026-10-22' and o ->> 'llega_hasta' = '2026-10-26',
    '1.2 · DHL bajo $5,000: $600; antes del corte sale hoy (miércoles); llega jueves a lunes (1–3 días hábiles)');
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'local_chofer';
  perform tests.ok(not (o ->> 'permitido')::boolean and o ->> 'motivo' = 'ZONA_FORANEA', '1.3 · el chofer no va a Mazatlán');
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'mostrador';
  perform tests.ok(not (o ->> 'permitido')::boolean and o ->> 'motivo' = 'SOLO_PERSONAL', '1.4 · mostrador es del personal');
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'foraneo_t1';
  perform tests.ok(not (o ->> 'disponible')::boolean, '1.5 · T1 apagado hasta integrarlo');
  select x into o from jsonb_array_elements(public.entrega_opciones('doctor', 5000, '82000', mie) -> 'opciones') x where x ->> 'id' = 'foraneo_dhl';
  perform tests.eq((o ->> 'flete')::numeric, 0::numeric, '1.6 · desde $5,000 el envío foráneo es gratis');
  ops := public.entrega_opciones('doctor', 1000, '80020', mie);   -- local, ≥ 500
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'local_chofer';
  perform tests.ok((ops ->> 'local')::boolean and ops ->> 'sugerida' = 'local_chofer' and (o ->> 'permitido')::boolean and (o ->> 'flete')::numeric = 0 and o ->> 'llega_desde' = '2026-10-21',
    '1.7 · Culiacán ≥ $500: chofer gratis, el mismo día si entra antes del corte');
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'foraneo_dhl';
  perform tests.ok(not (o ->> 'permitido')::boolean and o ->> 'motivo' = 'ZONA_LOCAL', '1.8 · en Culiacán no se ofrece DHL al doctor');
  ops := public.entrega_opciones('doctor', 450, '80020', mie);   -- local, < 500
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'local_chofer';
  perform tests.ok(ops ->> 'sugerida' = 'recoge' and not (o ->> 'permitido')::boolean and o ->> 'motivo' = 'MINIMO_LOCAL', '1.9 · Culiacán < $500: pasa a recoger');
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'recoge';
  perform tests.ok((o ->> 'permitido')::boolean and (o ->> 'flete')::numeric = 0 and ops -> 'recoge' ->> 'lugar' like 'Sucursal%', '1.10 · recoger siempre se puede, sin cargo, con el lugar');
  ops := public.entrega_opciones('doctor', 1000, null, mie);
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'foraneo_dhl';
  perform tests.ok(ops ->> 'sugerida' is null and not (o ->> 'permitido')::boolean and o ->> 'motivo' = 'REQUIERE_DIRECCION', '1.11 · sin CP no hay envío a domicilio (ni sugerencia)');

  -- ══ 2 · opciones del PERSONAL y el calendario ═════════════════════════════════════════════════════
  perform tests.act_as(v_pos);
  ops := public.entrega_opciones('staff', 450, '82000', mie);
  perform tests.ok((select bool_and((x ->> 'permitido')::boolean) from jsonb_array_elements(ops -> 'opciones') x), '2.1 · el personal puede elegir cualquier entrega');
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = 'local_chofer';
  perform tests.eq((o ->> 'flete')::numeric, 0::numeric, '2.2 · chofer bajo el mínimo: flete propuesto $0 (configurable)');
  select x into o from jsonb_array_elements(public.entrega_opciones('staff', 1000, '82000', mie_tarde) -> 'opciones') x where x ->> 'id' = 'foraneo_dhl';
  perform tests.ok(not (o ->> 'antes_de_corte')::boolean and o ->> 'salida' = '2026-10-22' and o ->> 'llega_desde' = '2026-10-23' and o ->> 'llega_hasta' = '2026-10-27', '2.3 · a las 15:30 ya no sale hoy: sale jueves, llega viernes a martes');
  select x into o from jsonb_array_elements(public.entrega_opciones('staff', 1000, '82000', sab) -> 'opciones') x where x ->> 'id' = 'foraneo_dhl';
  perform tests.ok(o ->> 'salida' = '2026-10-26' and o ->> 'llega_desde' = '2026-10-27', '2.4 · sábado: la paquetería no recolecta; sale el lunes');
  select x into o from jsonb_array_elements(public.entrega_opciones('staff', 1000, '80020', sab) -> 'opciones') x where x ->> 'id' = 'local_chofer';
  perform tests.ok(o ->> 'salida' = '2026-10-24' and o ->> 'llega_desde' = '2026-10-24', '2.5 · sábado: el chofer sí sale (lunes a sábado)');
  select x into o from jsonb_array_elements(public.entrega_opciones('staff', 1000, '80020', dom) -> 'opciones') x where x ->> 'id' = 'recoge';
  perform tests.ok(o ->> 'salida' = '2026-10-26' and o ->> 'llega_desde' = '2026-10-26', '2.6 · domingo: listo para recoger el lunes');
  perform tests.act_as_owner();
  insert into public.cc_horario_excepciones (fecha, tipo, motivo) values ('2026-10-22', 'cerrado', 'Prueba');
  perform tests.act_as(v_pos);
  select x into o from jsonb_array_elements(public.entrega_opciones('staff', 1000, '82000', mie_tarde) -> 'opciones') x where x ->> 'id' = 'foraneo_dhl';
  perform tests.ok(o ->> 'salida' = '2026-10-23' and o ->> 'llega_desde' = '2026-10-26', '2.7 · un día cerrado (excepción del horario) no cuenta: sale el viernes, llega desde el lunes');
  perform tests.act_as_owner(); delete from public.cc_horario_excepciones where fecha = '2026-10-22'; perform tests.act_as(v_pos);
  perform tests.ok((public.entrega_opciones('staff', 1000, '82000', mie) -> 'corte' ->> 'hora') = '15:30' and (public.entrega_opciones('staff', 1000, '82000', mie) -> 'corte' ->> 'zona') = 'America/Mazatlan', '2.8 · el corte y la zona viajan con las opciones');

  -- ══ 3 · pedido del PERSONAL con entrega (crear_pedido_con_entrega) ═══════════════════════════════
  perform tests.act_as(v_pos);
  ord := gen_random_uuid();
  r := public.crear_pedido_con_entrega(ord, null, null, lin, jsonb_build_object('address', dir), false, cu, null, '{"opcion":"foraneo_dhl"}');
  perform tests.ok((r ->> 'subtotal')::numeric = 2000 and (r ->> 'envio')::numeric = 600 and (r ->> 'total')::numeric = 2600 and r -> 'entrega' ->> 'opcion' = 'foraneo_dhl' and r -> 'entrega' ->> 'paqueteria' = 'dhl' and (r -> 'entrega' ->> 'salida') is not null and (r -> 'entrega' ->> 'llega_hasta') is not null,
    '3.1 · pedido 2,000 + DHL 600 = 2,600 con promesa (salida, llega desde/hasta)');
  perform tests.act_as_owner();
  perform tests.ok((select total = 2600 and shipping_cost = 600 and shipping_meta -> 'entrega' ->> 'tipo' = 'foraneo' and (shipping_meta -> 'entrega' ->> 'flete')::numeric = 600 and shipping_meta -> 'address' ->> 'cp' = '82000' from public.orders where id = ord), '3.2 · en el pedido: total con flete, shipping_cost y la entrega en shipping_meta');
  perform tests.eq((select sum(qty * unit_price) from public.order_items where order_id = ord), 2000::numeric, '3.3 · los renglones siguen siendo solo productos');
  perform tests.eq((select saldo from public.v_order_money where order_id = ord), 2600::numeric, '3.4 · el saldo a cobrar incluye el flete');
  perform tests.act_as(v_pos);
  r := public.crear_pedido_con_entrega(ord, null, null, lin, jsonb_build_object('address', dir), false, cu, null, '{"opcion":"foraneo_dhl"}');
  perform tests.ok((r ->> 'idempotent')::boolean and (r ->> 'total')::numeric = 2600 and (r ->> 'envio')::numeric = 600 and r -> 'entrega' ->> 'opcion' = 'foraneo_dhl', '3.5 · reintento: el mismo pedido, sin volver a cobrar el flete');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.orders where id = ord), 1, '3.5 · un solo pedido');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, ''{"opcion":"foraneo_dhl"}'')', ord, lin, jsonb_build_object('address', dir_loc), cu), 'PEDIDO_EXISTENTE_CONFLICTO', '3.6 · otro contenido con el mismo id: conflicto (la regla de la 147)');
  -- ajuste del flete por el personal: con motivo sí, sin motivo no
  ord2 := gen_random_uuid();
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, ''{"opcion":"foraneo_dhl","flete":0}'')', ord2, lin, jsonb_build_object('address', dir), cu), 'ENTREGA_AJUSTE_SIN_MOTIVO', '3.7 · regalar el envío exige motivo');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.orders where id = ord2), 0, '3.7 · y no se creó nada');
  perform tests.act_as(v_pos);
  r := public.crear_pedido_con_entrega(ord2, null, null, lin, jsonb_build_object('address', dir), false, cu, null, '{"opcion":"foraneo_dhl","flete":0,"motivo":"Cortesía por volumen"}');
  perform tests.ok((r ->> 'total')::numeric = 2000 and (r ->> 'envio')::numeric = 0 and (r -> 'entrega' ->> 'flete_regla')::numeric = 600 and r -> 'entrega' ->> 'ajuste_motivo' = 'Cortesía por volumen', '3.8 · flete ajustado con motivo; la regla queda registrada');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, ''{"opcion":"foraneo_dhl","flete":-5,"motivo":"x"}'')', gen_random_uuid(), lin, jsonb_build_object('address', dir), cu), 'ENTREGA_FLETE_INVALIDO', '3.9 · flete negativo');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, ''{"opcion":"dron"}'')', gen_random_uuid(), lin, jsonb_build_object('address', dir), cu), 'ENTREGA_INVALIDA', '3.10 · opción desconocida');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, null)', gen_random_uuid(), lin, jsonb_build_object('address', dir), cu), 'ENTREGA_REQUERIDA', '3.11 · sin entrega no hay pedido');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, ''{}'', false, %L, null, ''{"opcion":"local_chofer"}'')', gen_random_uuid(), lin, cu), 'ENTREGA_SIN_DIRECCION', '3.12 · chofer sin domicilio: no');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, ''{"opcion":"foraneo_t1"}'')', gen_random_uuid(), lin, jsonb_build_object('address', dir), cu), 'ENTREGA_NO_DISPONIBLE', '3.13 · T1 apagado');
  ord3 := gen_random_uuid();
  r := public.crear_pedido_con_entrega(ord3, null, null, lin_chica, '{}'::jsonb, false, cu, null, '{"opcion":"recoge"}');
  perform tests.ok((r ->> 'total')::numeric = 1000 and (r ->> 'envio')::numeric = 0 and r -> 'entrega' -> 'recoge' ->> 'lugar' like 'Sucursal%' and (r -> 'entrega' ->> 'llega_desde') is not null, '3.14 · recoger: sin domicilio, sin flete, con el lugar y el día en que está listo');
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, null, lin_grande, jsonb_build_object('address', dir), false, cu, null, '{"opcion":"foraneo_dhl"}');
  perform tests.ok((r ->> 'total')::numeric = 5000 and (r ->> 'envio')::numeric = 0, '3.15 · 5,000 foráneo: envío gratis');
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, null, lin, jsonb_build_object('address', dir), false, cu, null, '{"opcion":"mostrador"}');
  perform tests.ok((r ->> 'envio')::numeric = 0 and r -> 'entrega' ->> 'tipo' = 'mostrador', '3.16 · mostrador: el cliente se lo lleva');
  -- con factura: pasa por crear_pedido_con_receptor (receptor congelado) y la entrega en la misma transacción
  k := gen_random_uuid();
  r := public.crear_pedido_con_entrega(k, null, null, lin, jsonb_build_object('address', dir), true, cu, tests.fiscal('XAXX010101000'), '{"opcion":"foraneo_dhl"}');
  perform tests.act_as_owner();
  perform tests.ok((select invoice_requested and invoice_meta -> 'receiver' ->> 'rfc' = 'XAXX010101000' and total = 2600 and shipping_cost = 600 from public.orders where id = k), '3.17 · con factura: receptor congelado + flete, todo en una transacción');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, true, %L, null, ''{"opcion":"foraneo_dhl"}'')', gen_random_uuid(), lin, jsonb_build_object('address', dir), cu), 'DATOS_FISCALES_REQUERIDOS', '3.18 · con factura sin receptor: la regla de la 147 sigue');
  -- el personal también puede pedir a nombre de un doctor con la regla del personal (elige él)
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, v_doc, lin_chica, jsonb_build_object('address', dir), false, cuD, null, jsonb_build_object('opcion', 'local_chofer', 'horario', hor));   -- ENT-H: con horario
  perform tests.ok(r -> 'entrega' ->> 'actor' = 'staff' and (r ->> 'envio')::numeric = 0, '3.19 · a nombre de un doctor: el personal decide (chofer a Mazatlán, bajo su responsabilidad)');

  -- ══ 4 · el doctor por el flujo directo: la regla estricta ═════════════════════════════════════════
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, %L, %L, %L, false, null, null, ''{"opcion":"local_chofer"}'')', gen_random_uuid(), v_doc, lin_chica, jsonb_build_object('address', dir)), 'ENTREGA_NO_PERMITIDA: ZONA_FORANEA', '4.1 · doctor de Mazatlán no elige chofer');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, %L, %L, %L, false, null, null, ''{"opcion":"mostrador"}'')', gen_random_uuid(), v_doc, lin_chica, jsonb_build_object('address', dir)), 'ENTREGA_NO_PERMITIDA: SOLO_PERSONAL', '4.2 · ni mostrador');
  k := gen_random_uuid();
  r := public.crear_pedido_con_entrega(k, null, v_doc, lin_chica, jsonb_build_object('address', dir), false, null, null, '{"opcion":"foraneo_dhl","flete":0,"motivo":"yo me lo regalo"}');
  perform tests.ok((r ->> 'envio')::numeric = 600 and (r ->> 'total')::numeric = 1600 and (r -> 'entrega' ->> 'ajuste_motivo') is null, '4.3 · el doctor no ajusta el flete: se ignora lo que mande');
  perform tests.throws(format('update public.orders set shipping_cost = 0 where id = %L', k), 'FLETE_SOLO_POR_COMANDO', '4.4 · el flete no se edita a mano');
  perform tests.throws(format('update public.orders set total = 1000 where id = %L', k), 'No autorizado', '4.5 · ni el total');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, %L, %L, %L, false, %L, null, ''{"opcion":"recoge"}'')', gen_random_uuid(), v_doc, lin_chica, '{}'::jsonb, cu), 'PAR_INCONSISTENTE', '4.6 · (sanidad) la pareja comprador/cuenta la sigue validando crear_pedido');

  -- ══ 5 · checkout del doctor (portal) ══════════════════════════════════════════════════════════════
  perform tests.act_as_service();
  cart := (public.cc_carrito_abrir('doctor', null, v_doc) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart, 'doctor', null, v_doc, p, 2, 'e1');
  perform tests.act_as(v_doc);
  r := public.cc_checkout_revisar(cart);
  perform tests.ok(not (r ->> 'listo')::boolean and r -> 'problemas' @> '["REQUIERE_ENTREGA"]' and jsonb_array_length(r -> 'entrega_opciones' -> 'opciones') = 5, '5.1 · sin elegir entrega no hay revisión lista, pero sí las opciones para elegir');
  r := public.cc_checkout_revisar(cart, null, null, '{"opcion":"local_chofer"}');
  perform tests.ok(not (r ->> 'listo')::boolean and r -> 'problemas' @> '["ENTREGA_NO_PERMITIDA"]', '5.2 · una opción que la regla no permite (chofer a Mazatlán) no pasa');
  r := public.cc_checkout_revisar(cart, null, null, '{"opcion":"foraneo_dhl"}');
  rv := (r ->> 'review_id')::uuid;
  perform tests.ok((r ->> 'listo')::boolean and (r ->> 'total')::numeric = 2000 and (r ->> 'envio')::numeric = 600 and (r ->> 'total_con_envio')::numeric = 2600 and r -> 'entrega' ->> 'opcion' = 'foraneo_dhl' and (r -> 'entrega' ->> 'llega_hasta') is not null,
    '5.3 · revisión lista: productos 2,000 + envío 600, con la promesa');
  perform tests.act_as_owner();
  perform tests.ok((select entrega ->> 'opcion' = 'foraneo_dhl' from public.cc_checkout_reviews where id = rv), '5.4 · la revisión guarda la entrega elegida');
  perform tests.act_as(v_doc);
  r := public.cc_checkout_confirmar(rv, 'op-ent-1');
  ord := (r ->> 'order_id')::uuid;
  perform tests.ok((r ->> 'confirmado')::boolean and (r ->> 'total')::numeric = 2600 and (r ->> 'envio')::numeric = 600 and r -> 'entrega' ->> 'opcion' = 'foraneo_dhl' and (r ->> 'saldo')::numeric = 2600, '5.5 · confirmado: el pedido cobra 2,600 y devuelve la entrega');
  perform tests.act_as_owner();
  perform tests.ok((select total = 2600 and shipping_cost = 600 and shipping_meta -> 'entrega' ->> 'actor' = 'doctor' and shipping_meta ->> 'placed_by' = 'Checkout canónico (CC-6)' from public.orders where id = ord), '5.6 · el pedido del portal lleva la entrega y el flete');
  perform tests.act_as(v_doc);
  r := public.cc_checkout_confirmar(rv, 'op-ent-1');
  perform tests.ok((r ->> 'idempotente')::boolean and (r ->> 'total')::numeric = 2600, '5.7 · reintento: mismo resultado');
  -- recoger sin dirección (doctor sin ubicación)
  perform tests.act_as_service();
  cart := (public.cc_carrito_abrir('doctor', null, v_doc2) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart, 'doctor', null, v_doc2, p, 1, 'e2');
  update public.doctor_locations set active = false where doctor_id = v_doc2;
  perform tests.act_as(v_doc2);
  r := public.cc_checkout_revisar(cart, null, null, '{"opcion":"foraneo_dhl"}');
  perform tests.ok(not (r ->> 'listo')::boolean and r -> 'problemas' @> '["REQUIERE_DIRECCION"]', '5.8 · envío a domicilio sin domicilio: falta dirección');
  r := public.cc_checkout_revisar(cart, null, null, '{"opcion":"recoge"}');
  perform tests.ok((r ->> 'listo')::boolean and (r ->> 'envio')::numeric = 0 and r ->> 'direccion' is null, '5.9 · recoger en sucursal no necesita dirección');
  r := public.cc_checkout_confirmar((r ->> 'review_id')::uuid, 'op-ent-2');
  perform tests.ok((r ->> 'confirmado')::boolean and (r ->> 'total')::numeric = 1000 and r -> 'entrega' ->> 'tipo' = 'recoge', '5.10 · pedido para recoger, sin flete');
  -- en Culiacán, el doctor con ≥ 500 recibe por chofer gratis
  perform tests.act_as_service();
  update public.doctor_locations set active = true where doctor_id = v_doc2;
  cart := (public.cc_carrito_abrir('doctor', null, v_doc2) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart, 'doctor', null, v_doc2, p, 1, 'e3');
  perform tests.act_as(v_doc2);
  r := public.cc_checkout_revisar(cart, null, null, jsonb_build_object('opcion', 'local_chofer', 'horario', hor2));   -- ENT-H: con horario
  perform tests.ok((r ->> 'listo')::boolean and (r ->> 'envio')::numeric = 0 and (r -> 'entrega' ->> 'local')::boolean and r -> 'entrega_opciones' ->> 'sugerida' = 'local_chofer', '5.11 · doctor de Culiacán: chofer gratis');

  -- ══ 6 · configuración por Dirección ═══════════════════════════════════════════════════════════════
  perform tests.act_as(v_admin);
  r := public.entrega_config_guardar('{"foraneo_costo": 450, "corte": "14:00", "t1_activo": true, "recoge_lugar": "Sucursal Centro"}'::jsonb);
  perform tests.ok((r ->> 'foraneo_costo')::numeric = 450 and r ->> 'corte' = '14:00:00' and (r ->> 't1_activo')::boolean, '6.1 · Dirección cambia la regla');
  select x into o from jsonb_array_elements(public.entrega_opciones('staff', 1000, '82000', mie) -> 'opciones') x where x ->> 'id' = 'foraneo_t1';
  perform tests.ok((o ->> 'disponible')::boolean and (o ->> 'flete')::numeric = 450, '6.2 · T1 encendido y el flete nuevo aplican de inmediato');
  select x into o from jsonb_array_elements(public.entrega_opciones('staff', 1000, '82000', mie) -> 'opciones') x where x ->> 'id' = 'foraneo_dhl';
  perform tests.ok(not (o ->> 'antes_de_corte')::boolean and o ->> 'salida' = '2026-10-22', '6.3 · con corte a las 14:00, a las 14:00 ya sale mañana');
  perform tests.throws('select public.entrega_config_guardar(''{"cp_local_desde": "ABCDE"}'')', 'violates check constraint', '6.4 · un CP inválido no entra');
  perform tests.throws('select public.entrega_config_guardar(''{"dias_paqueteria": [8]}'')', 'violates check constraint', '6.5 · un día inválido no entra');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'Regla de entrega actualizada'), '6.6 · queda en la bitácora');
  perform tests.act_as(v_admin);
  perform tests.act_as_owner();
end $t$;
rollback;
