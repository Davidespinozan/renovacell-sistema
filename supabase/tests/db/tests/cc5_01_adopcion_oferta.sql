-- CC-5 · Adopción con fusión determinista (atómica con CC-1/CC-2), oferta de asesor (una por
-- carrito, cooldown tras rechazo, aceptación por CC-2), preparación de checkout solo lectura,
-- purga respeta carritos, rollback no deja huérfanos.
begin;
do $t$
declare
  v_doc uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor'); v_pos uuid := tests.user('pos');
  hA text := repeat('3', 64); hB text := repeat('4', 64); hC text := repeat('5', 64); cA uuid; cB uuid; cD uuid; cC uuid; cv uuid;
  pX uuid; pY uuid; pZ uuid; r jsonb; n int; ord int;
begin
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}' where id = v_pos;
  pX := tests.producto_fam('Rellenos', 'Hyalux', 1000); pY := tests.producto_fam('Rellenos', 'Hyalux', 500); pZ := tests.producto_cat('Bioestimuladores', 2000);
  perform tests.stock(pX, 'LX', 10); perform tests.stock(pY, 'LY', 10); perform tests.stock(pZ, 'LZ', 10);
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hB, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hC, '{}'::jsonb, null);

  -- ══ H · fusión: visitante X×2, Y×1; perfil ya tenía X×1, Z×3 → X×3, Y×1, Z×3 ══
  cA := (public.cc_carrito_abrir('visitor', hA, null) ->> 'cart_id')::uuid;
  perform public.cc_carrito_agregar(cA, 'visitor', hA, null, pX, 2, 'a1'); perform public.cc_carrito_agregar(cA, 'visitor', hA, null, pY, 1, 'a2');
  cD := (public.cc_carrito_abrir('doctor', null, v_doc) ->> 'cart_id')::uuid;
  perform public.cc_carrito_agregar(cD, 'doctor', null, v_doc, pX, 1, 'd1'); perform public.cc_carrito_agregar(cD, 'doctor', null, v_doc, pZ, 3, 'd2');
  r := public.cc_visitante_adoptar(hA, v_doc);
  perform tests.eq(r ->> 'estado', 'adoptado', 'Z · adopción CC-1 sigue funcionando');
  perform tests.eq((r ->> 'carritos')::int, 1, 'Z · reporta 1 carrito procesado');
  perform tests.eq((select estado from public.cc_carts where id = cA), 'merged', 'Z · el del visitante queda merged (histórico)');
  perform tests.eq((select merged_into_cart_id from public.cc_carts where id = cA), cD, 'Z · apunta al canónico del perfil');
  perform tests.eq((select estado from public.cc_carts where id = cD), 'active', 'Z · el del perfil sigue activo y canónico');
  perform tests.eq((select quantity from public.cc_cart_items where cart_id = cD and product_id = pX), 3, 'Z · X: 2+1 = 3 (suma, no duplica ni pierde)');
  perform tests.eq((select quantity from public.cc_cart_items where cart_id = cD and product_id = pY), 1, 'Z · Y: 1');
  perform tests.eq((select quantity from public.cc_cart_items where cart_id = cD and product_id = pZ), 3, 'Z · Z: 3');
  perform tests.eq((select count(*) from public.cc_carts where profile_id = v_doc and estado = 'active'), 1::bigint, 'Z · un solo carrito activo final');
  perform tests.eq((select count(*) from public.cc_cart_events where cart_id = cD and tipo = 'merged'), 1::bigint, 'Z · evento merged durable');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''doctor'', null, %L, %L, 1, ''x'')', cA, v_doc, pX), 'CARRITO_CERRADO', 'Z · el merged no acepta mutaciones');
  -- después de adoptar, el token viejo ya no sirve y el carrito es del doctor
  perform tests.throws(format('select public.cc_carrito_ver(%L, ''visitor'', %L, null)', cD, hA), 'SESION_INVALIDA', 'Z · el token rotó: la posesión vieja no accede');

  -- ══ H · sin carrito previo del perfil: el del visitante conserva su id ══════
  cB := (public.cc_carrito_abrir('visitor', hB, null) ->> 'cart_id')::uuid;
  perform public.cc_carrito_agregar(cB, 'visitor', hB, null, pY, 4, 'b1');
  r := public.cc_visitante_adoptar(hB, v_nov);
  perform tests.eq((select estado || ':' || coalesce(profile_id::text, '') from public.cc_carts where id = cB), 'active:' || v_nov, 'Z · conserva id y gana dueño');
  perform tests.eq((public.cc_carrito_abrir('doctor', null, v_nov) ->> 'cart_id')::uuid, cB, 'Z · el doctor reabre y recibe ese mismo carrito');
  perform tests.eq((select quantity from public.cc_cart_items where cart_id = cB and product_id = pY), 4, 'Z · cantidades intactas');
  perform tests.eq((select count(*) from public.cc_cart_events where cart_id = cB and tipo = 'adopted'), 1::bigint, 'Z · evento adopted');

  -- ══ oferta de asesor ════════════════════════════════════════════════════════
  cC := (public.cc_carrito_abrir('visitor', hC, null) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(cC, 'visitor', hC, null, pX, 1, 'c1');
  perform tests.eq((r ->> 'oferta_elegible')::boolean, true, 'X · elegible al primer item');
  r := public.cc_carrito_oferta(cC, 'ai', hC, null, 'ofrecer');
  perform tests.eq((r ->> 'registrada')::boolean, true, 'X · la IA registra la oferta (en nombre del dueño)');
  r := public.cc_carrito_oferta(cC, 'ai', hC, null, 'ofrecer');
  perform tests.eq((r ->> 'registrada')::boolean, false, 'AM · una sola oferta por carrito');
  perform public.cc_carrito_vaciar(cC, 'visitor', hC, null, 'c2');
  r := public.cc_carrito_agregar(cC, 'visitor', hC, null, pX, 1, 'c3');
  perform tests.eq((r ->> 'oferta_elegible')::boolean, false, 'AM · ya ofrecida: vaciar/rellenar no re-dispara');
  r := public.cc_carrito_oferta(cC, 'ai', hC, null, 'rechazar');
  perform tests.eq(r ->> 'oferta_estado', 'rechazada', 'AN · rechazo registrado');
  perform tests.ok((r ->> 'siguiente_at')::timestamptz > now() + interval '6 days', 'AN · cooldown 7 días');
  r := public.cc_carrito_oferta(cC, 'ai', hC, null, 'ofrecer');
  perform tests.eq(r ->> 'motivo', 'no_elegible', 'AN · dentro del cooldown no se vuelve a ofrecer');
  update public.cc_carts set oferta_siguiente_at = now() - interval '1 minute' where id = cC;   -- simula que pasaron 7 días
  perform public.cc_carrito_vaciar(cC, 'visitor', hC, null, 'c4');
  r := public.cc_carrito_agregar(cC, 'visitor', hC, null, pX, 1, 'c5');
  perform tests.eq((r ->> 'oferta_elegible')::boolean, true, 'AN · vencido el cooldown, vuelve a ser elegible');
  perform tests.eq((public.cc_carrito_oferta(cC, 'ai', hC, null, 'ofrecer') ->> 'registrada')::boolean, true, 'AN · segunda oferta tras cooldown');
  -- aceptar: registro + CC-2 es quien asigna (no se duplica cola)
  cv := (public.cc_abrir_conversacion(hC, null) ->> 'conversation_id')::uuid;
  r := public.cc_carrito_oferta(cC, 'ai', hC, null, 'aceptar');
  perform tests.eq(r ->> 'oferta_estado', 'aceptada', 'AO · aceptación registrada');
  perform tests.eq((public.cc_carrito_oferta(cC, 'ai', hC, null, 'aceptar') ->> 'idempotente')::boolean, true, 'AO · aceptar dos veces es idempotente');
  r := public.cc_solicitar_asesor(cv, 'visitor', hC, null);
  perform tests.eq(r ->> 'modo', 'human_requested', 'AO · el handoff es el de CC-2');
  perform tests.throws(format('select public.cc_carrito_oferta(%L, ''visitor'', %L, null, ''ofrecer'')', cC, hB), 'SESION_INVALIDA', 'solo el dueño (o la IA en su nombre) toca la oferta');

  -- ══ preparar checkout: solo lectura ═════════════════════════════════════════
  select count(*) into ord from public.orders;
  r := public.cc_carrito_preparar_checkout(cC, 'visitor', hC, null);
  perform tests.eq((r ->> 'listo')::boolean, false, 'AB · visitante: no listo');
  perform tests.ok(r -> 'problemas' @> '["REQUIERE_CUENTA"]', 'AB · requiere cuenta');
  r := public.cc_carrito_preparar_checkout(cB, 'doctor', null, v_nov);
  perform tests.ok(r -> 'problemas' @> '["REQUIERE_VERIFICACION"]', 'AB · no verificado: requiere verificación');
  r := public.cc_carrito_preparar_checkout(cD, 'doctor', null, v_doc);
  perform tests.eq((r ->> 'listo')::boolean, true, 'AB · verificado con todo vendible y disponible: listo');
  perform tests.eq(jsonb_array_length(r -> 'lineas_crear_pedido'), 3, 'AC · contrato para crear_pedido: [{product_id, qty}] ×3');
  perform tests.ok((r -> 'lineas_crear_pedido' -> 0) ?& array['product_id', 'qty'] and not ((r -> 'lineas_crear_pedido' -> 0) ? 'unit_price'), 'AC · sin precio en las líneas (lo pone el servidor en W1)');
  update public.products set sellable = false where id = pZ;
  r := public.cc_carrito_preparar_checkout(cD, 'doctor', null, v_doc);
  perform tests.eq((r ->> 'listo')::boolean, false, 'AB · un producto no vendible → no listo');
  perform tests.ok(r -> 'problemas' @> jsonb_build_array(jsonb_build_object('product_id', pZ, 'problema', 'NO_VENDIBLE')), 'AB · problema identificado');
  perform tests.eq((select count(*) from public.orders), ord::bigint, 'AT · preparar no crea pedidos');
  perform tests.eq((select count(*) from public.cc_cart_items where cart_id = cD), 3::bigint, 'AT · ni muta el carrito');
  perform tests.throws(format('select public.cc_carrito_preparar_checkout(%L, ''doctor'', null, %L)', cD, v_nov), 'NO_AUTORIZADO', 'AB · solo el dueño prepara');

  -- ══ purga respeta carritos ══════════════════════════════════════════════════
  update public.cc_visitors set last_seen_at = now() - interval '400 days' where token_hash = hC;
  n := public.cc_visitantes_purgar(90);
  perform tests.ok(exists (select 1 from public.cc_visitors where token_hash = hC), 'retención · un visitante con carrito no se purga');
end $t$;
rollback;
