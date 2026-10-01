-- W3-A · LA SOLICITUD ES IDEMPOTENTE Y UNA SOLA POR PEDIDO.
-- El mismo op_id no produce dos efectos; el mismo pedido no produce dos intenciones vivas;
-- un CFDI ya timbrado no se vuelve a intentar; y un estado `incierto` BLOQUEA la emisión
-- en vez de invitar a reintentar.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_bill uuid := tests.user('billing'); v_p uuid := tests.product(116);
  v_o uuid; v_o2 uuid; v_o3 uuid; v_d uuid; v_op uuid := gen_random_uuid(); v_r jsonb;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);

  -- ── Mismo op_id dos veces ⇒ un solo efecto ────────────────────────────────
  v_r := public.solicitar_cfdi(v_op, v_o, tests.fiscal());
  perform tests.eq(v_r->>'status', 'applied', 'la primera solicitud se aplica');
  v_d := (v_r->>'doc_id')::uuid;
  v_r := public.solicitar_cfdi(v_op, v_o, tests.fiscal());
  perform tests.eq(v_r->>'status', 'already_applied', 'el mismo op_id devuelve el resultado ya registrado');
  perform tests.eq((select count(*)::int from public.fiscal_documents where order_id = v_o), 1,
    'no se creó una segunda intención con el mismo op_id');
  perform tests.eq((select count(*)::int from public.fiscal_operations where op_id = v_op), 1,
    'una sola operación registrada');

  -- ── Mismo op_id con OTROS datos ⇒ se rechaza ──────────────────────────────
  perform tests.throws(format('select public.solicitar_cfdi(%L, %L, %L::jsonb)', v_op, v_o, tests.fiscal('AAA010101AAA')),
    'OP_ID_REUTILIZADO', 'el mismo identificador con otros datos se rechaza');

  -- ── Mismo PEDIDO, op_id nuevo, mismo contenido ⇒ ya estaba solicitado ─────
  v_r := public.solicitar_cfdi(gen_random_uuid(), v_o, tests.fiscal());
  perform tests.eq(v_r->>'status', 'already_requested', 'el mismo pedido no genera una segunda intención');
  perform tests.eq((v_r->>'doc_id')::uuid, v_d, 'devuelve la intención que ya existía');
  perform tests.eq((select count(*)::int from public.fiscal_documents where order_id = v_o), 1,
    'sigue habiendo UN solo documento fiscal para el pedido');

  -- ── Mismo pedido con receptor DISTINTO ⇒ se corrige la solicitud pendiente ─
  v_r := public.solicitar_cfdi(gen_random_uuid(), v_o, tests.fiscal('AAA010101AA1'));
  perform tests.eq(v_r->>'status', 'updated', 'mientras está pendiente, el contenido se puede corregir');
  perform tests.eq((select receiver->>'rfc' from public.fiscal_documents where id = v_d), 'AAA010101AA1',
    'el receptor corregido queda congelado en el documento');
  perform tests.eq((select count(*)::int from public.fiscal_document_events
                     where fiscal_document_id = v_d and event = 'solicitud_actualizada'), 1,
    'la corrección deja su rastro en la bitácora (y una solicitud sin cambios no inventa uno)');

  -- ── Ya TIMBRADO ⇒ no se vuelve a intentar, se devuelve el folio ────────────
  perform tests.timbrar(v_d, 'AAAABBBB-1111-2222-3333-444455556666');
  perform tests.act_as(v_admin);
  v_r := public.solicitar_cfdi(gen_random_uuid(), v_o, tests.fiscal());
  perform tests.eq(v_r->>'status', 'already_stamped', 'un pedido ya timbrado no se vuelve a timbrar');
  perform tests.eq(v_r->>'uuid', 'AAAABBBB-1111-2222-3333-444455556666', 'devuelve el folio fiscal que ya existe');

  -- ── INCIERTO ⇒ bloquea la emisión (la regla central de W3) ────────────────
  v_o2 := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o2);
  perform tests.act_as_owner();
  perform tests.reclamar(v_d);
  perform public._w3_transicion(v_d, 'incierto', 'incierto', 'en_proceso', 'timeout de red', null,
    null, null, null, null, null, null, 'timeout', 'se perdió la respuesta del PAC');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.solicitar_cfdi(%L, %L, %L::jsonb)', gen_random_uuid(), v_o2, tests.fiscal()),
    'CFDI_INCIERTO', 'un estado incierto BLOQUEA una nueva emisión: no se reintenta a ciegas');

  -- ── EN PROCESO ⇒ tampoco se emite en paralelo ─────────────────────────────
  v_o3 := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o3);
  perform tests.act_as_owner();
  perform tests.reclamar(v_d);
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.solicitar_cfdi(%L, %L, %L::jsonb)', gen_random_uuid(), v_o3, tests.fiscal()),
    'CFDI_EN_PROCESO', 'con un timbrado en curso no se lanza otro');

  -- ── DESCARTAR libera la ranura (sin inventar ni borrar nada) ──────────────
  perform tests.act_as_owner();
  perform public._w3_transicion(v_d, 'fallido', 'fallo', 'en_proceso', 'rechazo de validación', null,
    null, null, null, null, null, null, 'validacion', 'el PAC rechazó el comprobante');
  perform tests.act_as(v_admin);
  v_r := public.solicitar_cfdi(gen_random_uuid(), v_o3, tests.fiscal());
  perform tests.eq(v_r->>'status', 'applied', 'tras un fallo demostrado se puede volver a solicitar');
  perform tests.eq((select count(*)::int from public.fiscal_documents where order_id = v_o3), 2,
    'la intención fallida se conserva: no se borra, se acompaña de la nueva');
end $t$;
rollback;

-- ── Receptor: resolución server-side sin defaults ──────────────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_c uuid;
begin
  -- Sin datos en ninguna parte ⇒ se rechaza explícito, NO se inventan 616/G03.
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.solicitar_cfdi(%L, %L, null)', gen_random_uuid(), v_o),
    'DATOS_FISCALES_REQUERIDOS', 'sin datos fiscales completos NO se registra la intención');

  -- Receptor explícito INVÁLIDO ⇒ tampoco se sustituye en silencio por otro.
  perform tests.throws(format($q$select public.solicitar_cfdi(%L, %L, '{"rfc":"NOPE"}'::jsonb)$q$, gen_random_uuid(), v_o),
    'DATOS_FISCALES_REQUERIDOS', 'un receptor explícito inválido no cae a otra fuente');

  -- Con el MAESTRO del cliente completo ⇒ se resuelve solo.
  perform tests.act_as_service();
  insert into public.customers (id, full_name, active, meta)
  values (gen_random_uuid(), 'Cliente Fiscal', true,
          jsonb_build_object('fiscal', tests.fiscal('BBB010101BB1'))) returning id into v_c;
  update public.orders set customer_id = v_c where id = v_o;
  perform tests.act_as(v_admin);
  v_d := (public.solicitar_cfdi(gen_random_uuid(), v_o, null)->>'doc_id')::uuid;
  perform tests.eq((select receiver->>'rfc' from public.fiscal_documents where id = v_d), 'BBB010101BB1',
    'el receptor se resuelve del maestro del cliente cuando el pedido no lo trae');
  perform tests.eq((select receiver->>'uso_cfdi' from public.fiscal_documents where id = v_d), 'G03',
    'el receptor se guarda completo y canónico');

  -- La PROYECCIÓN del pedido queda alineada con el documento.
  perform tests.eq((select invoice_meta->'fiscal'->>'status' from public.orders where id = v_o), 'pendiente',
    'orders.invoice_meta refleja el estado fiscal como proyección');
  perform tests.eq((select invoice_meta->'receiver'->>'rfc' from public.orders where id = v_o), 'BBB010101BB1',
    'la proyección conserva el receptor congelado');
  perform tests.ok((select invoice_requested from public.orders where id = v_o),
    'la solicitud marca el pedido como facturable');
  -- Y NO se declara timbrado mientras no haya folio.
  perform tests.ok((select coalesce(invoice_meta->>'status','') <> 'timbrada' from public.orders where id = v_o),
    'la proyección NO dice timbrada sin UUID del SAT');
end $t$;
rollback;

-- ── Un pedido cancelado no se factura ───────────────────────────────────────────────────
begin;
do $t$
declare v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
        v_p uuid := tests.product(100); v_o uuid;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.force_status(v_o, 'cancelled');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.solicitar_cfdi(%L, %L, %L::jsonb)', gen_random_uuid(), v_o, tests.fiscal()),
    'PEDIDO_CANCELADO', 'un pedido cancelado no admite solicitud de factura');
end $t$;
rollback;
