-- ENT-H (189) · HORARIO DE ENTREGA LOCAL. La entrega por chofer se agenda en un horario disponible (bloques 10:30–13:30 y
-- 15:30–17:30 cada 30 min, configurables); el horario elegido se valida y se RESERVA en la misma transacción del pedido
-- (cupo 1 = al elegirlo se bloquea); cancelar libera; Almacén/Dirección reprograman con motivo; Dirección, Almacén y Chofer
-- ven la agenda; el doctor en su portal elige el horario igual que el vendedor; el resto de la 171 no cambia.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); v_alm uuid := tests.user('warehouse'); v_cho uuid := tests.user('driver');
  v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor');
  cu uuid; p uuid; r jsonb; d jsonb; s jsonb; disp jsonb; ag jsonb; ord uuid; ord2 uuid; ord3 uuid; cart uuid; cart2 uuid; rv uuid; rv2 uuid;
  f text; i text; f2 text; i2 text; n int;
  mie timestamptz := '2026-10-21 14:00-07'::timestamptz;         -- miércoles 14:00 Culiacán (antes del corte; margen 60 → desde 15:00)
  mie_tarde timestamptz := '2026-10-21 15:30-07'::timestamptz;   -- ya no sale hoy
  dom timestamptz := '2026-10-25 11:00-07'::timestamptz;         -- domingo
  dir_loc jsonb := '{"line1":"Blvd. Culiacán 100","colonia":"Centro","cp":"80020","city":"Culiacán","state":"Sinaloa","phone":"6671234567"}'::jsonb;
  dir_for jsonb := '{"line1":"Av. del Mar 10","colonia":"Centro","cp":"82000","city":"Mazatlán","state":"Sinaloa","phone":"6691234567"}'::jsonb;
  lin jsonb;
begin
  perform tests.act_as_service();
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'ENTH-L', 100);
  insert into public.customers (full_name, phone, source) values ('Cliente Horario', '6670001111', 'odoo') returning id into cu;
  perform tests.cliente(v_doc); perform tests.cliente(v_doc2);
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, contact_phone, is_default) values (v_doc, 'Consultorio', 'Blvd. Culiacán 100', '80020', 'Culiacán', 'Sinaloa', '6671234567', true);
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, contact_phone, is_default) values (v_doc2, 'Consultorio', 'Blvd. Culiacán 200', '80030', 'Culiacán', 'Sinaloa', '6671234568', true);
  lin := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1));   -- 1,000 (≥ 500: chofer gratis)
  perform tests.act_as_owner();

  -- ══ 0 · forma, configuración por defecto y permisos ══════════════════════════════════════════════
  perform tests.eq((select count(*)::int from public._entrega_horario_slots()), 10, '0.1 · 10 horarios: 10:30–13:30 (6) y 15:30–17:30 (4)');
  perform tests.ok((select to_char(min(inicio), 'HH24:MI') = '10:30' and to_char(max(inicio), 'HH24:MI') = '17:00' and to_char(max(fin), 'HH24:MI') = '17:30' from public._entrega_horario_slots()), '0.2 · del 10:30 al 17:00–17:30');
  perform tests.ok(not exists (select 1 from public._entrega_horario_slots() where to_char(inicio, 'HH24:MI') in ('13:30', '14:00', '14:30', '15:00')), '0.3 · entre 13:30 y 15:30 no hay entregas');
  perform tests.ok((select horario_cupo = 1 and horario_margen_min = 60 and horario_dias_adelante = 7 and horario_intervalo_min = 30 from public.entrega_config), '0.4 · cupo 1, margen 60 min, 7 días, cada 30 min');
  perform tests.ok(md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) = 'bee5aa3614e2b9e0327ebec6a1b38e2e'
               and md5(pg_get_functiondef('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure)) = '5769c551e6ca60003ba0fcf9390d80d1', '0.5 · crear_pedido y la 147 NO cambiaron');
  perform tests.ok(not has_table_privilege('authenticated', 'public.entrega_horarios', 'select') and not has_function_privilege('authenticated', 'public._entrega_horario_validar(text,text,timestamptz,boolean)', 'execute')
               and has_function_privilege('authenticated', 'public.entrega_horarios_disponibles(timestamptz)', 'execute'), '0.6 · la agenda solo se lee por funciones; lo interno no es de authenticated');
  perform tests.act_as_anon();
  perform tests.throws('select public.entrega_horarios_disponibles()', 'permission denied', '0.7 · anónimo no ve horarios');
  perform tests.act_as(v_pos);
  perform tests.throws('select * from public.entrega_horarios', 'permission denied', '0.8 · Ventas no lee la tabla directo');
  perform tests.eq(jsonb_array_length(public.entrega_opciones('staff', 1000, '80020', mie) -> 'opciones'), 5, '0.9 · entrega_opciones conserva su forma (5 opciones)');

  -- ══ 1 · horarios disponibles ═══════════════════════════════════════════════════════════════════════
  disp := public.entrega_horarios_disponibles(mie);
  perform tests.ok(disp ->> 'salida' = '2026-10-21' and disp -> 'dias' -> 0 ->> 'fecha' = '2026-10-21' and jsonb_array_length(disp -> 'dias') = 7 and disp -> 'dias' -> 6 ->> 'fecha' = '2026-10-28', '1.1 · antes del corte: empieza hoy; 7 días del chofer (sin domingo): termina el miércoles 28');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(disp -> 'dias') x where x ->> 'fecha' = '2026-10-25'), '1.2 · el domingo 25 no se ofrece');
  perform tests.eq(jsonb_array_length(disp -> 'dias' -> 0 -> 'slots'), 10, '1.3 · 10 horarios por día');
  perform tests.eq((disp -> 'dias' -> 0 ->> 'disponibles')::int, 4, '1.4 · a las 14:00 con margen de 60 min solo quedan los 4 de la tarde');
  select x into s from jsonb_array_elements(disp -> 'dias' -> 0 -> 'slots') x where x ->> 'inicio' = '10:30';
  perform tests.ok(not (s ->> 'disponible')::boolean and s ->> 'motivo' = 'PASADO' and s ->> 'fin' = '11:00', '1.5 · el de 10:30 ya pasó (y termina 11:00)');
  select x into s from jsonb_array_elements(disp -> 'dias' -> 0 -> 'slots') x where x ->> 'inicio' = '15:30';
  perform tests.ok((s ->> 'disponible')::boolean and (s ->> 'ocupados')::int = 0 and (s ->> 'cupo')::int = 1, '1.6 · el de 15:30 está libre');
  perform tests.eq((disp -> 'dias' -> 1 ->> 'disponibles')::int, 10, '1.7 · mañana los 10');
  disp := public.entrega_horarios_disponibles(mie_tarde);
  perform tests.ok(disp ->> 'salida' = '2026-10-22' and disp -> 'dias' -> 0 ->> 'fecha' = '2026-10-22' and (disp -> 'dias' -> 0 ->> 'disponibles')::int = 10, '1.8 · a las 15:30 ya no sale hoy: el primer día es jueves con todo libre');
  disp := public.entrega_horarios_disponibles(dom);
  perform tests.ok(disp -> 'dias' -> 0 ->> 'fecha' = '2026-10-26', '1.9 · en domingo el primer día es el lunes');

  -- ══ 2 · pedido del personal con horario (crear_pedido_con_entrega) ═══════════════════════════════
  select dd ->> 'fecha', x ->> 'inicio' into f, i from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where (x ->> 'disponible')::boolean limit 1;
  perform tests.ok(f is not null and i is not null, '2.0 · hay un horario disponible para probar (' || f || ' ' || i || ')');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, ''{"opcion":"local_chofer"}'')', gen_random_uuid(), lin, jsonb_build_object('address', dir_loc), cu), 'HORARIO_REQUERIDO', '2.1 · entrega local sin horario: no');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, %L)', gen_random_uuid(), lin, jsonb_build_object('address', dir_loc), cu, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f, 'inicio', '10:45'))), 'HORARIO_INVALIDO', '2.2 · un horario que no existe (10:45): no');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, %L)', gen_random_uuid(), lin, jsonb_build_object('address', dir_loc), cu, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f, 'inicio', '14:00'))), 'HORARIO_INVALIDO', '2.3 · 14:00 (fuera de los bloques): no');
  perform tests.throws_any(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, %L)', gen_random_uuid(), lin, jsonb_build_object('address', dir_loc), cu, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', (current_date - 1)::text, 'inicio', '10:30'))), array['HORARIO_PASADO', 'HORARIO_DIA_NO_VALIDO'], '2.4 · ayer: no');
  perform tests.throws_any(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, %L)', gen_random_uuid(), lin, jsonb_build_object('address', dir_loc), cu, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', (current_date + 45)::text, 'inicio', '10:30'))), array['HORARIO_LEJANO', 'HORARIO_DIA_NO_VALIDO'], '2.5 · dentro de 45 días: no');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, %L)', gen_random_uuid(), lin, jsonb_build_object('address', dir_loc), cu, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', 'mañana', 'inicio', '10:30'))), 'HORARIO_INVALIDO', '2.6 · fecha basura: no');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.orders where customer_id = cu), 0, '2.7 · y ningún pedido se creó a medias');
  perform tests.act_as(v_pos);
  ord := gen_random_uuid();
  r := public.crear_pedido_con_entrega(ord, null, null, lin, jsonb_build_object('address', dir_loc), false, cu, null, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f, 'inicio', i)));
  perform tests.ok(r -> 'entrega' -> 'horario' ->> 'fecha' = f and r -> 'entrega' -> 'horario' ->> 'inicio' = i and (r -> 'entrega' -> 'horario' ->> 'fin') is not null and r -> 'entrega' ->> 'llega_desde' = f and r -> 'entrega' ->> 'llega_hasta' = f and (r ->> 'envio')::numeric = 0,
    '2.8 · pedido local con horario: la promesa es ese día y ese horario; chofer gratis (≥ 500)');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 from public.entrega_horarios where order_id = ord and estado = 'reservado' and fecha = f::date and to_char(inicio, 'HH24:MI') = i), '2.9 · queda la reserva en la agenda');
  perform tests.ok((select shipping_meta -> 'entrega' -> 'horario' ->> 'inicio' = i from public.orders where id = ord), '2.10 · y el pedido lleva el horario en shipping_meta.entrega');
  perform tests.act_as(v_pos);
  select x into s from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where dd ->> 'fecha' = f and x ->> 'inicio' = i;
  perform tests.ok(not (s ->> 'disponible')::boolean and s ->> 'motivo' = 'OCUPADO' and (s ->> 'ocupados')::int = 1, '2.11 · ese horario ya se ve ocupado');
  ord2 := gen_random_uuid();
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, %L)', ord2, lin, jsonb_build_object('address', dir_loc), cu, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f, 'inicio', i))), 'HORARIO_OCUPADO', '2.12 · otro pedido al mismo horario: ocupado');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.orders where id = ord2), 0, '2.13 · y ese pedido no se creó (todo o nada)');
  perform tests.act_as(v_pos);
  r := public.crear_pedido_con_entrega(ord, null, null, lin, jsonb_build_object('address', dir_loc), false, cu, null, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f, 'inicio', i)));
  perform tests.ok((r ->> 'idempotent')::boolean and r -> 'entrega' -> 'horario' ->> 'inicio' = i, '2.14 · reintento del mismo pedido: idempotente');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.entrega_horarios where order_id = ord), 1, '2.15 · una sola reserva');
  perform tests.act_as(v_pos);
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, null, lin, jsonb_build_object('address', dir_for), false, cu, null, jsonb_build_object('opcion', 'foraneo_dhl', 'horario', jsonb_build_object('fecha', f, 'inicio', '16:00')));
  perform tests.ok(not (r -> 'entrega' ? 'horario'), '2.16 · DHL no lleva horario (se ignora lo que manden)');
  ord3 := gen_random_uuid();
  r := public.crear_pedido_con_entrega(ord3, null, null, lin, '{}'::jsonb, false, cu, null, jsonb_build_object('opcion', 'recoge', 'horario', jsonb_build_object('fecha', f, 'inicio', '16:00')));
  perform tests.ok(not (r -> 'entrega' ? 'horario'), '2.17 · recoger tampoco');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.entrega_horarios), 1, '2.18 · solo la entrega local reservó');

  -- ══ 3 · cancelar libera el horario ═════════════════════════════════════════════════════════════════
  perform tests.force_status(ord, 'cancelled');
  perform tests.ok((select estado = 'liberado' and liberado_at is not null and motivo_liberacion = 'Pedido cancelado' from public.entrega_horarios where order_id = ord), '3.1 · al cancelar, la reserva queda liberada');
  perform tests.act_as(v_pos);
  select x into s from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where dd ->> 'fecha' = f and x ->> 'inicio' = i;
  perform tests.ok((s ->> 'disponible')::boolean and (s ->> 'ocupados')::int = 0, '3.2 · y el horario vuelve a estar libre');
  ord := gen_random_uuid();
  r := public.crear_pedido_con_entrega(ord, null, null, lin, jsonb_build_object('address', dir_loc), false, cu, null, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f, 'inicio', i)));
  perform tests.ok(r -> 'entrega' -> 'horario' ->> 'inicio' = i, '3.3 · otro pedido ya puede tomarlo');

  -- ══ 4 · checkout del doctor (portal): el mismo horario, la misma reserva ═══════════════════════════
  select dd ->> 'fecha', x ->> 'inicio' into f2, i2 from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where (x ->> 'disponible')::boolean limit 1;
  perform tests.act_as_service();
  cart := (public.cc_carrito_abrir('doctor', null, v_doc) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart, 'doctor', null, v_doc, p, 1, 'h1');
  cart2 := (public.cc_carrito_abrir('doctor', null, v_doc2) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cart2, 'doctor', null, v_doc2, p, 1, 'h2');
  perform tests.act_as(v_doc);
  r := public.cc_checkout_revisar(cart, null, null, '{"opcion":"local_chofer"}');
  perform tests.ok(not (r ->> 'listo')::boolean and r -> 'problemas' @> '["HORARIO_REQUERIDO"]' and r -> 'entrega_opciones' ->> 'sugerida' = 'local_chofer', '4.1 · el doctor de Culiacán elige chofer: sin horario la revisión no está lista (HORARIO_REQUERIDO)');
  r := public.cc_checkout_revisar(cart, null, null, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f2, 'inicio', '14:00')));
  perform tests.ok(not (r ->> 'listo')::boolean and r -> 'problemas' @> '["HORARIO_INVALIDO"]', '4.2 · horario inexistente: HORARIO_INVALIDO');
  r := public.cc_checkout_revisar(cart, null, null, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f2, 'inicio', i2)));
  rv := (r ->> 'review_id')::uuid;
  perform tests.ok((r ->> 'listo')::boolean and r -> 'entrega' -> 'horario' ->> 'inicio' = i2 and r -> 'entrega' ->> 'llega_desde' = f2 and (r ->> 'envio')::numeric = 0, '4.3 · con horario: revisión lista, promesa = ese día y horario');
  perform tests.act_as_owner();
  perform tests.ok((select entrega -> 'horario' ->> 'fecha' = f2 from public.cc_checkout_reviews where id = rv), '4.4 · la revisión guarda el horario');
  perform tests.eq((select count(*)::int from public.entrega_horarios where fecha = f2::date and to_char(inicio, 'HH24:MI') = i2 and estado = 'reservado'), 0, '4.5 · revisar NO reserva todavía (se reserva al confirmar)');
  -- otro doctor revisa el MISMO horario antes de que el primero confirme: los dos ven revisión lista
  perform tests.act_as(v_doc2);
  r := public.cc_checkout_revisar(cart2, null, null, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f2, 'inicio', i2)));
  rv2 := (r ->> 'review_id')::uuid;
  perform tests.ok((r ->> 'listo')::boolean, '4.6 · otro doctor revisa el mismo horario (aún libre)');
  perform tests.act_as(v_doc);
  r := public.cc_checkout_confirmar(rv, 'op-enth-1');
  ord2 := (r ->> 'order_id')::uuid;
  perform tests.ok((r ->> 'confirmado')::boolean and r -> 'entrega' -> 'horario' ->> 'inicio' = i2, '4.7 · el primero confirma: pedido con horario');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 from public.entrega_horarios where order_id = ord2 and estado = 'reservado'), '4.8 · y su reserva en la agenda');
  perform tests.act_as(v_doc2);
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op-enth-2'')', rv2), 'HORARIO_OCUPADO', '4.9 · el segundo confirma: el horario ya se ocupó → no se crea el pedido');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.orders where doctor_id = v_doc2), 0, '4.10 · sin pedido para el segundo');
  perform tests.ok((select estado = 'active' from public.cc_carts where id = cart2), '4.11 · su carrito sigue activo para elegir otro horario');
  perform tests.act_as(v_doc2);
  r := public.cc_checkout_revisar(cart2, null, null, jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f2, 'inicio', i2)));
  perform tests.ok(not (r ->> 'listo')::boolean and r -> 'problemas' @> '["HORARIO_OCUPADO"]', '4.12 · al volver a revisar se le dice que está ocupado');
  r := public.cc_checkout_revisar(cart2, null, null, '{"opcion":"recoge"}');
  perform tests.ok((r ->> 'listo')::boolean and not (r -> 'entrega' ? 'horario'), '4.13 · recoger sigue sin horario');

  -- ══ 5 · agenda: Dirección, Almacén y Chofer sí; Ventas y doctor no ═════════════════════════════════
  perform tests.act_as(v_alm);
  ag := public.entrega_horarios_agenda(f::date, greatest(f::date, f2::date) + 1);
  select x into d from jsonb_array_elements(ag -> 'dias') x where x ->> 'fecha' = f;
  select x into s from jsonb_array_elements(d -> 'slots') x where x ->> 'inicio' = i;
  perform tests.ok(jsonb_array_length(s -> 'pedidos') = 1 and s -> 'pedidos' -> 0 ->> 'order_id' = ord::text and s -> 'pedidos' -> 0 ->> 'cliente' = 'Cliente Horario' and s -> 'pedidos' -> 0 -> 'direccion' ->> 'cp' = '80020' and s -> 'pedidos' -> 0 ->> 'telefono' = '6671234567',
    '5.1 · Almacén ve la entrega en su horario: pedido, cliente, dirección y teléfono');
  perform tests.ok((d ->> 'entregas')::int >= 1 and (select count(*) from jsonb_array_elements(d -> 'slots')) = 10, '5.2 · el día trae sus 10 horarios y el conteo de entregas');
  perform tests.act_as(v_cho);
  ag := public.entrega_horarios_agenda(f::date, f::date);
  perform tests.ok(jsonb_array_length(ag -> 'dias') = 1 and ag -> 'dias' -> 0 ->> 'fecha' = f, '5.3 · el chofer ve la agenda del día');
  perform tests.act_as(v_admin);
  perform tests.ok(jsonb_array_length(public.entrega_horarios_agenda() -> 'dias') >= 1 and (public.entrega_horarios_agenda() ->> 'desde') = (now() at time zone 'America/Mazatlan')::date::text, '5.4 · Dirección: sin rango = desde hoy');
  perform tests.throws(format('select public.entrega_horarios_agenda(%L, %L)', f, f::date + 40), 'RANGO_INVALIDO', '5.5 · máximo 31 días');
  perform tests.act_as(v_pos);
  perform tests.throws('select public.entrega_horarios_agenda()', 'NO_AUTORIZADO', '5.6 · Ventas no ve la agenda completa');
  perform tests.act_as(v_doc);
  perform tests.throws('select public.entrega_horarios_agenda()', 'NO_AUTORIZADO', '5.7 · el doctor tampoco');

  -- ══ 6 · reprogramar (Dirección y Almacén) ═════════════════════════════════════════════════════════
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.entrega_horario_reprogramar(%L, %L, ''16:30'', ''el cliente pidió más tarde'')', ord, f), 'NO_AUTORIZADO', '6.1 · Ventas no reprograma');
  perform tests.act_as(v_alm);
  perform tests.throws(format('select public.entrega_horario_reprogramar(%L, %L, ''16:30'', '''')', ord, f), 'MOTIVO_REQUERIDO', '6.2 · sin motivo no');
  perform tests.throws(format('select public.entrega_horario_reprogramar(%L, %L, ''16:30'', ''prueba recoger'')', ord3, f), 'HORARIO_NO_APLICA', '6.3 · un pedido para recoger no lleva horario');
  -- a un horario ocupado por otro pedido (el del doctor) → no
  perform tests.throws(format('select public.entrega_horario_reprogramar(%L, %L, %L, ''prueba ocupado'')', ord, f2, i2), 'HORARIO_OCUPADO', '6.4 · al horario del doctor: ocupado');
  perform tests.act_as_owner();
  perform tests.ok((select estado = 'reservado' from public.entrega_horarios where order_id = ord and estado = 'reservado'), '6.5 · y la reserva original sigue (la transacción se deshizo)');
  -- a uno libre: el siguiente horario disponible distinto
  perform tests.act_as(v_alm);
  select dd ->> 'fecha', x ->> 'inicio' into f2, i2 from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where (x ->> 'disponible')::boolean and not (dd ->> 'fecha' = f and x ->> 'inicio' = i) limit 1;
  r := public.entrega_horario_reprogramar(ord, f2, i2, 'El cliente pidió otro horario');
  perform tests.ok(r -> 'horario' ->> 'fecha' = f2 and r -> 'horario' ->> 'inicio' = i2 and r -> 'anterior' ->> 'inicio' = i, '6.6 · Almacén reprograma: nuevo horario y el anterior registrado');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 from public.entrega_horarios where order_id = ord and estado = 'reservado' and fecha = f2::date and to_char(inicio, 'HH24:MI') = i2)
               and (select count(*) = 1 from public.entrega_horarios where order_id = ord and estado = 'liberado' and motivo_liberacion like 'Reprogramado: El cliente%'), '6.7 · en la agenda: una reserva nueva y la vieja liberada con el motivo');
  perform tests.ok((select shipping_meta -> 'entrega' -> 'horario' ->> 'inicio' = i2 and shipping_meta -> 'entrega' ->> 'llega_desde' = f2 and shipping_meta -> 'entrega' -> 'reprogramado' ->> 'motivo' = 'El cliente pidió otro horario' from public.orders where id = ord), '6.8 · el pedido muestra el horario nuevo y por qué cambió');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'Horario de entrega reprogramado'), '6.9 · queda en la bitácora');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.entrega_horario_reprogramar(%L, %L, ''09:00'', ''prueba'')', ord, f2), 'HORARIO_INVALIDO', '6.10 · a un horario que no existe: no');
  perform tests.force_status(ord, 'cancelled');
  perform tests.throws(format('select public.entrega_horario_reprogramar(%L, %L, %L, ''prueba'')', ord, f2, i2), 'PEDIDO_CERRADO', '6.11 · un pedido cancelado no se reprograma');

  -- ══ 7 · configuración por Dirección ════════════════════════════════════════════════════════════════
  perform tests.act_as(v_admin);
  r := public.entrega_config_guardar('{"horario_cupo": 2}'::jsonb);
  perform tests.ok((r ->> 'horario_cupo')::int = 2 and jsonb_array_length(r -> 'horario_franjas') = 2, '7.1 · Dirección sube el cupo a 2; la regla se lee con los bloques');
  perform tests.act_as_owner();
  select fecha::text, to_char(inicio, 'HH24:MI') into f2, i2 from public.entrega_horarios where order_id = ord2 and estado = 'reservado';
  perform tests.act_as(v_pos);
  select x into s from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where dd ->> 'fecha' = f2 and x ->> 'inicio' = i2;
  perform tests.ok((s ->> 'disponible')::boolean and (s ->> 'ocupados')::int = 1 and (s ->> 'cupo')::int = 2, '7.2 · con cupo 2 el horario del doctor vuelve a admitir una entrega más');
  perform tests.act_as(v_admin);
  perform tests.throws('select public.entrega_config_guardar(''{"horario_franjas": [{"desde":"10:00","hasta":"09:00"}]}'')', 'ck_entcfg_franjas', '7.3 · un bloque al revés no entra');
  perform tests.throws('select public.entrega_config_guardar(''{"horario_franjas": [{"desde":"10","hasta":"12:00"}]}'')', 'ck_entcfg_franjas', '7.4 · una hora mal escrita no entra');
  perform tests.throws('select public.entrega_config_guardar(''{"horario_cupo": 0}'')', 'ck_entcfg_cupo', '7.5 · cupo 0 no');
  r := public.entrega_config_guardar('{"horario_franjas": [{"desde":"09:00","hasta":"10:00"}], "horario_intervalo_min": 20}'::jsonb);
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public._entrega_horario_slots()), 3, '7.6 · un bloque de 09:00 a 10:00 cada 20 min = 3 horarios');
  perform tests.ok((select to_char(fin, 'HH24:MI') = '10:00' from public._entrega_horario_slots() order by inicio desc limit 1), '7.7 · el último termina a las 10:00');
  perform tests.act_as(v_doc);
  perform tests.ok(public.entrega_config_ver() ? 'horario_franjas', '7.8 · el doctor lee los bloques (para mostrarlos)');
  perform tests.throws('select public.entrega_config_guardar(''{"horario_cupo": 5}'')', 'NO_AUTORIZADO', '7.9 · pero no los cambia');
  perform tests.act_as_owner();
end $t$;
rollback;
