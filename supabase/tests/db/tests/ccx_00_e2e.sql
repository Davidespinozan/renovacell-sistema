-- PREFLIGHT CC · E2E INTEGRADO (solo comandos canónicos, en base): visitante → conversación → mensaje
-- → turno IA (libro) → conocimiento escaso (ficha sin secciones) → carrito → oferta de asesor →
-- registro/adopción → MISMA conversación y MISMO carrito del doctor verificado → precio/disponibilidad
-- → revisión → confirmación explícita → exactamente un pedido W1 → carrito converted → estado de
-- pedido → acciones de pago expuestas → sin pago realizado.
begin;
do $t$
declare
  v_pos uuid := tests.user('pos'); v_doc uuid; hA text := repeat('a', 64); vid uuid; conv uuid; cart uuid; pA uuid; r jsonb; m jsonb; t1 uuid; rv uuid; ord uuid; n_msgs int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}' where id = v_pos;
  pA := tests.producto_fam('Rellenos', 'E2E', 1000); update public.products set name = 'E2E Deep' where id = pA; perform tests.stock(pA, 'LE2E', 10);

  -- 1) visitante abre, conversa, manda mensaje
  r := public.cc_visitante_abrir(null, hA, '{"utm_source":"meta"}'::jsonb, null); vid := (r ->> 'visitor_id')::uuid;
  conv := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  m := public.cc_enviar_mensaje(conv, 'visitor', hA, null, 'c:1', '¿qué tienen para surcos?');
  -- 2) turno IA: reclamo + herramientas (búsqueda → ficha con conocimiento ESCASO) + respuesta persistida como ai
  t1 := (public.cc_ia_turno_reclamar(conv, (m ->> 'seq')::bigint, 'falso', 'falso-1') ->> 'turn_id')::uuid;
  perform tests.ok(exists (select 1 from public.cc_buscar_productos('e2e deep', 10, 'public') b where b.product_id = pA), '2 · búsqueda pública encuentra el producto');
  r := public.cc_ficha_producto(pA, 'public');
  perform tests.ok(r -> 'conocimiento' = '{}'::jsonb and r -> 'niveles_disponibles' = '[]'::jsonb and r ->> 'nombre' = 'E2E Deep', '2 · conocimiento escaso: la ficha trae identidad y declara que no hay secciones aprobadas (nada inventado)');
  perform public.cc_ia_herramienta_registrar(t1, 0, 'buscar_productos', 'ok', array[pA], '{"n":1}'::jsonb);
  r := public.cc_ia_turno_responder(t1, 'Tengo E2E Deep; aún no tengo ficha técnica aprobada. ¿Lo agrego a tu carrito?', 'PRODUCT_DISCOVERY', array['KNOWLEDGE_EVIDENCE'], 1, 100, 40);
  perform tests.eq((r ->> 'persistido')::boolean, true, '2 · respuesta de IA persistida por el comando canónico');
  -- 3) carrito del visitante (en nombre del dueño, como lo hace la IA) + oferta de asesor elegible
  cart := (public.cc_carrito_abrir('visitor', hA, null, conv) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(cart, 'ai', hA, null, pA, 2, 't1:r1:agregar:x');
  perform tests.ok((r ->> 'oferta_elegible')::boolean and (r ->> 'qty_despues')::int = 2, '3 · agregado ×2; oferta de asesor elegible (vacío→no vacío)');
  perform tests.eq((public.cc_carrito_oferta(cart, 'ai', hA, null, 'ofrecer') ->> 'registrada')::boolean, true, '3 · oferta registrada');
  r := public.cc_carrito_ver(cart, 'visitor', hA, null);
  perform tests.eq(r -> 'total' ->> 'estado', 'requiere_verificacion', '3 · visitante: sin precio ni total');
  -- 4) registro: el visitante se vuelve doctor VERIFICADO (fixture) y adopta por posesión del token
  v_doc := tests.user('doctor');
  r := public.cc_visitante_adoptar(hA, v_doc);
  perform tests.ok(r ->> 'estado' = 'adoptado' and (r ->> 'conversaciones')::int = 1 and (r ->> 'carritos')::int = 1, '4 · adopción: 1 conversación y 1 carrito pasan al doctor en la misma transacción');
  perform tests.eq((select profile_id from public.cc_conversations where id = conv), v_doc, '4 · MISMA conversación (mismo id) ahora del doctor');
  perform tests.eq((select profile_id from public.cc_carts where id = cart), v_doc, '4 · MISMO carrito (mismo id) ahora del doctor');
  perform tests.eq((public.cc_abrir_conversacion(null, v_doc) ->> 'conversation_id')::uuid, conv, '4 · el doctor reanuda la misma conversación');
  perform tests.eq((public.cc_carrito_abrir('doctor', null, v_doc) ->> 'cart_id')::uuid, cart, '4 · y recibe el mismo carrito');
  perform tests.throws(format('select public.cc_carrito_ver(%L, ''visitor'', %L, null)', cart, hA), 'SESION_INVALIDA', '4 · el token viejo quedó revocado');
  -- 5) precio y disponibilidad con autoridad del doctor verificado
  r := public.cc_carrito_ver(cart, 'doctor', null, v_doc);
  perform tests.ok((r -> 'total' ->> 'monto')::numeric = 2000 and r -> 'items' -> 0 ->> 'disponibilidad' = 'disponible', '5 · precio (2×1000) y disponibilidad reales para el verificado');
  perform tests.eq((public.cc_ia_precio(v_doc, pA, 2) ->> 'total')::numeric, 2000::numeric, '5 · herramienta de precio = misma autoridad');
  -- 6) revisión + confirmación explícita (como el doctor autenticado) → exactamente un pedido W1
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, is_default) values (v_doc, 'Consultorio', 'Calle 1', '82000', 'Mazatlán', 'Sinaloa', true);
  perform tests.act_as(v_doc);
  r := public.cc_checkout_revisar(cart); rv := (r ->> 'review_id')::uuid;
  perform tests.ok((r ->> 'listo')::boolean and (r ->> 'total')::numeric = 2000, '6 · revisión lista con total actual');
  r := public.cc_checkout_confirmar(rv, 'op-e2e', (r ->> 'cart_rev')::int); ord := (r ->> 'order_id')::uuid;
  perform tests.ok((r ->> 'confirmado')::boolean and r ->> 'status' = 'pending_payment' and r ->> 'folio' ~ '^S[0-9]{6,}$', '6 · pedido W1 creado (folio del servidor)');
  perform tests.ok(r -> 'acciones_pago' @> '["transferencia","tarjeta"]' and r ->> 'estado_pago' = 'pending', '6 · acciones de pago expuestas; nada pagado');
  r := public.cc_checkout_confirmar(rv, 'op-e2e', null);
  perform tests.ok((r ->> 'idempotente')::boolean and (r ->> 'order_id')::uuid = ord, '6 · reintento → el mismo pedido');
  perform tests.eq((select count(*) from public.orders where doctor_id = v_doc), 1::bigint, '6 · EXACTAMENTE un pedido');
  -- 7) estado posterior
  perform tests.act_as_service();
  perform tests.ok((select estado = 'converted' and converted_order_id = ord from public.cc_carts where id = cart), '7 · carrito converted → pedido');
  perform tests.eq(public.cc_ia_estado_pedido(v_doc, null) -> 'pedidos' -> 0 ->> 'estado', 'pending_payment', '7 · obtener_estado_pedido ve el pedido');
  perform tests.eq((select count(*) from public.payment_entries), 0::bigint, '7 · 0 pagos');
  perform tests.eq((select sum(quantity)::int from public.lots where product_id = pA), 10, '7 · inventario intacto');
  perform tests.eq((select status from public.cc_ai_turns where id = t1), 'completed', '7 · libro de turnos coherente');
  select count(*) into n_msgs from public.cc_messages where conversation_id = conv;
  perform tests.ok(n_msgs >= 2 and exists (select 1 from public.cc_messages where conversation_id = conv and actor_type = 'ai'), '7 · la conversación conserva el hilo (usuario + IA) tras la adopción');
end $t$;
rollback;
