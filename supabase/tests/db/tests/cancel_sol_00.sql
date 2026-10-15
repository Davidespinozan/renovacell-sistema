-- CANCELACIÓN (162) · solicitar (vendedor, almacén, empaque, facturación), aprobar o rechazar (Dirección), avisos al
-- cancelar por cualquier camino y bloqueo de envío mientras hay una solicitud pendiente.
begin;
create function pg_temp.empacado(p_doc uuid, p_prod uuid, p_seller uuid) returns uuid language plpgsql as $f$
declare o uuid; v_wh uuid;
begin
  perform tests.act_as_owner();
  o := tests.order(p_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', p_prod, 'qty', 2, 'unit_price', 525)), 'paid',
                   jsonb_build_object('seller_profile_id', p_seller, 'customer', jsonb_build_object('name', 'Dra. Cancela')));
  v_wh := tests.user('warehouse');
  perform tests.act_as(v_wh); perform public.surtir_pedido(gen_random_uuid(), o, tests.alloc(o));
  perform tests.act_as_owner();
  return o;
end $f$;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos'); v_pos2 uuid := tests.user('pos');
  v_bill uuid := tests.user('billing'); dA uuid := tests.user('doctor', 'cancsol@t.local'); p uuid := tests.product(525); lot uuid;
  o uuid; o2 uuid; o3 uuid; r jsonb; rq uuid; n int;
begin
  perform tests.act_as_owner(); lot := tests.stock(p, 'CANC-LOT', 40);
  o := pg_temp.empacado(dA, p, v_pos);
  perform tests.ok((select status = 'packed' and payment_status = 'paid' from public.orders where id = o), 'escenario · pagado y empacado, con vendedor');

  -- 1 · quién solicita
  perform tests.act_as(v_admin); perform tests.throws(format('select public.solicitar_cancelacion(%L, %L)', o, 'cliente ya no lo quiere'), 'NO_AUTORIZADO', '1 · Dirección no solicita: cancela directo');
  perform tests.act_as(dA);     perform tests.throws(format('select public.solicitar_cancelacion(%L, %L)', o, 'ya no lo quiero'), 'NO_AUTORIZADO', '1 · el doctor tampoco (pide por chat)');
  perform tests.act_as(v_pos2); perform tests.throws(format('select public.solicitar_cancelacion(%L, %L)', o, 'cliente ya no lo quiere'), 'PEDIDO_INEXISTENTE', '1 · otro vendedor no ve ese pedido');
  perform tests.act_as_anon();  perform tests.throws(format('select public.solicitar_cancelacion(%L, %L)', o, 'cliente ya no lo quiere'), 'permission denied', '1 · anónimo sin EXECUTE');
  perform tests.act_as(v_pos);  perform tests.throws(format('select public.solicitar_cancelacion(%L, %L)', o, 'no'), 'MOTIVO_REQUERIDO', '1 · motivo obligatorio');
  r := public.solicitar_cancelacion(o, 'El cliente ya no lo quiere');
  rq := (r ->> 'id')::uuid;
  perform tests.ok(r ->> 'status' = 'pendiente' and (public.solicitar_cancelacion(o, 'otra vez') ->> 'idempotente')::boolean, '1 · su vendedor la solicita; repetir no duplica');
  perform tests.ok((select count(*) from public.order_cancel_requests where order_id = o) = 1, '1 · el vendedor ve su solicitud');
  perform tests.throws($$insert into public.order_cancel_requests (order_id, requested_by, requester_role, reason) values (gen_random_uuid(), auth.uid(), 'pos', 'directo')$$, 'permission denied', '1 · sin escritura directa');
  perform tests.act_as(v_pos2); perform tests.ok((select count(*) from public.order_cancel_requests where order_id = o) = 0, '1 · otro vendedor no la ve');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.notifications where event_key = 'cancel_req:' || rq and 'admin' = any(roles) and screen = 'av_ventas'), '1 · aviso a Dirección');

  -- 2 · mientras está pendiente no sale
  perform tests.act_as_service();   -- la guía la crea la Edge shipping con service_role
  perform tests.throws(format($$insert into public.shipping_attempts (order_id, provider, idempotency_key, service_code, request_fingerprint, status) values (%L, 'dhl', 'k', 'N', 'f', 'pending')$$, o), 'CANCELACION_SOLICITADA', '2 · no se crea guía');
  perform tests.act_as(v_wh);
  perform tests.throws(format($$update public.orders set status = 'shipped' where id = %L$$, o), 'CANCELACION_SOLICITADA', '2 · ni se marca enviado (chofer)');

  -- 3 · rechazar
  perform tests.act_as(v_pos);  perform tests.throws(format('select public.resolver_solicitud_cancelacion(%L, false, %L)', rq, 'no'), 'NO_AUTORIZADO', '3 · solo Dirección resuelve');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.resolver_solicitud_cancelacion(%L, false, null)', rq), 'NOTA_REQUERIDA', '3 · rechazar pide nota');
  r := public.resolver_solicitud_cancelacion(rq, false, 'Ya se habló con el cliente: sí lo quiere');
  perform tests.act_as_owner();
  perform tests.ok(r ->> 'status' = 'rechazada' and (select status = 'packed' from public.orders where id = o)
    and exists (select 1 from public.notifications where event_key = 'cancel_req_no:' || rq and v_pos = any(user_ids)), '3 · rechazada: el pedido sigue y quien la pidió se entera');

  -- 4 · aprobar (cancela con las reglas de siempre) + avisos
  perform tests.act_as(v_wh); r := public.solicitar_cancelacion(o, 'Caja dañada, el cliente pidió cancelar'); rq := (r ->> 'id')::uuid;
  perform tests.act_as(v_admin); r := public.resolver_solicitud_cancelacion(rq, true, null);
  perform tests.act_as_owner();
  perform tests.ok(r ->> 'status' = 'aprobada' and (select status = 'cancelled' from public.orders where id = o)
    and (select refund_review = 'pendiente_revision' and return_id is not null and reason like 'Solicitado (warehouse): Caja dañada%' from public.order_cancellations where order_id = o), '4 · aprobada: cancelado, reingreso y reembolso por revisar');
  perform tests.ok(exists (select 1 from public.notifications where event_key = 'cancel_doc:' || o and dA = any(user_ids) and body like '%reembolso%'), '4 · aviso al doctor (con reembolso)');
  perform tests.ok(exists (select 1 from public.notifications where event_key = 'cancel_seller:' || o and v_pos = any(user_ids)), '4 · aviso a su vendedor');
  perform tests.ok(exists (select 1 from public.notifications where event_key = 'cancel_ret:' || o and 'warehouse' = any(roles) and body like '%reingresa 2 piezas%'), '4 · aviso al almacén con las piezas');
  perform tests.ok(exists (select 1 from public.notifications where event_key = 'cancel_money:' || o and 'billing' = any(roles) and screen = 'av_revision'), '4 · aviso de reembolso a Dirección y Facturación');
  perform tests.ok(exists (select 1 from public.notifications where event_key = 'cancel_req_ok:' || rq and v_wh = any(user_ids)), '4 · quien la pidió se entera');
  perform tests.act_as(v_bill); perform tests.throws(format('select public.solicitar_cancelacion(%L, %L)', o, 'otra solicitud'), 'ESTADO_INVALIDO', '4 · ya cancelado: no se solicita');

  -- 5 · Dirección cancela directo con una solicitud pendiente: la solicitud queda aprobada sola
  perform tests.act_as_owner(); o2 := pg_temp.empacado(dA, p, v_pos);
  perform tests.act_as(v_bill); rq := (public.solicitar_cancelacion(o2, 'Pago duplicado') ->> 'id')::uuid;
  perform tests.act_as(v_admin); perform public.cancelar_pedido(gen_random_uuid(), o2, 'Lo cancelo directo');
  perform tests.act_as_owner();
  perform tests.ok((select status = 'aprobada' and resolved_by = v_admin from public.order_cancel_requests where id = rq), '5 · cancelación directa: la solicitud pendiente se cierra');

  -- 6 · el doctor cancela antes de pagar: no se avisa a sí mismo
  perform tests.act_as_owner(); o3 := tests.order(dA, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  perform tests.act_as(dA); perform public.cancelar_pedido(gen_random_uuid(), o3, null);
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from public.notifications where event_key = 'cancel_doc:' || o3) and not exists (select 1 from public.notifications where event_key = 'cancel_money:' || o3), '6 · el doctor que cancela antes de pagar no recibe su propio aviso; sin dinero, sin aviso de reembolso');
end $t$;
rollback;
