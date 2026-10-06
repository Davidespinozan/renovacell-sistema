-- PREFLIGHT CC · E2E NEGATIVO transversal: cada frontera de autoridad desde la base.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor'); v_pos uuid := tests.user('pos'); v_pos2 uuid := tests.user('pos');
  hA text := repeat('b', 64); hB text := repeat('c', 64); conv uuid; conv2 uuid; cart uuid; cart2 uuid; pA uuid; r jsonb; m jsonb; t1 uuid; rv uuid; k uuid; src uuid;
begin
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}' where id in (v_pos, v_pos2);
  pA := tests.producto_fam('Rellenos', 'NEG', 1000); perform tests.stock(pA, 'LNEG', 5);
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hB, '{}'::jsonb, null);
  conv := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid; conv2 := (public.cc_abrir_conversacion(hB, null) ->> 'conversation_id')::uuid;
  cart := (public.cc_carrito_abrir('visitor', hA, null) ->> 'cart_id')::uuid; cart2 := (public.cc_carrito_abrir('visitor', hB, null) ->> 'cart_id')::uuid;
  perform public.cc_carrito_agregar(cart, 'visitor', hA, null, pA, 1, 'n1');
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, is_default) values (v_nov, 'X', 'Calle', '82000', 'Mazatlán', 'Sinaloa', true);

  -- 1/2/3 · checkout: visitante, no verificado, otro doctor
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_checkout_revisar(%L)', cart), 'permission denied', '1 · visitante no hace checkout');
  perform tests.act_as_service(); perform public.cc_visitante_adoptar(hA, v_nov); perform tests.act_as(v_nov);
  r := public.cc_checkout_revisar(cart);
  perform tests.ok(not (r ->> 'listo')::boolean and r -> 'problemas' @> '["REQUIERE_VERIFICACION"]', '2 · doctor no verificado: bloqueado');
  perform tests.act_as(v_doc2);
  perform tests.throws(format('select public.cc_checkout_revisar(%L)', cart), 'NO_AUTORIZADO', '3 · otro doctor: denegado');
  -- 4/5/6 · token viejo, otra conversación, otro carrito
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''visitor'', %L, null, ''x'', ''hola'')', conv, hA), 'SESION_INVALIDA', '4 · token revocado tras adopción');
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''visitor'', %L, null)', conv, hB), 'NO_AUTORIZADO', '5 · visitante B no lee la conversación A');
  perform tests.throws(format('select public.cc_carrito_ver(%L, ''visitor'', %L, null)', cart, hB), 'NO_AUTORIZADO', '6 · visitante B no ve el carrito A');
  -- 7/8 · conocimiento: faltante = faltante; T2 bloqueado (T3 es política de IA probada con proveedor falso)
  perform tests.act_as(v_admin);
  src := public.cc_fuente_registrar('fabricante', 'NEG src', 'https://x.test/a');
  k := (public.cc_conocimiento_guardar(pA, 'indicaciones', 'Indicado para pacientes con X.', null, src) ->> 'id')::uuid;
  perform tests.throws(format('select public.cc_conocimiento_aprobar(%L, true)', k), 'T2_BLOQUEADO', '8 · T2 no se aprueba con el interruptor apagado');
  perform tests.ok(public.cc_ficha_producto(pA, 'staff') -> 'conocimiento' = '{}'::jsonb, '7 · sin conocimiento aprobado la ficha no inventa nada (ni a staff)');
  -- 10/11 · precio y stock sin autoridad
  perform tests.act_as_service();
  perform tests.eq(public.cc_ia_precio(null, pA, 1) ->> 'motivo', 'PRICE_REQUIRES_VERIFICATION', '10 · visitante sin precio');
  perform tests.eq(public.cc_ia_precio(v_nov, pA, 1) ->> 'motivo', 'PRICE_REQUIRES_VERIFICATION', '10 · no verificado sin precio');
  perform tests.eq(public.cc_ia_disponibilidad(null, pA) ->> 'motivo', 'AVAILABILITY_REQUIRES_VERIFICATION', '11 · visitante sin stock');
  perform tests.ok(public.cc_ficha_producto(pA, 'public')::text not ilike '%1000%' and public.cc_ficha_producto(pA, 'public')::text not ilike '%stock%', '10/11 · la ficha pública no filtra precio ni stock');
  -- 12 · duplicados: mutación IA
  perform public.cc_carrito_agregar(cart2, 'ai', hB, null, pA, 2, 't:r1:agregar:h');
  perform public.cc_carrito_agregar(cart2, 'ai', hB, null, pA, 2, 't:r1:agregar:h');
  perform tests.eq((select quantity from public.cc_cart_items where cart_id = cart2 and product_id = pA), 2, '12 · misma mutación de IA dos veces → una');
  -- 14 · takeover humano → sin IA tardía
  m := public.cc_enviar_mensaje(conv2, 'visitor', hB, null, 'c:1', 'hola');
  t1 := (public.cc_ia_turno_reclamar(conv2, (m ->> 'seq')::bigint, 'falso', 'f') ->> 'turn_id')::uuid;
  perform public.cc_solicitar_asesor(conv2, 'visitor', hB, null); perform public.cc_asignar_asesor(conv2, v_admin, v_pos); perform public.cc_iniciar_asesoria(conv2, v_pos);   -- CC-7 · asigna Dirección; takeover = sesión iniciada
  r := public.cc_ia_turno_responder(t1, 'tarde');
  perform tests.eq(r ->> 'motivo', 'takeover_humano', '14 · la respuesta tardía de la IA se descarta');
  -- 15/16/17 · vendedor: lee, no muta, no confirma; suspendido pierde acceso
  perform public.cc_iniciar_asesoria(conv2, v_pos);
  perform tests.eq(public.cc_carrito_ver(cart2, 'seller', null, v_pos) ->> 'rol', 'asesor', '16 · asesor asignado lee');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''seller'', null, %L, %L, 1, ''s'')', cart2, v_pos, pA), 'NO_AUTORIZADO', '16 · asesor no muta el carrito');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.cc_checkout_revisar(%L)', cart2), 'NO_AUTORIZADO', '17 · asesor no confirma checkout por el cliente');
  perform tests.act_as_service();
  update public.profiles set active = false where id = v_pos;
  perform tests.throws(format('select public.cc_carrito_ver(%L, ''seller'', null, %L)', cart2, v_pos), 'CUENTA_SUSPENDIDA', '15 · vendedor suspendido: acceso revocado de inmediato');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''seller'', null, %L, ''x'', ''hola'')', conv2, v_pos), 'CUENTA_SUSPENDIDA', '15 · ni escribe en la conversación');
  -- 13/18 · duplicado de checkout y reintento de pago → un solo pedido
  update public.profiles set verified = true where id = v_nov;
  perform tests.act_as(v_nov);
  r := public.cc_checkout_revisar(cart); rv := (r ->> 'review_id')::uuid;
  r := public.cc_checkout_confirmar(rv, 'op-neg', null);
  perform tests.ok((r ->> 'confirmado')::boolean, '18 · pedido creado');
  perform tests.eq((public.cc_checkout_confirmar(rv, 'op-neg-2', null) ->> 'order_id')::uuid, (r ->> 'order_id')::uuid, '18 · cualquier reintento → el mismo pedido (el pago se hace contra ese id)');
  perform tests.eq((select count(*) from public.orders where doctor_id = v_nov), 1::bigint, '13/18 · un solo pedido');
  -- 19 · "autoridad" por argumentos: ni audiencia ni perfil ajeno
  perform tests.act_as_anon();
  perform tests.eq(public.cc_ficha_producto(pA, 'staff') ->> 'audiencia', 'public', '19 · pedir audiencia staff desde anon se ignora');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.cc_ia_precio(%L, %L, 1)', v_admin, pA), 'permission denied', '19 · un cliente no invoca herramientas de IA con otro perfil');
  -- 20 · bitácoras sin transcript
  perform tests.act_as_service();
  perform tests.ok(not exists (select 1 from public.cc_ai_turns t where t::text ilike '%hola%') and not exists (select 1 from public.cc_cart_events e where e::text ilike '%hola%') and not exists (select 1 from public.cc_checkout_events e where e::text ilike '%hola%'), '20 · turnos/eventos sin contenido de mensajes');
end $t$;
rollback;
