-- AVISOS DESCARTADOS (164) · el aviso "va en camino" de una guía anulada no vuelve a la cola por ningún camino; los demás
-- fallidos siguen reintentándose como siempre.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); d uuid := tests.user('doctor', 'commdesc@t.local'); p uuid := tests.product(100); v_o uuid; v_a uuid; v_b uuid;
begin
  perform tests.act_as_owner();
  v_o := tests.order(d, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  perform public._comm_encolar('pedido_enviado:' || v_o, 'pedido_enviado', v_o, '{"rastreo":"1111111111","paqueteria":"DHL"}'::jsonb);
  perform public._comm_encolar('pago_recibido:' || v_o, 'pago_recibido', v_o, '{"monto":100}'::jsonb);
  select id into v_a from public.comm_outbox where order_id = v_o and plantilla = 'pedido_enviado';
  select id into v_b from public.comm_outbox where order_id = v_o and plantilla = 'pago_recibido';
  perform set_config('app.trusted', 'on', true);
  update public.comm_outbox set status = 'fallido', last_error = 'GUIA_ANULADA: la guía 1111111111 de este aviso se anuló, no reenviar' where id = v_a;
  update public.comm_outbox set status = 'fallido', last_error = 'rechazado 422' where id = v_b;
  perform set_config('app.trusted', 'off', true);

  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.comm_reintentar(%L)', v_a), 'COMM_DESCARTADO', '1 · Reintentar un aviso de guía anulada: no');
  perform tests.ok((public.comm_reintentar(v_b) ->> 'status') = 'pendiente', '2 · otro fallido sí se reintenta');
  perform tests.act_as_owner();
  perform tests.throws(format($$update public.comm_outbox set status = 'pendiente' where id = %L$$, v_a), 'COMM_DESCARTADO', '3 · ni por escritura directa');
  perform tests.ok((select status = 'fallido' from public.comm_outbox where id = v_a), '3 · sigue descartado');
end $t$;
rollback;
