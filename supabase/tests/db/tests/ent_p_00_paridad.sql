-- ENT-P · PARIDAD DE REGLAS DE VENTA. El doctor no puede pedir chofer local abajo del mínimo; el personal sí, pero solo como
-- cortesía CON MOTIVO (queda marcada en el pedido). Todo lo demás de la entrega (recoger, DHL, ajuste de flete, horario,
-- regla del doctor) no cambia.
begin;
do $t$
declare
  v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor');
  cu uuid; p uuid; p2 uuid; r jsonb; o jsonb; ord uuid; f text; i text; n int;
  dir_loc jsonb := '{"line1":"Blvd. Culiacán 100","colonia":"Centro","cp":"80020","city":"Culiacán","state":"Sinaloa","phone":"6671234567"}'::jsonb;
  dir_for jsonb := '{"line1":"Av. del Mar 10","colonia":"Centro","cp":"82000","city":"Mazatlán","state":"Sinaloa","phone":"6691234567"}'::jsonb;
  chica jsonb; grande jsonb;
begin
  perform tests.act_as_service();
  p := tests.producto_cat('Rellenos', 350); perform tests.stock(p, 'ENTP-350', 100);
  p2 := tests.producto_cat('Rellenos', 1000); perform tests.stock(p2, 'ENTP-1000', 100);
  insert into public.customers (full_name, phone, source) values ('Cliente Paridad', '6670002222', 'odoo') returning id into cu;
  perform tests.cliente(v_doc);
  chica := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1));     -- $350 (< $500)
  grande := jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1));   -- $1,000 (≥ $500)

  -- ══ 0 · lo que NO cambia ═════════════════════════════════════════════════════════════════════════
  perform tests.act_as_owner();
  perform tests.ok(md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) = 'bee5aa3614e2b9e0327ebec6a1b38e2e'
               and md5(pg_get_functiondef('public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)'::regprocedure)) = '5769c551e6ca60003ba0fcf9390d80d1', '0.1 · crear_pedido y crear_pedido_con_receptor no cambiaron');
  perform tests.ok(not has_function_privilege('authenticated', 'public._entrega_normalizar(text,numeric,text,jsonb,timestamptz)', 'execute'), '0.2 · _entrega_normalizar sigue siendo interna');
  perform tests.act_as(v_doc);
  select x into o from jsonb_array_elements(public.entrega_opciones('doctor', 350, '80020') -> 'opciones') x where x ->> 'id' = 'local_chofer';
  perform tests.ok(not (o ->> 'permitido')::boolean and o ->> 'motivo' = 'MINIMO_LOCAL', '0.3 · el doctor abajo de $500 sigue sin chofer (MINIMO_LOCAL)');
  perform tests.act_as(v_pos);
  select x into o from jsonb_array_elements(public.entrega_opciones('staff', 350, '80020') -> 'opciones') x where x ->> 'id' = 'local_chofer';
  perform tests.ok((o ->> 'permitido')::boolean and (o ->> 'flete')::numeric = 0, '0.4 · el personal ve el chofer como opción (la forma de entrega_opciones no cambia)');

  -- ══ 1 · chofer abajo del mínimo: solo con motivo ═══════════════════════════════════════════════════
  select dd ->> 'fecha', x ->> 'inicio' into f, i from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where (x ->> 'disponible')::boolean limit 1;
  perform tests.ok(f is not null, '1.0 · hay un horario disponible para probar');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, %L)', gen_random_uuid(), chica, jsonb_build_object('address', dir_loc), cu,
    jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f, 'inicio', i))), 'ENTREGA_MINIMO_SIN_MOTIVO', '1.1 · $350 con chofer sin motivo: no');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, %L)', gen_random_uuid(), chica, jsonb_build_object('address', dir_loc), cu,
    jsonb_build_object('opcion', 'local_chofer', 'motivo', ' ok ', 'horario', jsonb_build_object('fecha', f, 'inicio', i))), 'ENTREGA_MINIMO_SIN_MOTIVO', '1.2 · un motivo de 2 letras no cuenta');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.orders where customer_id = cu), 0, '1.3 · ningún pedido se creó a medias');
  perform tests.eq((select count(*)::int from public.entrega_horarios where fecha = f::date and to_char(inicio, 'HH24:MI') = i), 0, '1.4 · y el horario no quedó apartado');
  perform tests.act_as(v_pos);
  ord := gen_random_uuid();
  r := public.crear_pedido_con_entrega(ord, null, null, chica, jsonb_build_object('address', dir_loc), false, cu, null,
    jsonb_build_object('opcion', 'local_chofer', 'motivo', 'Cortesía: cliente frecuente', 'horario', jsonb_build_object('fecha', f, 'inicio', i)));
  perform tests.ok((r ->> 'envio')::numeric = 0 and (r -> 'entrega' ->> 'bajo_minimo')::boolean and r -> 'entrega' ->> 'ajuste_motivo' = 'Cortesía: cliente frecuente', '1.5 · con motivo sí: gratis, marcado bajo_minimo y con su motivo');
  perform tests.act_as_owner();
  perform tests.ok((select (shipping_meta -> 'entrega' ->> 'bajo_minimo')::boolean and shipping_meta -> 'entrega' ->> 'ajuste_motivo' = 'Cortesía: cliente frecuente' and shipping_cost = 0 from public.orders where id = ord), '1.6 · el pedido guarda la cortesía (shipping_meta.entrega)');
  perform tests.act_as(v_pos);
  -- cortesía con flete cobrado distinto: un solo motivo cubre las dos cosas
  select dd ->> 'fecha', x ->> 'inicio' into f, i from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where (x ->> 'disponible')::boolean limit 1;
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, null, chica, jsonb_build_object('address', dir_loc), false, cu, null,
    jsonb_build_object('opcion', 'local_chofer', 'flete', 80, 'motivo', 'Se cobra la gasolina', 'horario', jsonb_build_object('fecha', f, 'inicio', i)));
  perform tests.ok((r ->> 'envio')::numeric = 80 and (r -> 'entrega' ->> 'bajo_minimo')::boolean and r -> 'entrega' ->> 'ajuste_motivo' = 'Se cobra la gasolina', '1.7 · abajo del mínimo con flete ajustado: cobra $80 con el mismo motivo');

  -- ══ 2 · lo demás sigue igual ════════════════════════════════════════════════════════════════════
  select dd ->> 'fecha', x ->> 'inicio' into f, i from jsonb_array_elements(public.entrega_horarios_disponibles() -> 'dias') dd, jsonb_array_elements(dd -> 'slots') x where (x ->> 'disponible')::boolean limit 1;
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, null, grande, jsonb_build_object('address', dir_loc), false, cu, null,
    jsonb_build_object('opcion', 'local_chofer', 'horario', jsonb_build_object('fecha', f, 'inicio', i)));
  perform tests.ok((r ->> 'envio')::numeric = 0 and not (r -> 'entrega' ? 'bajo_minimo') and not (r -> 'entrega' ? 'ajuste_motivo'), '2.1 · $1,000 con chofer: gratis y sin motivo (desde el mínimo)');
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, null, chica, '{}'::jsonb, false, cu, null, '{"opcion":"recoge"}'::jsonb);
  perform tests.ok((r ->> 'envio')::numeric = 0 and not (r -> 'entrega' ? 'bajo_minimo'), '2.2 · $350 a recoger: sin motivo');
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, null, chica, jsonb_build_object('address', dir_for), false, cu, null, '{"opcion":"foraneo_dhl"}'::jsonb);
  perform tests.ok((r ->> 'envio')::numeric = 600 and not (r -> 'entrega' ? 'bajo_minimo'), '2.3 · $350 foráneo por DHL: $600 como siempre, sin motivo');
  perform tests.throws(format('select public.crear_pedido_con_entrega(%L, null, null, %L, %L, false, %L, null, ''{"opcion":"foraneo_dhl","flete":0}'')', gen_random_uuid(), chica, jsonb_build_object('address', dir_for), cu),
    'ENTREGA_AJUSTE_SIN_MOTIVO', '2.4 · regalar el DHL sigue exigiendo motivo (regla de la 171)');
  perform tests.act_as_owner();
  select count(*)::int into n from public.orders where customer_id = cu;
  perform tests.eq(n, 5, '2.5 · 5 pedidos creados (2 cortesías, 1 chofer normal, 1 recoge, 1 DHL)');
end $t$;
rollback;
