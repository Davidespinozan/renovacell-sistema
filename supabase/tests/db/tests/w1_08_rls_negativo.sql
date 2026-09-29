-- W1 · RC-07 Cierre de escrituras directas (todos los roles) + guarda de transiciones de pedido
begin;
do $t$
declare
  v_roles text[] := array['admin','doctor','pos','warehouse','packing','billing','driver','comm'];
  v_role text; v_u uuid; v_admin uuid := tests.user('admin'); v_doc uuid := tests.user('doctor');
  v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing');
  v_p uuid := tests.product(); v_l uuid; v_o uuid; v_oi uuid; v_rep uuid; v_o2 uuid;
begin
  v_l := tests.stock(v_p, 'R-1', 30, current_date + 200);
  v_o := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)), 'paid');
  select id into v_oi from public.order_items where order_id = v_o;
  insert into public.replenishments (product_id, product_name, qty, unit_cost, kind) values (v_p, 'P', 10, 5, 'compra') returning id into v_rep;

  -- 1) Ningún rol (ni admin) escribe directo en lotes / kardex / renglones / nuevas tablas
  foreach v_role in array v_roles loop
    v_u := tests.user(v_role);
    perform tests.act_as(v_u);
    perform tests.throws(format('insert into public.lots(product_id, lot_code, expiry_date, quantity) values (%L, ''HACK'', current_date + 9, 999)', v_p),
      'permission denied', v_role || ': no inserta lotes');
    perform tests.throws(format('update public.lots set quantity = 999 where id = %L', v_l), 'permission denied', v_role || ': no edita lots.quantity');
    perform tests.throws(format('delete from public.lots where id = %L', v_l), 'permission denied', v_role || ': no borra lotes');
    perform tests.throws(format('insert into public.inventory_movements(lot_id, change, reason, reference) values (%L, 5, ''ajuste'', ''x'')', v_l),
      'permission denied', v_role || ': no inserta movimientos');
    perform tests.throws(format('update public.order_items set qty = 99 where id = %L', v_oi), 'permission denied', v_role || ': no edita renglones');
    perform tests.throws(format('insert into public.order_items(order_id, product_id, qty, unit_price) values (%L, %L, 1, 1)', v_o, v_p),
      'permission denied', v_role || ': no agrega renglones');
    perform tests.throws(format('delete from public.order_items where id = %L', v_oi), 'permission denied', v_role || ': no borra renglones');
    perform tests.throws(format('select public.apply_lot_movement(%L, 5, ''ajuste'', ''x'')', v_l), 'permission denied', v_role || ': apply_lot_movement revocado');
    perform tests.throws(format('update public.replenishments set status = ''recibida'', received_qty = 10 where id = %L', v_rep),
      'permission denied', v_role || ': no cambia estado/acumulado de compra');
    perform tests.throws(format('select public._w1_trusted(true)'), 'permission denied', v_role || ': helper interno no ejecutable');
    perform tests.throws(format('select public._w1_op_begin(gen_random_uuid(), ''ajuste'', ''{}'')'), 'permission denied', v_role || ': registro interno no ejecutable');
    perform tests.throws('truncate public.inventory_movements', 'permission denied', v_role || ': TRUNCATE kardex sin privilegio');
    perform tests.act_as_owner();
  end loop;

  -- 2) anon: ni comandos ni tablas
  perform tests.act_as_anon();
  perform tests.throws(format('select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => ''A'', p_caducidad => current_date + 9, p_cantidad => 1)', v_p),
    'permission denied', 'anon: no ejecuta recibir_lote');
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L)', v_o), 'permission denied', 'anon: no ejecuta cancelar_pedido');
  perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, -1, ''merma'', ''x'')', v_l), 'permission denied', 'anon: no ejecuta ajustar_lote');
  perform tests.throws(format('update public.lots set quantity = 0 where id = %L', v_l), 'permission denied', 'anon: no edita lotes');
  perform tests.act_as_owner();

  -- 3) Lecturas que deben seguir funcionando (sin romper pantallas)
  perform tests.act_as(v_wh);
  perform tests.ok((select count(*) from public.lots where id = v_l) = 1, 'almacén sigue leyendo lotes');
  perform tests.ok((select count(*) from public.inventory_movements where lot_id = v_l) >= 1, 'almacén sigue leyendo kardex');
  perform tests.act_as(v_doc);
  perform tests.eq((select count(*)::int from public.inventory_operations), 0, 'doctor no ve el registro de operaciones');
  perform tests.act_as(v_admin);
  update public.replenishments set paid = true where id = v_rep;
  perform tests.eq((select paid from public.replenishments where id = v_rep), true, 'Dirección sí marca compra pagada');

  -- 4) Guarda de transiciones de pedido (sin atajos, ni para admin)
  perform tests.throws(format('update public.orders set status = ''packed'' where id = %L', v_o), 'TRANSICION_SOLO_POR_COMANDO', 'admin: → packed solo por comando');
  perform tests.throws(format('update public.orders set status = ''cancelled'' where id = %L', v_o), 'TRANSICION_SOLO_POR_COMANDO', 'admin: → cancelled solo por comando');
  perform tests.throws(format('update public.orders set status = ''shipped'' where id = %L', v_o), 'TRANSICION_INVALIDA', 'paid → shipped sin empacar rechazado');
  perform tests.act_as_owner();
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_doc);
  perform tests.throws(format('update public.orders set status = ''cancelled'' where id = %L', v_o2), 'TRANSICION_SOLO_POR_COMANDO', 'doctor: cancelación directa bloqueada (usa el comando)');
  perform tests.act_as(v_pk);
  update public.orders set status = 'picking' where id = v_o;
  perform tests.eq((select status from public.orders where id = v_o), 'picking', 'paid → picking directo sigue permitido (sin inventario)');
  perform tests.act_as_owner();
  v_o2 := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_wh);
  perform tests.throws(format('update public.orders set status = ''paid'' where id = %L', v_o2), 'TRANSICION_REGRESIVA', 'packed → paid (re-surtir) rechazado');
  perform tests.throws(format('update public.orders set status = ''picking'' where id = %L', v_o2), 'TRANSICION_REGRESIVA', 'packed → picking rechazado');
  perform tests.act_as(v_pk);
  update public.orders set status = 'shipped' where id = v_o2;
  update public.orders set status = 'delivered' where id = v_o2;
  perform tests.eq((select status from public.orders where id = v_o2), 'delivered', 'packed → shipped → delivered sigue funcionando (W3/W4 intacto)');
  perform tests.throws(format('update public.orders set status = ''shipped'' where id = %L', v_o2), 'TRANSICION', 'delivered → shipped rechazado');
  perform tests.act_as_owner();
  perform tests.throws(format('insert into public.orders (id, status) values (gen_random_uuid(), ''enviado'')'), 'ck_orders_status', 'estado inexistente rechazado');
  -- service_role (webhooks) conserva su bypass
  perform tests.act_as_service();
  update public.orders set status = 'paid' where id = (select id from public.orders where status = 'pending_payment' limit 1);
  perform tests.ok(true, 'service_role conserva su camino (stripe-webhook / edge)');
  perform tests.act_as_owner();
end
$t$;
set constraints all immediate;
rollback;
