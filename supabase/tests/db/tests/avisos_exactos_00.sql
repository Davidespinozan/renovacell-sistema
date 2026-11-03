-- AVISOS-EXACTOS (20270317) · el aviso de pedido nuevo lleva el total CON envío (se emite al confirmar la transacción) y
-- Dirección recibe aviso de toda cancelación, también la que hace el doctor.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); p uuid; cu uuid; o uuid; r jsonb;
  dir jsonb := '{"line1":"Av. del Mar 10","colonia":"Centro","cp":"82000","city":"Mazatlán","state":"Sinaloa","phone":"6691234567"}';
begin
  perform tests.act_as_service();
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'AV-L', 20);
  cu := tests.cliente(d1);
  perform tests.act_as(v_pos);
  r := public.crear_pedido_con_entrega(gen_random_uuid(), null, d1, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2)), jsonb_build_object('address', dir), false, cu, null, '{"opcion":"foraneo_dhl"}');
  o := (r ->> 'order_id')::uuid;
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from public.notifications where event_key = 'pedido_nuevo:' || o), '1 · el aviso espera a que termine la transacción');
  set constraints all immediate;
  perform tests.ok((select body like '%$2,600.00%' from public.notifications where event_key = 'pedido_nuevo:' || o), '1 · el aviso lleva el total con envío (2,000 + 600)');
  set constraints all deferred;

  perform tests.act_as(d1);
  perform public.cancelar_pedido(gen_random_uuid(), o, 'Ya no lo necesito');
  perform tests.act_as_owner();
  perform tests.ok((select body = 'Pedido ' || (select external_ref from public.orders where id = o) || ' cancelado por el cliente · Ya no lo necesito.' and roles = array['admin'] from public.notifications where event_key = 'cancel_admin:' || o), '2 · Dirección se entera cuando el doctor cancela');
end $t$;
rollback;
