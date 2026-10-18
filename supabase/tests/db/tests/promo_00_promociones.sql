-- PROMO-1 (173) · promociones por vigencia: el ejemplo del dueño (Allergan: Botox 1 → $4,000, 5 → $3,800, 10 → $3,600;
-- SkinVive $3,600; HArmonyCa $6,100; del 16 al 25) entra en precio_de/3 solo mientras dura; nunca se cobra más que el precio
-- normal; por lista; lo que se muestra; administración solo Dirección/Facturación; validación; bitácora; crear_pedido lo usa.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor');
  botox uuid; skin uuid; harm uuid; otro uuid; hoy date; r jsonb; r2 jsonb; pid uuid; v_may uuid; n int; v_cust uuid; o uuid; lin jsonb; ord jsonb;
begin
  hoy := public._promo_hoy();   -- como dueño de la base (la función es interna)
  perform tests.act_as_service();
  botox := tests.product(4600); skin := tests.product(4500); harm := tests.product(8000); otro := tests.product(1000);
  update public.products set name = 'Botox 100 UI' where id = botox; update public.products set name = 'SkinVive' where id = skin; update public.products set name = 'HArmonyCa' where id = harm;
  perform tests.stock(botox, 'BTX', 50);
  update public.profiles set verified = false where id = v_nov;
  select id into v_may from public.price_lists where name = 'Mayoreo';
  if v_may is null then insert into public.price_lists (name) values ('Mayoreo') returning id into v_may; end if;
  v_cust := tests.cliente(v_doc);
  perform tests.act_as_owner();

  -- ══ 1 · permisos de administración ═══════════════════════════════════════════════════════════════
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.promocion_guardar(%L)', jsonb_build_object('nombre', 'xx', 'desde', hoy, 'hasta', hoy, 'lineas', jsonb_build_array(jsonb_build_object('product_id', botox, 'precio', 1)))), 'NO_AUTORIZADO', '1 · Ventas no crea promociones');
  perform tests.eq(jsonb_array_length(public.promociones_lista()), 0, '1 · Ventas no ve la lista de administración (vacía)');
  perform tests.act_as_anon();
  perform tests.throws('select public.promos_vigentes()', 'permission denied', '1 · anónimo no ve promociones');

  -- ══ 2 · la promo Allergan del dueño ══════════════════════════════════════════════════════════════
  perform tests.act_as(v_admin);
  r := public.promocion_guardar(jsonb_build_object('nombre', 'Promo Allergan', 'desde', hoy - 1, 'hasta', hoy + 1, 'lineas', jsonb_build_array(
         jsonb_build_object('product_id', botox, 'min_qty', 1, 'precio', 4000), jsonb_build_object('product_id', botox, 'min_qty', 5, 'precio', 3800), jsonb_build_object('product_id', botox, 'min_qty', 10, 'precio', 3600),
         jsonb_build_object('product_id', skin, 'precio', 3600), jsonb_build_object('product_id', harm, 'precio', 6100))));
  pid := (r ->> 'id')::uuid;
  perform tests.ok(r ->> 'estado' = 'vigente' and jsonb_array_length(r -> 'lineas') = 5 and (r -> 'lineas' -> 0 ->> 'producto') = 'Botox 100 UI' and (r -> 'lineas' -> 0 ->> 'precio_normal')::numeric = 4600, '2 · se guarda con 5 renglones y el precio normal a la vista');
  perform tests.act_as(v_doc);
  perform tests.eq(public.precio_de(botox, null, 1), 4000::numeric, '2 · Botox 1 pieza: $4,000 (normal $4,600)');
  perform tests.eq(public.precio_de(botox, null, 4), 4000::numeric, '2 · Botox 4 piezas: sigue $4,000');
  perform tests.eq(public.precio_de(botox, null, 5), 3800::numeric, '2 · Botox 5 piezas: $3,800');
  perform tests.eq(public.precio_de(botox, null, 9), 3800::numeric, '2 · Botox 9 piezas: $3,800');
  perform tests.eq(public.precio_de(botox, null, 10), 3600::numeric, '2 · Botox 10 piezas: $3,600');
  perform tests.eq(public.precio_de(botox, null, 25), 3600::numeric, '2 · Botox 25 piezas: $3,600 (10 o más)');
  perform tests.eq(public.precio_de(skin, null, 1), 3600::numeric, '2 · SkinVive $3,600');
  perform tests.eq(public.precio_de(harm, null, 3), 6100::numeric, '2 · HArmonyCa $6,100');
  perform tests.eq(public.precio_de(otro, null, 1), 1000::numeric, '2 · un producto fuera de la promo no cambia');
  r := public.promos_vigentes();
  perform tests.ok(jsonb_array_length(r) = 5 and (select count(*) from jsonb_array_elements(r) x where x ->> 'nombre' = 'Promo Allergan' and (x ->> 'product_id')::uuid = botox) = 3 and (r -> 0 ->> 'hasta')::date = hoy + 1, '2 · el portal ve los escalones vigentes con nombre y hasta cuándo');
  perform tests.act_as(v_nov);
  perform tests.eq(jsonb_array_length(public.promos_vigentes()), 0, '2 · un doctor sin verificar no ve promociones (misma barrera que el precio)');

  -- ══ 3 · nunca se cobra más que el precio normal; volumen y lista siguen contando ═══════════════════
  perform tests.act_as_service();
  insert into public.product_volume_prices (product_id, min_quantity, price) values (botox, 20, 3000);   -- volumen más barato que la promo
  insert into public.product_prices (product_id, list_id, price) values (skin, v_may, 3200);            -- Mayoreo ya por debajo de la promo
  perform tests.act_as(v_admin);
  perform tests.eq(public.precio_de(botox, null, 20), 3000::numeric, '3 · si el volumen es más barato, gana el volumen');
  perform tests.eq(public.precio_de(skin, v_may, 1), 3200::numeric, '3 · si la lista del cliente ya es más baja, se respeta la lista');
  perform tests.eq(public.precio_de(skin, null, 1), 3600::numeric, '3 · General sí recibe la promo');

  -- ══ 4 · promo solo para una lista ═════════════════════════════════════════════════════════════════
  r := public.promocion_guardar(jsonb_build_object('nombre', 'Solo Mayoreo', 'desde', hoy, 'hasta', hoy, 'listas', jsonb_build_array(v_may), 'lineas', jsonb_build_array(jsonb_build_object('product_id', otro, 'precio', 700))));
  perform tests.eq(public.precio_de(otro, v_may, 1), 700::numeric, '4 · aplica a la lista elegida');
  perform tests.eq(public.precio_de(otro, null, 1), 1000::numeric, '4 · y no a General');
  perform tests.throws(format('select public.promocion_guardar(%L)', jsonb_build_object('nombre', 'xx', 'desde', hoy, 'hasta', hoy, 'listas', jsonb_build_array(gen_random_uuid()), 'lineas', jsonb_build_array(jsonb_build_object('product_id', otro, 'precio', 1)))), 'lista de precios desconocida', '4 · lista inexistente se rechaza');

  -- ══ 5 · vigencia: pasada, futura, pausada ═════════════════════════════════════════════════════════
  r := public.promocion_guardar(jsonb_build_object('nombre', 'Pasada', 'desde', hoy - 10, 'hasta', hoy - 1, 'lineas', jsonb_build_array(jsonb_build_object('product_id', harm, 'precio', 10))));
  perform tests.ok(r ->> 'estado' = 'vencida' and public.precio_de(harm, null, 1) = 6100, '5 · una promo vencida no aplica (sigue la vigente)');
  r := public.promocion_guardar(jsonb_build_object('nombre', 'Futura', 'desde', hoy + 1, 'hasta', hoy + 5, 'lineas', jsonb_build_array(jsonb_build_object('product_id', harm, 'precio', 10))));
  perform tests.ok(r ->> 'estado' = 'proxima' and public.precio_de(harm, null, 1) = 6100, '5 · una promo futura todavía no aplica');
  r := public.promocion_estado(pid, false);
  perform tests.ok(r ->> 'estado' = 'inactiva' and public.precio_de(botox, null, 1) = 4600 and public.precio_de(harm, null, 1) = 8000, '5 · pausar la promo devuelve el precio normal al instante');
  r := public.promocion_estado(pid, true);
  perform tests.eq(public.precio_de(botox, null, 1), 4000::numeric, '5 · reactivar la vuelve a aplicar');
  perform tests.eq((select count(*)::int from jsonb_array_elements(public.promociones_lista()) x where x ->> 'estado' = 'vigente'), 2, '5 · la lista de administración distingue estados');
  perform tests.eq((select count(*)::int from jsonb_array_elements(public.promociones_lista(false))), 3, '5 · sin "todas": solo activas y no vencidas');

  -- ══ 6 · validación y edición ═══════════════════════════════════════════════════════════════════════
  perform tests.throws(format('select public.promocion_guardar(%L)', jsonb_build_object('nombre', 'xx', 'desde', hoy + 2, 'hasta', hoy, 'lineas', jsonb_build_array(jsonb_build_object('product_id', otro, 'precio', 1)))), 'posterior a', '6 · fechas al revés');
  perform tests.throws(format('select public.promocion_guardar(%L)', jsonb_build_object('nombre', 'xx', 'desde', hoy, 'hasta', hoy, 'lineas', '[]'::jsonb)), 'al menos un producto', '6 · sin productos');
  perform tests.throws(format('select public.promocion_guardar(%L)', jsonb_build_object('nombre', 'xx', 'desde', hoy, 'hasta', hoy, 'lineas', jsonb_build_array(jsonb_build_object('product_id', otro, 'precio', 0)))), 'mayor que 0', '6 · precio 0');
  perform tests.throws(format('select public.promocion_guardar(%L)', jsonb_build_object('nombre', 'xx', 'desde', hoy, 'hasta', hoy, 'lineas', jsonb_build_array(jsonb_build_object('product_id', otro, 'min_qty', 2, 'precio', 5), jsonb_build_object('product_id', otro, 'min_qty', 2, 'precio', 6)))), 'misma cantidad', '6 · escalones repetidos');
  perform tests.throws(format('select public.promocion_guardar(%L)', jsonb_build_object('nombre', 'xx', 'desde', hoy, 'hasta', hoy, 'lineas', jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'precio', 5)))), 'producto inexistente', '6 · producto desconocido');
  r := public.promocion_guardar(jsonb_build_object('id', pid, 'nombre', 'Promo Allergan octubre', 'desde', hoy - 1, 'hasta', hoy + 3, 'lineas', jsonb_build_array(jsonb_build_object('product_id', botox, 'min_qty', 1, 'precio', 4100))));
  perform tests.ok(r ->> 'nombre' = 'Promo Allergan octubre' and jsonb_array_length(r -> 'lineas') = 1 and public.precio_de(botox, null, 5) = 4100 and public.precio_de(skin, null, 1) = 4500, '6 · editar reemplaza los renglones completos');
  perform tests.act_as(v_bill);
  r := public.promocion_estado(pid, false);
  perform tests.ok(r ->> 'estado' = 'inactiva', '6 · Facturación también administra (como Precios)');
  perform tests.act_as(v_admin); perform public.promocion_estado(pid, true);
  perform tests.throws(format('insert into public.promociones (nombre, desde, hasta) values (''directo'', %L, %L)', hoy, hoy), 'permission denied', '6 · sin escritura directa');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'Promoción guardada' and resource_id = 'Promo Allergan') and exists (select 1 from public.audit_logs where action = 'Promoción pausada'), '6 · bitácora');

  -- ══ 7 · el pedido cobra el precio de la promo (misma autoridad) ═════════════════════════════════════
  perform tests.act_as(v_doc);
  o := gen_random_uuid();
  ord := public.crear_pedido(o, null, v_doc, jsonb_build_array(jsonb_build_object('product_id', botox, 'qty', 5)), '{"address":{"line1":"Calle 1","cp":"82000"}}'::jsonb, false, null);
  perform tests.eq((ord ->> 'total')::numeric, 20500::numeric, '7 · 5 Botox en promo = 5 × $4,100 (el servidor, no la pantalla)');

  -- ══ 8 · PROMO-PRO (174): la IA lo sabe, el doctor ve solo las de su lista, la promo mide sus ventas ═══════
  perform tests.act_as_service();
  r := public.cc_ia_precio(v_doc, botox, 5);
  perform tests.ok((r ->> 'en_promocion')::boolean and (r ->> 'precio_unitario')::numeric = 4100 and (r ->> 'precio_normal')::numeric = 4600
               and r -> 'promocion' ->> 'nombre' = 'Promo Allergan octubre' and (r -> 'promocion' ->> 'hasta')::date = hoy + 3 and jsonb_array_length(r -> 'promocion' -> 'escalones') = 1,
    '8 · la IA recibe la promoción (nombre, hasta, escalones) y el precio normal');
  r := public.cc_ia_precio(v_doc, otro, 1);
  perform tests.ok(not (r ->> 'en_promocion')::boolean and r ->> 'promocion' is null, '8 · sin promo vigente para el doctor (la de Mayoreo no es suya): nada que inventar');
  perform tests.act_as(v_doc);
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.promos_vigentes()) x where x ->> 'nombre' = 'Solo Mayoreo'), '8 · el doctor de General no ve la promo de Mayoreo');
  perform tests.act_as(v_pos);
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.promos_vigentes()) x where x ->> 'nombre' = 'Solo Mayoreo'), '8 · el personal ve todas (con sus listas)');
  perform tests.act_as(v_admin);
  r := (select x from jsonb_array_elements(public.promociones_lista()) x where (x ->> 'id')::uuid = pid);
  perform tests.ok((r -> 'ventas' ->> 'pedidos')::int = 1 and (r -> 'ventas' ->> 'piezas')::int = 5 and (r -> 'ventas' ->> 'importe')::numeric = 20500, '8 · la promoción reporta lo vendido con su precio durante su vigencia');

  -- ══ 9 · PROMO-4 (175): mandarla por correo y por el chat del sistema ═══════════════════════════════════
  perform tests.act_as_service();
  update public.profiles set email = null where id = v_nov;   -- (sin verificar: no entra a la audiencia de todos modos)
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.promocion_difundir(%L, array[''correo''])', pid), 'NO_AUTORIZADO', '9 · Ventas no manda promociones');
  perform tests.act_as(v_admin);
  r := public.promocion_difusion_previa(pid);
  perform tests.ok((r ->> 'audiencia')::int = 1 and r ->> 'texto' like 'Promo Allergan octubre (del % al % de %)%Botox 100 UI: $4,100%profesionales verificados%', '9 · vista previa: audiencia (doctores verificados con expediente) y el texto');
  perform tests.throws(format('select public.promocion_difundir(%L, array[''sms''])', pid), 'CANAL_INVALIDO', '9 · canal desconocido');
  r := public.promocion_difundir(pid, array['correo', 'chat']);
  perform tests.ok((r ->> 'audiencia')::int = 1 and (r ->> 'correo')::int = 1 and (r ->> 'chat')::int = 1 and (r ->> 'ya_enviados')::int = 0, '9 · se manda a 1 doctor por los dos canales');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.comm_outbox o where o.plantilla = 'promocion' and o.profile_id = v_doc and o.status = 'pendiente' and o.payload ->> 'nombre' = 'Promo Allergan octubre' and jsonb_array_length(o.payload -> 'lineas') = 1), '9 · el correo queda en la cola con la plantilla promocion y sus renglones');
  perform tests.ok(exists (select 1 from public.cc_messages m join public.cc_conversations c on c.id = m.conversation_id where c.profile_id = v_doc and m.actor_type = 'system' and m.client_message_id = 'promo:' || pid::text and m.content like '[promo:' || pid::text || ']' || E'\n' || 'Promo Allergan octubre%'), '9 · el chat del doctor recibe el mensaje de la promoción (con la marca de tarjeta, 177)');
  perform tests.act_as(v_admin);
  r := public.promocion_difundir(pid, array['correo', 'chat']);
  perform tests.ok((r ->> 'correo')::int = 0 and (r ->> 'chat')::int = 0 and (r ->> 'ya_enviados')::int = 2, '9 · repetir no duplica: ya lo tenían');
  r := (select x from jsonb_array_elements(public.promociones_lista()) x where (x ->> 'id')::uuid = pid);
  perform tests.ok((r -> 'difusion' ->> 'correo')::int = 1 and (r -> 'difusion' ->> 'chat')::int = 1, '9 · la lista muestra a cuántos se envió');
  perform public.promocion_estado(pid, false);
  perform tests.throws(format('select public.promocion_difundir(%L, array[''chat''])', pid), 'PROMO_NO_VIGENTE', '9 · una promo pausada no se manda');
  perform public.promocion_estado(pid, true);
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'Promoción enviada'), '9 · bitácora del envío');

  -- ══ 10 · PROMO-5 (176): eliminar solo lo que nunca se envió ni vendió ═════════════════════════════════
  perform tests.throws(format('select public.promocion_eliminar(%L)', pid), 'PROMO_CON_ENVIOS', '10 · una promo ya enviada no se borra (se pausa)');
  r := public.promocion_guardar(jsonb_build_object('nombre', 'Duplicada', 'desde', hoy, 'hasta', hoy + 1, 'lineas', jsonb_build_array(jsonb_build_object('product_id', otro, 'precio', 900))));
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.promocion_eliminar(%L)', r ->> 'id'), 'NO_AUTORIZADO', '10 · Ventas no borra');
  perform tests.act_as(v_admin);
  r2 := public.promocion_eliminar((r ->> 'id')::uuid);
  perform tests.ok((r2 ->> 'eliminada')::boolean, '10 · se borra');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.promociones_lista()) x where x ->> 'nombre' = 'Duplicada'), '10 · una capturada dos veces se borra limpio (ya no está en la lista)');
  perform tests.throws(format('select public.promocion_eliminar(%L)', gen_random_uuid()), 'PROMO_INEXISTENTE', '10 · inexistente');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'Promoción eliminada' and resource_id = 'Duplicada'), '10 · bitácora');

  -- ══ 11 · PROMO-6 (177): fotos y precios en los datos; marca en el chat; tarjeta para el doctor ══════════
  perform tests.act_as_service(); update public.products set image_url = 'https://img.test/botox.png', unit = 'Vial 100 UI' where id = botox; perform tests.act_as(v_admin);
  r := public.promocion_difusion_previa(pid);
  perform tests.ok(jsonb_array_length(r -> 'datos' -> 'productos') = 1 and r -> 'datos' -> 'productos' -> 0 ->> 'imagen_url' = 'https://img.test/botox.png' and (r -> 'datos' -> 'productos' -> 0 ->> 'precio_normal')::numeric = 4600
               and (r -> 'datos' -> 'productos' -> 0 -> 'escalones' -> 0 ->> 'precio')::numeric = 4100 and r ->> 'chat_texto' like '[promo:' || pid::text || ']%', '11 · la vista previa trae los productos con foto, precio normal y escalones, y el texto del chat con su marca');
  perform tests.ok(exists (select 1 from public.cc_messages m join public.cc_conversations c on c.id = m.conversation_id where c.profile_id = v_doc and m.client_message_id = 'promo:' || pid::text), '11 · (el envío anterior sigue; con la 177 los nuevos llevan la marca)');
  perform tests.act_as(v_doc);
  r := public.promo_tarjeta(pid);
  perform tests.ok(r ->> 'nombre' = 'Promo Allergan octubre' and jsonb_array_length(r -> 'productos') = 1 and r ->> 'texto' is null, '11 · el doctor obtiene la tarjeta de una promo vigente que le aplica');
  perform tests.act_as(v_nov);
  perform tests.ok(public.promo_tarjeta(pid) is null, '11 · sin verificar: nada');
  perform tests.act_as(v_admin); perform public.promocion_estado(pid, false); perform tests.act_as(v_doc);
  perform tests.ok(public.promo_tarjeta(pid) is null, '11 · pausada o terminada: la tarjeta desaparece (queda el texto)');
  perform tests.act_as(v_admin); perform public.promocion_estado(pid, true);

  -- ══ 12 · PROMO-7 (178): correo de prueba a la dirección que yo diga ═══════════════════════════════════
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.promocion_prueba_correo(%L, ''yo@correo.test'')', pid), 'NO_AUTORIZADO', '12 · Ventas no manda pruebas');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.promocion_prueba_correo(%L, ''no-es-correo'')', pid), 'CORREO_INVALIDO', '12 · correo inválido');
  r := public.promocion_prueba_correo(pid, ' Dueno@Correo.Test ');
  perform tests.ok((r ->> 'encolado')::boolean and r ->> 'para' = 'dueno@correo.test' and r ->> 'asunto' like 'Promo Allergan octubre · del %', '12 · se encola la prueba a mi correo (normalizado) con el asunto real');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.comm_outbox o where o.plantilla = 'promocion' and o.to_address = 'dueno@correo.test' and o.status = 'pendiente' and (o.payload ->> 'prueba')::boolean and jsonb_array_length(o.payload -> 'productos') = 1), '12 · en la cola con la misma plantilla y los mismos datos (fotos y precios) que el envío real');
  perform tests.eq((select count(*)::int from public.promocion_envios where promocion_id = pid and canal = 'correo'), 1, '12 · la prueba no cuenta como envío a doctores');
  perform tests.act_as(v_admin);
  perform public.promocion_prueba_correo(pid, 'a@b.test'); perform public.promocion_prueba_correo(pid, 'a@b.test'); perform public.promocion_prueba_correo(pid, 'a@b.test'); perform public.promocion_prueba_correo(pid, 'a@b.test');
  perform tests.throws(format('select public.promocion_prueba_correo(%L, ''a@b.test'')', pid), 'PRUEBAS_EXCEDIDAS', '12 · tope de 5 pruebas cada 10 minutos');

  -- ══ 13 · PROMO-8 (179): avisos push del envío por chat, una vez por doctor ═══════════════════════════════
  perform tests.throws_any(format('select public.promocion_avisos_pendientes(%L)', pid), array['NO_AUTORIZADO', 'permission denied'], '13 · solo el servidor lista pendientes');
  perform tests.act_as_service();
  r := public.promocion_avisos_pendientes(pid);
  perform tests.ok((r ->> 'vigente')::boolean and jsonb_array_length(r -> 'perfiles') = 1 and (r -> 'perfiles' ->> 0)::uuid = v_doc and r ->> 'nombre' = 'Promo Allergan octubre', '13 · el doctor que recibió el chat está pendiente de aviso');
  perform tests.eq(public.promocion_avisos_marcar(pid, array[v_doc]), 1, '13 · se marca avisado');
  perform tests.eq(jsonb_array_length(public.promocion_avisos_pendientes(pid) -> 'perfiles'), 0, '13 · ya no está pendiente');
  perform tests.act_as(v_admin);
  r := (select x from jsonb_array_elements(public.promociones_lista()) x where (x ->> 'id')::uuid = pid);
  perform tests.ok((r -> 'difusion' ->> 'avisados')::int = 1 and (r -> 'difusion' ->> 'sin_avisar')::int = 0, '13 · la lista muestra avisados / sin avisar');
  perform tests.act_as_owner();
end $t$;
rollback;
