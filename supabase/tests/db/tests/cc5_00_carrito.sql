-- CC-5 · Carrito canónico: autoridad por posesión/perfil (conocer el id no da acceso), un activo
-- por dueño, mutaciones idempotentes con hash de payload, cantidades validadas, producto visible y
-- vendible, proyección con precio/disponibilidad CALCULADOS según el lector (sin persistir),
-- eventos append-only, nada de precio/costo/stock en el modelo, clientes sin acceso directo.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor'); v_pos uuid := tests.user('pos'); v_sus uuid := tests.user('doctor');
  hA text := repeat('1', 64); hB text := repeat('2', 64); vA uuid; vB uuid; cA uuid; cB uuid; cD uuid; cv uuid;
  pA uuid; pB uuid; pOculto uuid; pNoVend uuid; r jsonb; r2 jsonb; n int; lst uuid; txt text;
begin
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;
  update public.profiles set active = false where id = v_sus;
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}' where id = v_pos;
  pA := tests.producto_fam('Rellenos', 'Hyalux', 1000); pB := tests.producto_fam('Rellenos', 'Hyalux', 500); pOculto := tests.producto_cat('Rellenos', 800); pNoVend := tests.producto_fam('Rellenos', 'Hyalux', 1);
  update public.products set name = 'Hyalux Deep' where id = pA; update public.products set name = 'Hyalux Lips' where id = pB;
  update public.products set name = 'Oculto', show_landing = false, show_portal = false where id = pOculto;
  update public.products set name = 'Padre', sellable = false where id = pNoVend;
  insert into public.product_volume_prices (product_id, min_quantity, price, active) values (pA, 5, 900, true);
  insert into public.product_costs (product_id, unit_cost) values (pA, 333.33) on conflict (product_id) do nothing;
  perform tests.stock(pA, 'L-A', 10);
  vA := (public.cc_visitante_abrir(null, hA, '{}'::jsonb, null) ->> 'visitor_id')::uuid;
  vB := (public.cc_visitante_abrir(null, hB, '{}'::jsonb, null) ->> 'visitor_id')::uuid;

  -- ══ privilegios ═════════════════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_carrito_abrir(''visitor'', %L, null)', hA), 'permission denied', 'anon no invoca comandos de carrito');
  perform tests.throws('select count(*) from public.cc_carts', 'permission denied', 'anon no lee carritos');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.cc_carrito_abrir(''doctor'', null, %L)', v_doc), 'permission denied', 'doctor no invoca comandos directo (solo por la Edge)');
  perform tests.throws('select count(*) from public.cc_cart_items', 'permission denied', 'doctor no lee items directo');
  perform tests.throws('insert into public.cc_cart_items (cart_id, product_id, quantity) values (gen_random_uuid(), gen_random_uuid(), 1)', 'permission denied', 'doctor no escribe items');
  perform tests.eq((select count(*) from public.cc_cart_events), 0::bigint, 'doctor ve eventos vacíos (RLS)');
  perform tests.act_as_service();

  -- ══ abrir: uno activo por dueño; reanudar devuelve el mismo ═════════════════
  r := public.cc_carrito_abrir('visitor', hA, null);
  cA := (r ->> 'cart_id')::uuid;
  perform tests.eq(r ->> 'dueno', 'visitor', 'CART1 · carrito del visitante');
  perform tests.eq((public.cc_carrito_abrir('visitor', hA, null) ->> 'cart_id')::uuid, cA, 'G · reabrir devuelve el MISMO carrito activo');
  perform tests.throws('select public.cc_carrito_abrir(''visitor'', repeat(''e'', 64), null)', 'SESION_INVALIDA', 'CART3 · token inventado no abre');
  cB := (public.cc_carrito_abrir('visitor', hB, null) ->> 'cart_id')::uuid;
  perform tests.ok(cB <> cA, 'otro visitante → otro carrito');
  r := public.cc_carrito_abrir('doctor', null, v_doc);
  cD := (r ->> 'cart_id')::uuid;
  perform tests.eq(r ->> 'dueno', 'profile', 'CART4 · carrito del perfil');
  perform tests.eq((public.cc_carrito_abrir('doctor', null, v_doc) ->> 'cart_id')::uuid, cD, 'G · uno activo por perfil');
  perform tests.throws(format('select public.cc_carrito_abrir(''doctor'', null, %L)', v_sus), 'CUENTA_SUSPENDIDA', 'CART27 · suspendido no abre');
  perform tests.throws('select public.cc_carrito_abrir(''seller'', null, ' || quote_literal(v_pos) || ')', 'NO_AUTORIZADO', 'un vendedor no tiene carrito propio por esta vía');
  -- vínculo con conversación: solo conversaciones PROPIAS
  cv := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  r := public.cc_carrito_abrir('visitor', hA, null, cv);
  perform tests.eq((r ->> 'conversation_id')::uuid, cv, 'I · el carrito se liga a la conversación del dueño');
  perform tests.throws(format('select public.cc_carrito_abrir(''visitor'', %L, null, %L)', hB, cv), 'NO_AUTORIZADO', 'I · no se liga a una conversación ajena');

  -- ══ autoridad cruzada (CART2/B/C/D/E) ═══════════════════════════════════════
  perform tests.throws(format('select public.cc_carrito_ver(%L, ''visitor'', %L, null)', cA, hB), 'NO_AUTORIZADO', 'B · visitante B no lee el carrito de A (aunque conozca el id)');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''visitor'', %L, null, %L, 1, ''op'')', cA, hB, pA), 'NO_AUTORIZADO', 'C · visitante B no modifica el de A');
  perform tests.throws(format('select public.cc_carrito_ver(%L, ''doctor'', null, %L)', cD, v_doc2), 'NO_AUTORIZADO', 'D · doctor 2 no lee el de doctor 1');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''doctor'', null, %L, %L, 1, ''op'')', cD, v_doc2, pA), 'NO_AUTORIZADO', 'E · doctor 2 no modifica el de doctor 1');
  perform tests.throws(format('select public.cc_carrito_ver(%L, ''doctor'', null, %L)', cA, v_doc), 'NO_AUTORIZADO', 'un doctor no lee el carrito de un visitante');
  perform tests.throws(format('select public.cc_carrito_ver(%L, ''seller'', null, %L)', cA, v_pos), 'NO_AUTORIZADO', 'F · vendedor NO asignado no lee');
  perform tests.throws(format('select public.cc_carrito_ver(gen_random_uuid(), ''visitor'', %L, null)', hA), 'NO_AUTORIZADO', 'A · uuid inexistente = no autorizado (sin revelar)');

  -- ══ agregar / cantidades / producto ═════════════════════════════════════════
  r := public.cc_carrito_agregar(cA, 'visitor', hA, null, pA, 2, 'op-1');
  perform tests.eq((r ->> 'qty_despues')::int, 2, 'agregar 2');
  perform tests.eq((r ->> 'oferta_elegible')::boolean, true, 'W · vacío→no vacío marca elegibilidad de oferta');
  r := public.cc_carrito_agregar(cA, 'visitor', hA, null, pA, 3, 'op-2');
  perform tests.eq((r ->> 'qty_despues')::int, 5, 'agregar suma (2+3)');
  perform tests.eq((r ->> 'oferta_elegible')::boolean, false, 'W · la segunda adición no vuelve a disparar');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''visitor'', %L, null, %L, -1, ''op-neg'')', cA, hA, pA), 'CANTIDAD_INVALIDA', 'S · negativo');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''visitor'', %L, null, %L, 0, ''op-0'')', cA, hA, pA), 'CANTIDAD_INVALIDA', 'T · agregar 0 se rechaza (quitar es explícito)');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''visitor'', %L, null, %L, 5000, ''op-big'')', cA, hA, pA), 'CANTIDAD_INVALIDA', 'U · > 999 se rechaza');
  r := public.cc_carrito_agregar(cA, 'visitor', hA, null, pA, 999, 'op-cap');
  perform tests.eq((r ->> 'qty_despues')::int, 999, 'U · la suma se acota a 999');
  r := public.cc_carrito_actualizar(cA, 'visitor', hA, null, pA, 4, 'op-3');
  perform tests.eq((r ->> 'qty_despues')::int, 4, 'actualizar fija la cantidad absoluta');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''visitor'', %L, null, %L, 1, ''op-oc'')', cA, hA, pOculto), 'PRODUCTO_NO_DISPONIBLE', 'Q · oculto no se agrega');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''visitor'', %L, null, %L, 1, ''op-nx'')', cA, hA, gen_random_uuid()), 'PRODUCTO_NO_DISPONIBLE', 'R · inexistente no se agrega');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''visitor'', %L, null, %L, 1, ''op-nv'')', cA, hA, pNoVend), 'PRODUCTO_NO_VENDIBLE', 'P · padre no vendible no se agrega');
  r := public.cc_carrito_agregar(cA, 'visitor', hA, null, pB, 1, 'op-4');
  perform tests.eq((r ->> 'n_items')::int, 2, 'dos líneas');

  -- ══ idempotencia (V/W) ═══════════════════════════════════════════════════════
  r2 := public.cc_carrito_agregar(cA, 'visitor', hA, null, pB, 1, 'op-4');
  perform tests.eq((r2 ->> 'idempotente')::boolean, true, 'V · misma operación = resultado cacheado');
  perform tests.eq((select quantity from public.cc_cart_items where cart_id = cA and product_id = pB), 1, 'V · la cantidad NO se duplica por reintento');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''visitor'', %L, null, %L, 7, ''op-4'')', cA, hA, pB), 'IDEMPOTENCIA_CONFLICTO', 'W · mismo id con payload distinto = conflicto');
  r := public.cc_carrito_agregar(cA, 'visitor', hA, null, pB, 1, null);
  perform tests.eq((r ->> 'qty_despues')::int, 2, 'sin operation_id no hay cache (mutación nueva)');

  -- ══ quitar / vaciar ═════════════════════════════════════════════════════════
  r := public.cc_carrito_actualizar(cA, 'visitor', hA, null, pB, 0, 'op-5');
  perform tests.eq((r ->> 'qty_despues')::int, 0, 'T · actualizar a 0 = quitar (documentado)');
  perform tests.eq((select count(*) from public.cc_cart_items where cart_id = cA), 1::bigint, 'queda una línea');
  r := public.cc_carrito_quitar(cA, 'visitor', hA, null, pB, 'op-6');
  perform tests.eq((r ->> 'qty_antes')::int, 0, 'quitar algo ausente es inofensivo');
  r := public.cc_carrito_vaciar(cA, 'visitor', hA, null, 'op-7');
  perform tests.eq((r ->> 'n_items')::int, 0, 'vaciar');
  r := public.cc_carrito_agregar(cA, 'visitor', hA, null, pA, 2, 'op-8');
  perform tests.eq((r ->> 'oferta_elegible')::boolean, true, 'W · tras vaciar, volver a vacío→no vacío vuelve a ser elegible (sin oferta previa)');

  -- ══ proyección: precio/disponibilidad según el LECTOR, nada persistido ══════
  r := public.cc_carrito_ver(cA, 'visitor', hA, null);
  perform tests.eq(r -> 'items' -> 0 -> 'precio' ->> 'estado', 'requiere_verificacion', 'M · visitante: precio requiere verificación');
  perform tests.eq(r -> 'total' ->> 'estado', 'requiere_verificacion', 'M · sin total inventado');
  perform tests.eq(r -> 'items' -> 0 ->> 'disponibilidad', 'requiere_verificacion', 'O · disponibilidad también');
  perform tests.eq(r -> 'items' -> 0 ->> 'nombre', 'Hyalux Deep', 'M · identidad desde products (no copiada)');
  perform public.cc_carrito_agregar(cD, 'doctor', null, v_doc, pA, 2, 'd-1');
  r := public.cc_carrito_ver(cD, 'doctor', null, v_doc);
  perform tests.eq((r -> 'items' -> 0 -> 'precio' ->> 'unitario')::numeric, 1000::numeric, 'N · verificado: precio por autoridad (precio_de)');
  perform tests.eq((r -> 'total' ->> 'monto')::numeric, 2000::numeric, 'N · total calculado');
  perform tests.eq(r -> 'items' -> 0 ->> 'disponibilidad', 'disponible', 'O · disponibilidad real agregada');
  perform public.cc_carrito_actualizar(cD, 'doctor', null, v_doc, pA, 6, 'd-2');
  r := public.cc_carrito_ver(cD, 'doctor', null, v_doc);
  perform tests.eq((r -> 'items' -> 0 -> 'precio' ->> 'unitario')::numeric, 900::numeric, 'N · cambiar cantidad cambia el precio proyectado (volumen)');
  perform tests.eq((r -> 'items' -> 0 -> 'precio' ->> 'por_volumen')::boolean, true, 'N · por volumen');
  -- AB · cambia el precio después de agregar → la proyección refleja el nuevo
  update public.products set price = 1200 where id = pA;
  r := public.cc_carrito_actualizar(cD, 'doctor', null, v_doc, pA, 1, 'd-3');
  r := public.cc_carrito_ver(cD, 'doctor', null, v_doc);
  perform tests.eq((r -> 'items' -> 0 -> 'precio' ->> 'unitario')::numeric, 1200::numeric, 'AB · precio nuevo (nunca hubo snapshot)');
  -- AC · stock cambia → disponibilidad cambia
  perform public.cc_carrito_agregar(cD, 'doctor', null, v_doc, pB, 1, 'd-4');
  r := public.cc_carrito_ver(cD, 'doctor', null, v_doc);
  perform tests.eq((select x ->> 'disponibilidad' from jsonb_array_elements(r -> 'items') x where (x ->> 'product_id')::uuid = pB), 'no_disponible', 'AC · sin lotes = no disponible, pero sigue en el carrito (CART16)');
  perform tests.stock(pB, 'L-B', 3);
  r := public.cc_carrito_ver(cD, 'doctor', null, v_doc);
  perform tests.eq((select x ->> 'disponibilidad' from jsonb_array_elements(r -> 'items') x where (x ->> 'product_id')::uuid = pB), 'disponible', 'AC · entra stock → disponible');
  -- doctor sin verificar: conserva carrito, sin precio
  r := public.cc_carrito_abrir('doctor', null, v_nov);
  perform public.cc_carrito_agregar((r ->> 'cart_id')::uuid, 'doctor', null, v_nov, pA, 1, 'n-1');
  r := public.cc_carrito_ver((r ->> 'cart_id')::uuid, 'doctor', null, v_nov);
  perform tests.eq(r -> 'items' -> 0 -> 'precio' ->> 'estado', 'requiere_verificacion', 'AE · no verificado: carrito sí, precio no');
  -- AS · nada de costo/margen/fiscal/lotes
  txt := public.cc_carrito_ver(cD, 'doctor', null, v_doc)::text;
  perform tests.ok(txt not like '%333.33%', 'AS · sin costo unitario');
  perform tests.ok(txt not ilike '%unit_cost%' and txt not ilike '%"cost%' and txt not ilike '%margen%', 'AS · sin claves de costo/margen');
  perform tests.ok(txt not ilike '%lot_code%' and txt not ilike '%lot_id%' and txt not like '%L-A%', 'AS · sin lotes');
  perform tests.ok(txt not ilike '%sat_clave%' and txt not ilike '%fiscal%', 'AS · sin fiscal');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'cc_cart_items' and column_name in ('unit_price', 'price', 'subtotal', 'discount', 'stock')), 'CART17 · el modelo no tiene columnas de autoridad económica');
  -- producto desactivado después: permanece, marcado
  update public.products set active = false where id = pB;
  r := public.cc_carrito_ver(cD, 'doctor', null, v_doc);
  perform tests.eq((select x ->> 'disponibilidad' from jsonb_array_elements(r -> 'items') x where (x ->> 'product_id')::uuid = pB), 'no_vendible', 'P · desactivado después: queda marcado no vendible');
  update public.products set active = true where id = pB;

  -- ══ vendedor asignado: lectura, no mutación ═════════════════════════════════
  perform public.cc_solicitar_asesor(cv, 'visitor', hA, null);
  perform public.cc_asignar_asesor(cv, v_admin, v_pos);   -- CC-7 · asigna Dirección
  r := public.cc_carrito_ver(cA, 'seller', null, v_pos);
  perform tests.eq(r ->> 'rol', 'asesor', 'H · asesor asignado lee el resumen');
  perform tests.eq(r -> 'items' -> 0 -> 'precio' ->> 'estado', 'autorizado', 'H · ve precio porque SU rol lo tiene (pos)');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''seller'', null, %L, %L, 1, ''s-1'')', cA, v_pos, pA), 'NO_AUTORIZADO', 'I · asesor no muta');
  perform tests.throws(format('select public.cc_carrito_vaciar(%L, ''seller'', null, %L, ''s-2'')', cA, v_pos), 'NO_AUTORIZADO', 'I · ni vacía');
  perform public.cc_iniciar_asesoria(cv, v_pos);
  perform tests.eq(public.cc_carrito_ver(cA, 'seller', null, v_pos) ->> 'rol', 'asesor', 'H · en asesoría activa sigue leyendo');
  perform public.cc_terminar_asesoria(cv, v_pos);
  perform tests.throws(format('select public.cc_carrito_ver(%L, ''seller'', null, %L)', cA, v_pos), 'NO_AUTORIZADO', 'F · terminada la asesoría, el vendedor deja de ver');
  r := public.cc_carrito_ver(cA, 'admin', null, v_admin);
  perform tests.eq(r ->> 'rol', 'supervisor', 'Dirección supervisa (lectura)');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''admin'', null, %L, %L, 1, ''a-1'')', cA, v_admin, pA), 'NO_AUTORIZADO', 'Dirección tampoco muta el carrito del cliente');

  -- ══ eventos append-only sin transcript ══════════════════════════════════════
  perform tests.ok(exists (select 1 from public.cc_cart_events where cart_id = cA and tipo = 'first_item_added') and exists (select 1 from public.cc_cart_events where cart_id = cA and tipo = 'emptied'), 'U · eventos de ciclo registrados');
  perform tests.throws('delete from public.cc_cart_events', 'APPEND_ONLY', 'U · eventos no se borran');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'cc_cart_events' and column_name in ('content', 'texto', 'price', 'unit_price')), 'AR · sin transcript ni precio en eventos');

  -- ══ no toca pedidos/dinero/inventario ═══════════════════════════════════════
  select count(*) into n from public.orders;
  perform tests.eq(n, 0, 'AH · 0 pedidos creados por el carrito');
  perform tests.eq((select sum(disponible)::int from public.v_stock_disponible where product_id = pA), 10, 'AG · agregar no reserva stock');
end $t$;
rollback;
