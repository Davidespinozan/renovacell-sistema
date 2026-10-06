-- CC-6 · Checkout canónico: solo el doctor dueño verificado y autenticado revisa/confirma; la
-- revisión es evidencia (vence, se consume) y NO autoridad; confirmar revalida todo y crea el
-- pedido por crear_pedido (W1) en la misma transacción que convierte el carrito; idempotencia
-- end-to-end; rechazos por carrito/precio/stock cambiados; fallos inyectados no dejan nada a
-- medias; sin pagos, CFDI ni inventario; el pedido nuevo es visible por la herramienta de CC-4.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor'); v_pos uuid := tests.user('pos');
  pA uuid; pB uuid; pSin uuid; cD uuid; cN uuid; c2 uuid; r jsonb; rv uuid; rv2 uuid; ord uuid; n int; lotB uuid; pe0 bigint; loc uuid; loc2 uuid; q0 int; o0 bigint;
begin
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;
  pA := tests.producto_fam('Rellenos', 'Hyalux', 1000); pB := tests.producto_fam('Rellenos', 'Hyalux', 500); pSin := tests.producto_cat('Rellenos', 800);
  update public.products set name = 'Hyalux Deep' where id = pA; update public.products set name = 'Hyalux Lips' where id = pB; update public.products set name = 'Sin stock' where id = pSin;
  perform tests.stock(pA, 'L-A', 10); lotB := tests.stock(pB, 'L-B', 5);
  insert into public.doctor_locations (doctor_id, name, line1, exterior_number, neighborhood, postal_code, city, state, contact_phone, is_default) values (v_doc, 'Consultorio', 'Av. Reforma', '10', 'Centro', '82000', 'Mazatlán', 'Sinaloa', '6691234567', true) returning id into loc;
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, is_default) values (v_doc, 'Clínica Norte', 'Calle 2', '82100', 'Mazatlán', 'Sinaloa', false) returning id into loc2;
  cD := (public.cc_carrito_abrir('doctor', null, v_doc) ->> 'cart_id')::uuid;
  perform public.cc_carrito_agregar(cD, 'doctor', null, v_doc, pA, 2, 'a1'); perform public.cc_carrito_agregar(cD, 'doctor', null, v_doc, pB, 1, 'a2');
  cN := (public.cc_carrito_abrir('doctor', null, v_nov) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(cN, 'doctor', null, v_nov, pA, 1, 'n1');
  select count(*) into pe0 from public.payment_entries; select count(*) into o0 from public.orders;
  select sum(quantity)::int into q0 from public.lots where product_id = pA;

  -- ══ autoridad (A–E, AB) ═════════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_checkout_revisar(%L)', cD), 'permission denied', 'A · visitante (anon) no revisa ni confirma');
  perform tests.act_as(v_nov);
  r := public.cc_checkout_revisar(cN);
  perform tests.eq((r ->> 'listo')::boolean, false, 'B · doctor no verificado: no listo');
  perform tests.ok(r -> 'problemas' @> '["REQUIERE_VERIFICACION"]', 'B · motivo REQUIERE_VERIFICACION (sin bypass)');
  perform tests.ok(r ->> 'review_id' is null, 'B · no se emite revisión');
  perform tests.act_as(v_doc2);
  perform tests.throws(format('select public.cc_checkout_revisar(%L)', cD), 'NO_AUTORIZADO', 'C/D · doctor 2 no revisa el carrito de doctor 1 (uuid conocido)');
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op'')', gen_random_uuid()), 'NO_AUTORIZADO', 'E · review uuid inventado → no autorizado');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.cc_checkout_revisar(%L)', cD), 'NO_AUTORIZADO', 'AB · el personal no usa el checkout del cliente (tiene su flujo W1)');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_checkout_revisar(%L)', cD), 'NO_AUTORIZADO', 'AB · ni Dirección confirma por el cliente');

  -- ══ revisar (G/H/I/R) ═══════════════════════════════════════════════════════
  perform tests.act_as(v_doc);
  r := public.cc_checkout_revisar(cD);
  perform tests.eq((r ->> 'listo')::boolean, true, 'G · verificado con dirección default, stock y precio: listo');
  perform tests.eq((r ->> 'total')::numeric, 2500::numeric, 'G · total actual 2×1000 + 500');
  perform tests.ok((r ->> 'review_id') is not null and (r ->> 'expires_at')::timestamptz > now() + interval '14 minutes', 'I · revisión emitida, vence en ~15 min');
  perform tests.eq(r -> 'direccion' -> 'address' ->> 'cp', '82000', 'R · dirección desde doctor_locations (default)');
  perform tests.eq(jsonb_array_length(r -> 'lineas'), 2, 'G · líneas revalidadas');
  rv := (r ->> 'review_id')::uuid;
  r := public.cc_checkout_revisar(cD, loc2);
  perform tests.eq(r -> 'direccion' -> 'address' ->> 'cp', '82100', 'R · ubicación elegida (propia y activa)');
  r := public.cc_checkout_revisar(cD, gen_random_uuid());
  perform tests.ok(not (r ->> 'listo')::boolean and r -> 'problemas' @> '["REQUIERE_DIRECCION"]', 'R · ubicación ajena/inexistente → REQUIERE_DIRECCION (no se inventa)');
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op 1'')', rv), 'OPERACION_INVALIDA', 'AO · operation_id malformado falla cerrado');

  -- ══ fallos inyectados: nada a medias (AN) ═══════════════════════════════════
  perform set_config('app.cc_checkout_fallar', 'antes_w1', true);
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op-f1'')', rv), 'FALLO_INYECTADO', 'AN · fallo antes de W1');
  perform set_config('app.cc_checkout_fallar', 'despues_w1', true);
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op-f2'')', rv), 'FALLO_INYECTADO', 'AN · fallo después de W1 (pedido creado dentro de la tx)');
  perform set_config('app.cc_checkout_fallar', 'antes_operacion', true);
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op-f3'')', rv), 'FALLO_INYECTADO', 'AN · fallo antes de registrar la operación');
  perform set_config('app.cc_checkout_fallar', '', true);
  perform tests.eq((select count(*) from public.orders), o0, 'AN · ningún pedido huérfano');
  perform tests.act_as_service();
  perform tests.eq((select estado from public.cc_carts where id = cD), 'active', 'AN · el carrito sigue activo');
  perform tests.ok((select consumed_at is null from public.cc_checkout_reviews where id = rv), 'AN · la revisión no se consumió');
  perform tests.eq((select count(*) from public.cc_checkout_operations where cart_id = cD), 0::bigint, 'AN · sin operación registrada');
  perform tests.act_as(v_doc);

  -- ══ confirmar (K/L/P/V/W) ═══════════════════════════════════════════════════
  r := public.cc_checkout_confirmar(rv, 'op-1');
  perform tests.eq((r ->> 'confirmado')::boolean, true, 'K · confirmado');
  ord := (r ->> 'order_id')::uuid;
  perform tests.ok(r ->> 'folio' ~ '^S[0-9]{6,}$', 'P · folio del SERVIDOR con formato legacy S<n> (D-CC6-11: un solo modelo; el origen va en metadata)');
  perform tests.eq((select shipping_meta ->> 'source' from public.orders where id = (r ->> 'order_id')::uuid), 'cc_checkout', 'P · origen en metadata, no en el folio');
  perform tests.eq(r ->> 'status', 'pending_payment', 'V · estado W1 inicial');
  perform tests.eq((r ->> 'total')::numeric, 2500::numeric, 'V · total = el de crear_pedido');
  perform tests.eq(r ->> 'estado_pago', 'pending', 'S · pago pendiente (W2)');
  perform tests.eq((r ->> 'saldo')::numeric, 2500::numeric, 'S · saldo = total');
  perform tests.ok(r -> 'acciones_pago' @> '["transferencia","tarjeta"]', 'S · acciones de pago permitidas');
  perform tests.ok(r::text not ilike '%cobrado%' and r::text not ilike '%reconcil%' and r::text not ilike '%cost%', 'AL · sin internals financieros');
  -- pedido W1 real
  perform tests.ok(exists (select 1 from public.orders where id = ord and doctor_id = v_doc and external_ref = (r ->> 'folio') and status = 'pending_payment' and payment_status = 'pending' and total = 2500), 'P · pedido canónico con doctor_id, folio y total');
  perform tests.eq((select count(*) from public.order_items where order_id = ord), 2::bigint, 'P · 2 renglones');
  perform tests.eq((select unit_price from public.order_items where order_id = ord and product_id = pA), 1000::numeric, 'P · precio del renglón = precio_de (W1), no del cliente');
  perform tests.eq((select shipping_meta -> 'address' ->> 'cp' from public.orders where id = ord), '82000', 'R · la dirección de LA revisión confirmada viaja en shipping_meta (snapshot)');
  perform tests.eq((select shipping_meta ->> 'cart_id' from public.orders where id = ord), cD::text, 'W · trazabilidad carrito → pedido');
  perform tests.ok((select shipping_meta ->> 'seller_profile_id' is null and shipping_meta ->> 'seller' is null from public.orders where id = ord), 'Q · sin asesor ni cartera: sin vendedor (no se inventa)');
  -- carrito convertido, revisión consumida, operación registrada
  perform tests.act_as_service();
  perform tests.ok((select estado = 'converted' and converted_order_id = ord from public.cc_carts where id = cD), 'W · carrito converted apuntando al pedido real');
  perform tests.ok((select consumed_at is not null and order_id = ord from public.cc_checkout_reviews where id = (select id from public.cc_checkout_reviews where cart_id = cD order by created_at desc limit 1)), 'H · revisión consumida');
  perform tests.eq((select count(*) from public.cc_checkout_operations where cart_id = cD and operation_id = 'op-1' and order_id = ord), 1::bigint, 'L · operación registrada');
  perform tests.ok(exists (select 1 from public.cc_checkout_events where cart_id = cD and tipo = 'order_created') and exists (select 1 from public.cc_checkout_events where cart_id = cD and tipo = 'cart_converted'), 'AI · eventos durables');
  perform tests.ok(exists (select 1 from public.cc_cart_events where cart_id = cD and tipo = 'converted'), 'AI · evento converted en el carrito (CC-5)');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''doctor'', null, %L, %L, 1, ''x'')', cD, v_doc, pA), 'CARRITO_CERRADO', 'AC · carrito convertido no muta');
  -- sin pagos, sin CFDI, sin inventario
  perform tests.eq((select count(*) from public.payment_entries), pe0, 'AF · sin payment_entries');
  perform tests.eq((select sum(quantity)::int from public.lots where product_id = pA), q0, 'AH · inventario intacto (sin reserva)');
  perform tests.eq((select payment_status from public.orders where id = ord), 'pending', 'AE · no marcado paid');
  perform tests.eq((select count(*) from public.fiscal_documents where order_id = ord), 0::bigint, 'AG · sin CFDI (fiscal_documents, W3)');
  -- continuidad: la herramienta de pedidos de CC-4 lo ve; otro doctor no
  r := public.cc_ia_estado_pedido(v_doc, null);
  perform tests.eq((r -> 'pedidos' -> 0 ->> 'folio'), (select external_ref from public.orders where id = ord), 'AJ · obtener_estado_pedido ve el pedido nuevo de inmediato');
  perform tests.eq(jsonb_array_length(public.cc_ia_estado_pedido(v_doc2, null) -> 'pedidos'), 0, 'AK · otro doctor no lo ve');
  perform tests.act_as(v_doc2);
  perform tests.eq((select count(*) from public.orders where id = ord), 0::bigint, 'AK · RLS de orders: otro doctor no lo lee');
  perform tests.act_as(v_doc);

  -- ══ idempotencia (L/T/U/S/W) ════════════════════════════════════════════════
  r := public.cc_checkout_confirmar(rv, 'op-1');
  perform tests.ok((r ->> 'idempotente')::boolean and (r ->> 'order_id')::uuid = ord, 'T · misma operación → mismo pedido (respuesta perdida)');
  r := public.cc_checkout_confirmar(rv, 'op-2');
  perform tests.ok((r ->> 'idempotente')::boolean and (r ->> 'order_id')::uuid = ord and r ->> 'motivo' = 'YA_CONVERTIDO', 'S/AD · otra operación sobre carrito convertido → el pedido existente, nunca otro');
  perform tests.eq((select count(*) from public.orders), o0 + 1, 'V · exactamente un pedido');
  r := public.cc_checkout_revisar(cD);
  perform tests.ok(r -> 'problemas' @> '["YA_CONVERTIDO"]' and (r ->> 'order_id')::uuid = ord, 'AD · revisar un convertido devuelve el pedido');
  -- nuevo carrito activo tras conversión
  perform tests.act_as_service();
  c2 := (public.cc_carrito_abrir('doctor', null, v_doc) ->> 'cart_id')::uuid;
  perform tests.ok(c2 <> cD and (select count(*) from public.cc_carts where profile_id = v_doc and estado = 'active') = 1, 'W · abrir tras convertir crea exactamente un carrito activo nuevo');
  perform public.cc_carrito_agregar(c2, 'doctor', null, v_doc, pA, 1, 'b1');
  perform tests.act_as(v_doc);
  rv2 := (public.cc_checkout_revisar(c2) ->> 'review_id')::uuid;
  r := public.cc_checkout_confirmar(rv2, 'op-1');
  perform tests.ok((r ->> 'confirmado')::boolean and not (r ->> 'idempotente')::boolean, 'U · el libro de operaciones es por carrito: op-1 en otro carrito es una operación nueva');
  -- Q · vendedor derivado del servidor: CC-7 · cartera canónica (cc_cartera, la asigna Dirección) → metadata compatible con comisiones
  perform tests.act_as_service();
  insert into public.cc_cartera (profile_id, seller_profile_id) values (v_doc, v_pos);   -- CC-7 · la cartera es la autoridad (meta ya no cuenta)
  perform tests.act_as(v_doc);
  perform tests.ok((select shipping_meta ->> 'seller_profile_id' is null from public.orders where id = (r ->> 'order_id')::uuid), 'Q · (el pedido anterior se creó antes de asignar cartera)');
  perform tests.ok(r ->> 'folio' ~ '^S[0-9]{6,}$' and r ->> 'folio' <> (select external_ref from public.orders where id = ord), 'P · folio único por pedido');

  -- ══ carrito cambiado tras revisar (L/M/N) ═══════════════════════════════════
  perform tests.act_as_service();
  c2 := (public.cc_carrito_abrir('doctor', null, v_doc) ->> 'cart_id')::uuid;
  perform public.cc_carrito_agregar(c2, 'doctor', null, v_doc, pA, 1, 'c1');
  perform tests.act_as(v_doc);
  r := public.cc_checkout_revisar(c2); rv := (r ->> 'review_id')::uuid;
  perform tests.act_as_service();
  perform public.cc_carrito_agregar(c2, 'doctor', null, v_doc, pB, 3, 'c2');   -- el usuario (u otra pestaña) cambió el carrito
  perform tests.act_as(v_doc);
  r := public.cc_checkout_confirmar(rv, 'op-c1');
  perform tests.eq(r ->> 'motivo', 'CARRITO_CAMBIO', 'M · revisión vieja (rev distinta) → CARRITO_CAMBIO, nada se compra');
  perform tests.eq((r -> 'proyeccion' ->> 'n_items')::int, 2, 'M · devuelve la proyección fresca para re-revisar');
  perform tests.eq((select count(*) from public.orders), o0 + 2, 'M · sin pedido nuevo');
  rv2 := rv;   -- la revisión vieja (rev desactualizada)
  r := public.cc_checkout_revisar(c2); rv := (r ->> 'review_id')::uuid; n := (r ->> 'cart_rev')::int;
  r := public.cc_checkout_confirmar(rv, 'op-c2', n - 1);
  perform tests.eq(r ->> 'motivo', 'CARRITO_CAMBIO', 'L · expected_cart_rev del cliente desactualizado → rechazo');
  r := public.cc_checkout_confirmar(rv2, 'op-c1');
  perform tests.eq(r ->> 'motivo', 'CARRITO_CAMBIO', 'U · un intento RECHAZADO no registra operación: reutilizar su id con la revisión vieja es otro intento (sigue rechazado por rev)');

  -- ══ precio cambiado tras revisar (N/O) ══════════════════════════════════════
  perform tests.act_as_service();
  update public.products set price = 1200 where id = pA;
  perform tests.act_as(v_doc);
  r := public.cc_checkout_confirmar(rv, 'op-c3');
  perform tests.eq(r ->> 'motivo', 'PRECIO_CAMBIO', 'N · el precio cambió entre revisar y confirmar → no se compra en silencio');
  perform tests.ok((r ->> 'total_revisado')::numeric = 2500 and (r ->> 'total_actual')::numeric = 2700, 'N · informa total revisado vs actual');
  r := public.cc_checkout_revisar(c2); rv := (r ->> 'review_id')::uuid;
  perform tests.eq((r ->> 'total')::numeric, 2700::numeric, 'N · nueva revisión al precio actual');

  -- ══ stock perdido tras revisar (O/P) ════════════════════════════════════════
  perform tests.act_as_service();
  update public.lots set expiry_date = current_date - 3 where product_id = pB;   -- todos los lotes de B caducan (−3: hoy_local es Mazatlán, no UTC): disponible = 0
  perform tests.act_as(v_doc);
  r := public.cc_checkout_confirmar(rv, 'op-c4');
  perform tests.eq(r ->> 'motivo', 'NO_LISTO', 'O · sin disponibilidad → rechazo');
  perform tests.ok(r -> 'problemas' @> jsonb_build_array(jsonb_build_object('product_id', pB, 'problema', 'SIN_DISPONIBILIDAD')), 'O · identifica el producto sin stock; no quita ni sustituye');
  perform tests.eq((select count(*) from public.orders), o0 + 2, 'O · sin pedido inválido');
  perform tests.act_as_service();
  perform tests.eq((select estado from public.cc_carts where id = c2), 'active', 'X · tras fallar, el carrito sigue activo');
  update public.lots set expiry_date = current_date + 365 where product_id = pB;
  update public.products set sellable = false where id = pB;
  perform tests.act_as(v_doc);
  r := public.cc_checkout_confirmar(rv, 'op-c5');
  perform tests.ok(r ->> 'motivo' = 'NO_LISTO' and r -> 'problemas' @> jsonb_build_array(jsonb_build_object('product_id', pB, 'problema', 'NO_VENDIBLE')), 'Q · producto deshabilitado tras revisar → rechazo');
  perform tests.act_as_service();
  update public.products set sellable = true where id = pB;

  -- ══ revisión expirada (R) ═══════════════════════════════════════════════════
  update public.cc_checkout_reviews set expires_at = now() - interval '1 minute' where id = rv;
  perform tests.act_as(v_doc);
  r := public.cc_checkout_confirmar(rv, 'op-c6');
  perform tests.eq(r ->> 'motivo', 'REVISION_EXPIRADA', 'R · revisión vencida → volver a revisar');
  r := public.cc_checkout_revisar(c2); rv := (r ->> 'review_id')::uuid; n := (r ->> 'cart_rev')::int;
  rv2 := (public.cc_checkout_revisar(c2) ->> 'review_id')::uuid;   -- segunda revisión vigente del mismo carrito
  r := public.cc_checkout_confirmar(rv, 'op-c7', n);
  perform tests.ok((r ->> 'confirmado')::boolean and (r ->> 'total')::numeric = 2700, 'K · con revisión fresca y rev correcta confirma al precio actual');
  ord := (r ->> 'order_id')::uuid;
  perform tests.act_as_service();   -- (la RLS de profiles ocultaría el email del vendedor al doctor)
  perform tests.ok((select shipping_meta ->> 'seller_profile_id' = v_pos::text and shipping_meta ->> 'seller_origen' = 'cartera' and shipping_meta ->> 'seller' = (select email from public.profiles where id = v_pos) from public.orders where id = ord), 'Q · vendedor = dueño de cartera, con email para el estimador de comisiones');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op-c7'')', rv2), 'IDEMPOTENCIA_CONFLICTO', 'U · mismo operation_id COMPLETADO con otra revisión del mismo carrito → conflicto');
  r := public.cc_checkout_confirmar(rv2, 'op-c8');
  perform tests.ok((r ->> 'idempotente')::boolean and (r ->> 'order_id')::uuid = ord and r ->> 'motivo' = 'YA_CONVERTIDO', 'S · la segunda revisión vigente ya no crea otro pedido (carrito convertido)');
  perform tests.eq((select count(*) from public.orders), o0 + 3, 'V · tres pedidos en total, uno por conversión');
  -- eventos: sin transcript ni dirección completa innecesaria
  perform tests.act_as_service();
  perform tests.ok(exists (select 1 from public.cc_checkout_events where cart_id = c2 and tipo = 'confirmation_rejected_price_changed') and exists (select 1 from public.cc_checkout_events where cart_id = c2 and tipo = 'confirmation_rejected_stock') and exists (select 1 from public.cc_checkout_events where cart_id = c2 and tipo = 'confirmation_rejected_expired') and exists (select 1 from public.cc_checkout_events where cart_id = c2 and tipo = 'confirmation_rejected_changed_cart'), 'AI · cada rechazo dejó su evento');
  perform tests.throws('delete from public.cc_checkout_events', 'APPEND_ONLY', 'AI · eventos append-only');
  perform tests.act_as(v_admin);
  perform tests.ok((select count(*) from public.cc_checkout_events) > 5, 'AI · Dirección audita');
  perform tests.throws('select count(*) from public.cc_checkout_reviews', 'permission denied', 'AL · ni Dirección lee revisiones directo');
end $t$;
rollback;
