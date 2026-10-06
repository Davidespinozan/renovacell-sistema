-- CC-4 · Herramientas materiales: la autoridad sale del PERFIL resuelto por el servidor.
-- Precio = precio_de con la lista del doctor y cantidad; disponibilidad agregada sin lotes;
-- pedidos solo del dueño; visitante/no verificado/suspendido → sin autoridad; nada de costo,
-- margen ni fiscal en ninguna salida.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor'); v_sus uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor');
  v_wh uuid := tests.user('warehouse'); pA uuid; pNoVend uuid; pOculto uuid; pSin uuid; lst uuid; r jsonb; o1 uuid; txt text;
begin
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;
  update public.profiles set active = false where id = v_sus;
  pA := tests.producto_fam('Rellenos', 'Hyalux', 1000); pNoVend := tests.producto_fam('Rellenos', 'Hyalux', 500); pOculto := tests.producto_cat('Rellenos', 800); pSin := tests.producto_cat('Rellenos');
  update public.products set name = 'Hyalux Deep 1 ml' where id = pA;
  update public.products set name = 'Hyalux Familia', sellable = false where id = pNoVend;
  update public.products set name = 'Oculto', show_landing = false, show_portal = false where id = pOculto;
  insert into public.product_costs (product_id, unit_cost) values (pA, 333.33) on conflict (product_id) do nothing;
  insert into public.product_volume_prices (product_id, min_quantity, price, active) values (pA, 5, 900, true), (pA, 10, 800, true);
  perform tests.stock(pA, 'L-OK', 7);
  perform tests.stock(pA, 'L-CAD', 5, current_date - 1);   -- caducado: no cuenta

  -- ══ contexto del actor ══════════════════════════════════════════════════════
  r := public.cc_ia_contexto_actor(null);
  perform tests.eq(r ->> 'actor', 'visitor', 'A · sin perfil = visitante');
  perform tests.eq(r ->> 'audiencia', 'public', 'A · visitante public');
  perform tests.eq((r ->> 'puede_precio')::boolean, false, 'A · visitante sin precio');
  r := public.cc_ia_contexto_actor(v_doc);
  perform tests.ok(r ->> 'actor' = 'doctor' and r ->> 'audiencia' = 'verified' and (r ->> 'puede_precio')::boolean and (r ->> 'puede_pedidos')::boolean, 'A · doctor verificado: verified + precio + pedidos');
  r := public.cc_ia_contexto_actor(v_nov);
  perform tests.ok(r ->> 'audiencia' = 'public' and not (r ->> 'puede_precio')::boolean and (r ->> 'puede_pedidos')::boolean, 'A · doctor sin verificar: public, sin precio, sí sus pedidos');
  r := public.cc_ia_contexto_actor(v_sus);
  perform tests.ok(r ->> 'actor' = 'suspendido' and not (r ->> 'puede_precio')::boolean and not (r ->> 'puede_pedidos')::boolean, 'A · suspendido: sin autoridad alguna');
  r := public.cc_ia_contexto_actor(v_admin);
  perform tests.ok(r ->> 'actor' = 'admin' and r ->> 'audiencia' = 'staff' and (r ->> 'puede_precio')::boolean and not (r ->> 'puede_pedidos')::boolean, 'A · Dirección: staff, precio, sin "mis pedidos"');
  r := public.cc_ia_contexto_actor(v_wh);
  perform tests.ok(r ->> 'actor' = 'staff' and r ->> 'audiencia' = 'verified', 'A · personal: verified');
  r := public.cc_ia_contexto_actor(gen_random_uuid());
  perform tests.eq(r ->> 'actor', 'suspendido', 'A · perfil inexistente = sin autoridad');

  -- ══ precio ══════════════════════════════════════════════════════════════════
  r := public.cc_ia_precio(null, pA, 1);
  perform tests.eq(r ->> 'motivo', 'PRICE_REQUIRES_VERIFICATION', 'B · visitante: precio requiere verificación');
  r := public.cc_ia_precio(v_nov, pA, 1);
  perform tests.eq(r ->> 'motivo', 'PRICE_REQUIRES_VERIFICATION', 'B · no verificado: igual');
  r := public.cc_ia_precio(v_sus, pA, 1);
  perform tests.eq((r ->> 'autorizado')::boolean, false, 'B · suspendido: no');
  r := public.cc_ia_precio(v_doc, pA, 1);
  perform tests.eq((r ->> 'autorizado')::boolean, true, 'B · verificado: autorizado');
  perform tests.eq((r ->> 'precio_unitario')::numeric, 1000::numeric, 'B · precio base por 1 = precio_de(product, lista, 1)');
  perform tests.eq(r ->> 'moneda', 'MXN', 'B · moneda');
  perform tests.eq(jsonb_array_length(r -> 'escalas'), 2, 'B · escalas por volumen visibles al verificado');
  r := public.cc_ia_precio(v_doc, pA, 10);
  perform tests.eq((r ->> 'precio_unitario')::numeric, 800::numeric, 'B · cantidad 10 aplica la escala (precio_de con qty)');
  perform tests.eq((r ->> 'total')::numeric, 8000::numeric, 'B · total = unitario × cantidad');
  perform tests.eq((r ->> 'por_volumen')::boolean, true, 'B · marcado por volumen');
  r := public.cc_ia_precio(v_doc, pA, 5000);
  perform tests.eq((r ->> 'cantidad')::int, 999, 'B · cantidad acotada a 999');
  r := public.cc_ia_precio(v_doc, pNoVend, 1);
  perform tests.eq(r ->> 'motivo', 'PRODUCTO_NO_VENDIBLE', 'B · padre no vendible: sin precio');
  r := public.cc_ia_precio(v_doc, pOculto, 1);
  perform tests.eq(r ->> 'motivo', 'PRODUCTO_NO_DISPONIBLE', 'B · oculto: no existe para la IA');
  r := public.cc_ia_precio(v_doc, gen_random_uuid(), 1);
  perform tests.eq(r ->> 'motivo', 'PRODUCTO_NO_DISPONIBLE', 'B · inexistente');
  -- lista propia del doctor
  insert into public.price_lists (id, name) values (gen_random_uuid(), 'Mayoreo IA') returning id into lst;
  insert into public.product_prices (product_id, list_id, price) values (pA, lst, 950);
  update public.profiles set price_list_id = lst where id = v_doc2;
  r := public.cc_ia_precio(v_doc2, pA, 1);
  perform tests.eq((r ->> 'precio_unitario')::numeric, 950::numeric, 'B · el precio sale de LA LISTA DEL PERFIL (no de lo que diga el modelo)');
  perform tests.eq(r ->> 'lista', 'Mayoreo IA', 'B · nombre de la lista');
  txt := public.cc_ia_precio(v_doc, pA, 10)::text;
  perform tests.ok(txt not like '%333.33%' and txt not ilike '%cost%' and txt not ilike '%margen%' and txt not ilike '%sat_%', 'B · sin costo, margen ni fiscal');

  -- ══ disponibilidad ══════════════════════════════════════════════════════════
  r := public.cc_ia_disponibilidad(null, pA);
  perform tests.eq(r ->> 'motivo', 'AVAILABILITY_REQUIRES_VERIFICATION', 'C · visitante: requiere verificación');
  r := public.cc_ia_disponibilidad(v_nov, pA);
  perform tests.eq((r ->> 'autorizado')::boolean, false, 'C · no verificado: no');
  r := public.cc_ia_disponibilidad(v_doc, pA);
  perform tests.eq(r ->> 'estado', 'disponible', 'C · verificado: disponible (lote vigente con 7)');
  perform tests.ok(r::text not ilike '%lot%' and r::text not like '%L-OK%' and r::text not like '%"7"%' and r::text not like '%: 7%', 'C · sin lotes ni cantidades');
  r := public.cc_ia_disponibilidad(v_doc, pNoVend);
  perform tests.eq(r ->> 'estado', 'no_vendible', 'C · no vendible');
  r := public.cc_ia_disponibilidad(v_doc, pSin);
  perform tests.eq(r ->> 'estado', 'no_disponible', 'C · sin lotes = no disponible (producción hoy tiene 0 lotes)');
  r := public.cc_ia_disponibilidad(v_doc, pOculto);
  perform tests.eq(r ->> 'motivo', 'PRODUCTO_NO_DISPONIBLE', 'C · oculto');

  -- ══ pedidos ═════════════════════════════════════════════════════════════════
  o1 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', pA, 'qty', 2, 'unit_price', 1000)), 'paid', null, 'F-IA-1');
  perform tests.order(v_doc2, 'draft', jsonb_build_array(jsonb_build_object('product_id', pA, 'qty', 1)), 'pending', null, 'F-OTRO');
  r := public.cc_ia_estado_pedido(null, null);
  perform tests.eq(r ->> 'motivo', 'ORDERS_REQUIRE_LOGIN', 'D · visitante no consulta pedidos');
  r := public.cc_ia_estado_pedido(v_doc, null);
  perform tests.eq(jsonb_array_length(r -> 'pedidos'), 1, 'D · el doctor ve SOLO los suyos (no el F-OTRO)');
  perform tests.eq(r -> 'pedidos' -> 0 ->> 'folio', 'F-IA-1', 'D · folio');
  perform tests.eq(r -> 'pedidos' -> 0 ->> 'estado', 'paid', 'D · estado');
  perform tests.eq((r -> 'pedidos' -> 0 ->> 'articulos')::int, 1, 'D · renglones');
  r := public.cc_ia_estado_pedido(v_doc, 'f-otro');
  perform tests.eq(jsonb_array_length(r -> 'pedidos'), 0, 'D · pedir el folio de OTRO cliente devuelve vacío (no existe para él)');
  r := public.cc_ia_estado_pedido(v_doc, ' F-IA-1 ');
  perform tests.eq(jsonb_array_length(r -> 'pedidos'), 1, 'D · por folio (normalizado)');
  r := public.cc_ia_estado_pedido(v_admin, null);
  perform tests.eq(r ->> 'motivo', 'ORDERS_REQUIRE_LOGIN', 'D · Dirección no usa "mis pedidos" (no es dueño de pedidos)');
  r := public.cc_ia_estado_pedido(v_sus, null);
  perform tests.eq((r ->> 'autorizado')::boolean, false, 'D · suspendido: no');
  txt := public.cc_ia_estado_pedido(v_doc, null)::text;
  perform tests.ok(txt not ilike '%reconcil%' and txt not ilike '%cobrado%' and txt not ilike '%stripe%' and txt not ilike '%cost%', 'D · sin internals financieros');
end $t$;
rollback;
