-- W4-05/06 · COMUNICACIÓN TRANSACCIONAL — el buzón de salida.
--
-- Lo que se protege: que cada hecho del negocio encole UN mensaje y solo uno, que
-- "enviado" no exista sin confirmación del proveedor, que lo incierto no se reintente
-- a ciegas fuera de la ventana segura, y que comunicar jamás tumbe una operación.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_pos uuid := tests.user('pos');
  v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor');
  v_p uuid := tests.product(500);
  v_o uuid; v_o2 uuid; v_anon uuid; v_id uuid; v_claim uuid; v_key text; v_n int; r record; j jsonb;
begin
  perform tests.set_email(v_doc, 'Dra.Uno@Clinica.MX ');
  perform tests.set_email(v_doc2, null);

  -- ── 1 · EL HECHO ENCOLA, NO EL NAVEGADOR ──────────────────────────────────
  v_o := tests.order(v_doc, 'pending_payment', format('[{"product_id":"%s","qty":2,"unit_price":500}]', v_p)::jsonb);
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.comm_outbox where order_id = v_o), 1,
    'e1: crear un pedido encola exactamente UN mensaje');
  select * into r from public.comm_outbox where order_id = v_o;
  perform tests.eq(r.plantilla, 'pedido_recibido', 'e2: y es el de pedido recibido');
  perform tests.eq(r.event_key, 'pedido_recibido:' || v_o, 'e3: su llave ES el hecho canónico');
  perform tests.eq(r.status, 'pendiente', 'e4: nace pendiente, no "enviado"');
  perform tests.eq(r.to_address, 'dra.uno@clinica.mx', 'e5: el correo se guarda normalizado, como foto del momento');
  perform tests.ok(r.payload ? 'folio' and (r.payload->>'total')::numeric = 1000, 'e6: lleva folio y total para la plantilla');

  -- ── 2 · IDEMPOTENCIA: el mismo hecho no se encola dos veces ───────────────
  perform public._comm_encolar('pedido_recibido:' || v_o, 'pedido_recibido', v_o, '{}'::jsonb);
  perform public._comm_encolar('pedido_recibido:' || v_o, 'pedido_recibido', v_o, '{"total":1}'::jsonb);
  perform tests.eq((select count(*)::int from public.comm_outbox where order_id = v_o), 1,
    'i1: reencolar el mismo hecho NO duplica el mensaje');
  perform tests.ok((select (payload->>'total')::numeric = 1000 from public.comm_outbox where order_id = v_o),
    'i2: y el contenido original no se pisa');

  -- ── 3 · SIN CORREO: estado durable, no mensaje perdido ────────────────────
  v_o2 := tests.order(v_doc2, 'pending_payment', format('[{"product_id":"%s","qty":1,"unit_price":500}]', v_p)::jsonb);
  perform tests.act_as_owner();
  perform tests.eq((select status from public.comm_outbox where order_id = v_o2), 'sin_destinatario',
    's1: cliente identificado sin correo → queda asentado como sin destinatario');
  perform tests.ok((select to_address is null from public.comm_outbox where order_id = v_o2), 's2: sin dirección inventada');

  -- Venta anónima de mostrador: no hay a quién escribirle; no es un pendiente.
  v_anon := tests.order(null, 'pending_payment', format('[{"product_id":"%s","qty":1,"unit_price":500}]', v_p)::jsonb);
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.comm_outbox where order_id = v_anon), 0,
    's3: una venta anónima no genera mensajes ni ruido en la cola');

  -- ── 4 · LOS DEMÁS HECHOS ──────────────────────────────────────────────────
  perform tests.cobrar(v_o);
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.comm_outbox where order_id = v_o and plantilla = 'pago_recibido'), 1,
    'h1: un cobro encola el aviso de pago recibido');
  perform tests.ok((select event_key like 'pago_recibido:%' and (payload->>'monto')::numeric = 1000
                      from public.comm_outbox where order_id = v_o and plantilla = 'pago_recibido'),
    'h2: su llave es el id del COBRO (dos abonos = dos avisos, el mismo abono = uno)');
  perform tests.force_status(v_o, 'packed');
  perform tests.eq((select count(*)::int from public.comm_outbox where order_id = v_o and plantilla = 'pedido_enviado'), 0,
    'h3: empacar no le escribe al cliente');
  perform tests.force_status(v_o, 'shipped');
  perform tests.eq((select count(*)::int from public.comm_outbox where order_id = v_o and plantilla = 'pedido_enviado'), 1,
    'h4: salir a ruta sí');
  perform tests.force_status(v_o, 'delivered');
  perform tests.eq((select count(*)::int from public.comm_outbox where order_id = v_o and plantilla = 'pedido_entregado'), 1,
    'h5: y la entrega también');
  perform tests.force_status(v_o2, 'cancelled');
  perform tests.eq((select count(*)::int from public.comm_outbox where order_id = v_o2 and plantilla = 'pedido_cancelado'), 1,
    'h6: una cancelación encola su aviso');
  -- Reescribir el MISMO estado (un reintento del comando) no vuelve a encolar. Entregado
  -- es terminal en W1, así que la repetición posible es ésta, no un ir y venir.
  perform tests.force_status(v_o, 'delivered'); perform tests.force_status(v_o, 'delivered');
  perform tests.eq((select count(*)::int from public.comm_outbox where order_id = v_o and plantilla = 'pedido_entregado'), 1,
    'h7: pasar dos veces por el mismo estado no duplica el aviso');

  -- ── 5 · COMUNICAR JAMÁS TUMBA LA OPERACIÓN ────────────────────────────────
  perform tests.lives(format('select public._comm_encolar(%L, %L, %L, %L::jsonb)', 'x:1', 'plantilla_que_no_existe', v_o, '{}'),
    'r1: un fallo al encolar NO lanza hacia la operación de negocio');
  perform tests.eq((select count(*)::int from public.comm_outbox where event_key = 'x:1'), 0, 'r2: y no deja basura');

  -- ── 6 · AUTORIDAD ─────────────────────────────────────────────────────────
  perform tests.act_as(v_pos);
  perform tests.eq((select count(*)::int from public.comm_outbox), 0, 'a1: mostrador no ve el buzón (guarda correos de clientes)');
  perform tests.throws('select * from public.comm_reclamar(5)', 'NO_AUTORIZADO', 'a2: mostrador no reclama envíos');
  perform tests.throws(format('select public.comm_reintentar(%L)', gen_random_uuid()), 'NO_AUTORIZADO', 'a3: ni reintenta');
  perform tests.act_as(v_doc);
  perform tests.eq((select count(*)::int from public.comm_outbox), 0, 'a4: el doctor tampoco lo ve');

  -- ── 7 · RECLAMAR → RESOLVER ───────────────────────────────────────────────
  perform tests.act_as(v_admin);
  select count(*)::int into v_n from public.comm_reclamar(100);
  perform tests.eq(v_n, 4, 'd1: se reclaman los 4 pendientes (los sin destinatario no)');
  select count(*)::int into v_n from public.comm_reclamar(100);
  perform tests.eq(v_n, 0, 'd2: un segundo despachador NO recibe los mismos mensajes');
  select id, claim_token, event_key || ':' || generacion into v_id, v_claim, v_key
    from public.comm_outbox where order_id = v_o and plantilla = 'pedido_recibido';
  perform tests.eq((select status from public.comm_outbox where id = v_id), 'enviando', 'd3: reclamado = enviando, todavía NO enviado');
  perform tests.eq((select attempts from public.comm_outbox where id = v_id), 1, 'd4: cuenta el intento');

  perform tests.throws(format('select public.comm_resolver(%L, %L, %L, %L, null)', v_id, v_claim, 'enviado', 'resend'),
    'COMM_SIN_CONFIRMACION', 'd5: NO se puede marcar enviado sin el identificador del proveedor');
  perform tests.throws(format('select public.comm_resolver(%L, %L, %L, %L, %L)', v_id, gen_random_uuid(), 'enviado', 'resend', 'msg-1'),
    'COMM_RECLAMO_INVALIDO', 'd6: quien no lo reclamó no lo resuelve');
  perform tests.throws(format('select public.comm_resolver(%L, %L, %L)', v_id, v_claim, 'entregado'),
    'COMM_RESULTADO_INVALIDO', 'd7: el resultado es vocabulario cerrado');
  perform public.comm_resolver(v_id, v_claim, 'enviado', 'resend', 'msg-abc');
  perform tests.ok((select status = 'enviado' and provider_message_id = 'msg-abc' and sent_at is not null
                      from public.comm_outbox where id = v_id), 'd8: con confirmación del proveedor queda enviado');
  perform tests.throws(format('select public.comm_resolver(%L, %L, %L, %L, %L)', v_id, v_claim, 'enviado', 'resend', 'msg-2'),
    'COMM_RECLAMO_INVALIDO', 'd9: resolver dos veces no reescribe la confirmación');
  perform tests.throws(format('select public.comm_reintentar(%L)', v_id), 'COMM_YA_ENVIADO', 'd10: un enviado no se reenvía');

  -- ── 8 · INCIERTO: reintento seguro SOLO dentro de la ventana ──────────────
  select id, claim_token into v_id, v_claim from public.comm_outbox where order_id = v_o and plantilla = 'pago_recibido';
  perform public.comm_resolver(v_id, v_claim, 'incierto', 'resend', null, 'timeout');
  perform tests.eq((select status from public.comm_outbox where id = v_id), 'incierto', 'u1: un corte queda incierto, no fallido ni enviado');
  select idempotency_key into v_key from public.comm_reclamar(100) where id = v_id;
  perform tests.eq(v_key, (select event_key || ':1' from public.comm_outbox where id = v_id),
    'u2: dentro de la ventana se reintenta con la MISMA llave → el proveedor no duplica');
  perform tests.eq((select attempts from public.comm_outbox where id = v_id), 2, 'u3: segundo intento contado');
  select claim_token into v_claim from public.comm_outbox where id = v_id;
  perform public.comm_resolver(v_id, v_claim, 'incierto', 'resend', null, 'timeout');

  -- Fuera de la ventana el proveedor ya no deduplica: no se reintenta solo.
  perform tests.comm_ajustar(v_id, interval '21 hours');
  select count(*)::int into v_n from public.comm_reclamar(100) where id = v_id;
  perform tests.eq(v_n, 0, 'u4: pasada la ventana, lo incierto NO se reclama automáticamente');
  perform tests.throws(format('select public.comm_reintentar(%L)', v_id), 'COMM_POSIBLE_DUPLICADO',
    'u5: reenviarlo exige que una persona acepte el posible duplicado');
  perform public.comm_reintentar(v_id, true);
  perform tests.ok((select status = 'pendiente' and generacion = 2 and attempts = 0 from public.comm_outbox where id = v_id),
    'u6: aceptado, vuelve a la cola con una llave nueva (generación 2)');

  -- Tope de intentos.
  select id, claim_token into v_id, v_claim from public.comm_outbox where order_id = v_o and plantilla = 'pedido_enviado';
  perform public.comm_resolver(v_id, v_claim, 'incierto', 'resend', null, 'timeout');
  perform tests.comm_ajustar(v_id, null, 5);
  select count(*)::int into v_n from public.comm_reclamar(100) where id = v_id;
  perform tests.eq(v_n, 0, 'u7: agotados los intentos, deja de reintentarse solo y espera a una persona');

  -- ── 9 · FALLIDO Y SIN DESTINATARIO: decisión humana ───────────────────────
  select id, claim_token into v_id, v_claim from public.comm_outbox where order_id = v_o and plantilla = 'pedido_entregado';
  perform public.comm_resolver(v_id, v_claim, 'fallido', 'resend', null, 'dirección inválida');
  select count(*)::int into v_n from public.comm_reclamar(100) where id = v_id;
  perform tests.eq(v_n, 0, 'f1: un fallido no se reintenta solo');
  perform public.comm_reintentar(v_id);
  perform tests.ok((select status = 'pendiente' and generacion = 2 from public.comm_outbox where id = v_id),
    'f2: Dirección puede mandarlo de nuevo');

  select id into v_id from public.comm_outbox where order_id = v_o2 and plantilla = 'pedido_recibido';
  perform tests.throws(format('select public.comm_reintentar(%L)', v_id), 'COMM_SIGUE_SIN_CORREO',
    'f3: sin correo sigue sin poder enviarse');
  perform tests.set_email(v_doc2, 'dra.dos@clinica.mx');
  perform public.comm_reintentar(v_id);
  perform tests.ok((select status = 'pendiente' and to_address = 'dra.dos@clinica.mx' from public.comm_outbox where id = v_id),
    'f4: capturado el correo, el mensaje entra a la cola');

  -- ── 10 · EL BUZÓN NO SE ESCRIBE A MANO ────────────────────────────────────
  perform tests.throws_any(format($q$update public.comm_outbox set status = 'enviado' where id = %L$q$, v_id),
    array['COMM_SOLO_POR_COMANDO','permission denied','row-level security'],
    'g1: nadie marca "enviado" escribiendo la tabla');
  perform tests.act_as_owner();
  perform tests.throws(format($q$update public.comm_outbox set status = 'enviado' where id = %L$q$, v_id),
    'COMM_SOLO_POR_COMANDO', 'g2: ni siquiera el dueño de la tabla, sin pasar por el comando');
  perform set_config('app.trusted', 'on', true);
  perform tests.throws(format($q$update public.comm_outbox set status = 'enviado' where id = %L$q$, v_id),
    'ck_comm_enviado', 'g3: y aun por dentro, "enviado" sin confirmación viola el esquema');
  perform tests.throws(format($q$update public.comm_outbox set payload = '{}'::jsonb where id = %L$q$, v_id),
    'COMM_IDENTIDAD_INMUTABLE', 'g4: el contenido de un mensaje no se reescribe');
  perform tests.throws(format($q$delete from public.comm_outbox where id = %L$q$, v_id),
    'COMM_NO_SE_BORRA', 'g5: un mensaje al cliente es evidencia: no se borra');
  perform set_config('app.trusted', 'off', true);
end $t$;
rollback;
