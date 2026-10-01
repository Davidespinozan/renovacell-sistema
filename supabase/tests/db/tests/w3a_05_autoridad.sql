-- W3-A · CIERRE DE AUTORIDAD FISCAL + REGRESIÓN EXPLÍCITA DEL P0.
--
-- El mecanismo P0 descubierto era:
--   el PAC pudo timbrar → timeout en el cliente → el cliente ejecutaba
--   update({ invoice_meta: null }) → se destruía el folio fiscal que el servidor sí
--   había guardado → invoice_requested seguía true → la UI volvía a ofrecer emitir
--   → segundo CFDI real ante el SAT.
--
-- Este archivo prueba que ese camino ya NO existe, paso por paso.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing');
  v_doctor uuid := tests.user('doctor'); v_otro uuid := tests.user('doctor', 'ajeno-w3a@test.local');
  v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_meta jsonb;
  r record;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.timbrar(v_d, 'DEADBEEF-1111-2222-3333-444455556666', 'produccion');

  -- El servidor dejó la proyección con el folio real.
  select invoice_meta into v_meta from public.orders where id = v_o;
  perform tests.eq(v_meta->>'uuid', 'DEADBEEF-1111-2222-3333-444455556666',
    'el servidor proyecta el folio fiscal en el pedido');

  -- ══ LA REGRESIÓN DEL P0 ══════════════════════════════════════════════════
  -- Exactamente la escritura que hacía el cliente al fallar. Debe ser imposible
  -- para TODOS los roles, Dirección incluida.
  -- Se verifica el EFECTO, no solo el mensaje: para algunos roles la RLS ni siquiera deja
  -- alcanzar la fila (el UPDATE afecta 0 renglones y no hay excepción). Lo que importa es
  -- que la evidencia fiscal salga intacta por cualquiera de los dos caminos.
  for r in select * from (values ('admin', v_admin), ('billing', v_bill), ('doctor', v_doctor),
                                 ('warehouse', v_wh), ('pos', v_pos)) as t(rol, uid) loop
    perform tests.act_as(r.uid);
    perform tests.sin_efecto(
      format('update public.orders set invoice_meta = null where id = %L', v_o),
      format('select invoice_meta->>''uuid'' from public.orders where id = %L', v_o),
      'DEADBEEF-1111-2222-3333-444455556666',
      format('P0: el rol %s NO puede borrar la evidencia fiscal del pedido', r.rol));
    perform tests.sin_efecto(
      format('update public.orders set invoice_requested = true, invoice_meta = null where id = %L', v_o),
      format('select invoice_meta->>''uuid'' from public.orders where id = %L', v_o),
      'DEADBEEF-1111-2222-3333-444455556666',
      format('P0: el rol %s NO puede borrar la evidencia y rehabilitar la emisión', r.rol));
    perform tests.sin_efecto(
      format($q$update public.orders set invoice_meta = '{"status":"timbrada","uuid":"11112222-3333-4444-5555-666677778888"}'::jsonb where id = %L$q$, v_o),
      format('select invoice_meta->>''uuid'' from public.orders where id = %L', v_o),
      'DEADBEEF-1111-2222-3333-444455556666',
      format('el rol %s NO puede FABRICAR un folio fiscal', r.rol));
    perform tests.sin_efecto(
      format('update public.orders set invoice_requested = false where id = %L', v_o),
      format('select invoice_requested::text from public.orders where id = %L', v_o),
      'true',
      format('el rol %s NO puede cambiar la marca de solicitud', r.rol));
  end loop;

  -- Y para los roles que SÍ alcanzan la fila, el mensaje es el canónico.
  perform tests.act_as(v_admin);
  perform tests.throws(format('update public.orders set invoice_meta = null where id = %L', v_o),
    'FISCAL_SOLO_POR_COMANDO', 'Dirección recibe el error canónico al intentar editar la evidencia');
  perform tests.act_as(v_bill);
  perform tests.throws(format('update public.orders set invoice_requested = false where id = %L', v_o),
    'FISCAL_SOLO_POR_COMANDO', 'Facturación recibe el error canónico');

  -- La evidencia sigue intacta después de todos los intentos.
  perform tests.eq((select invoice_meta->>'uuid' from public.orders where id = v_o),
    'DEADBEEF-1111-2222-3333-444455556666',
    'P0 CERRADO: tras todos los intentos, el folio fiscal sigue en su lugar');
  perform tests.eq((select count(*)::int from public.fiscal_documents where order_id = v_o and status = 'timbrado'), 1,
    'P0 CERRADO: sigue existiendo UN solo documento timbrado');
  -- Y no se puede abrir una segunda emisión.
  perform tests.act_as(v_admin);
  perform tests.eq(public.solicitar_cfdi(gen_random_uuid(), v_o, tests.fiscal())->>'status', 'already_stamped',
    'P0 CERRADO: pedir factura otra vez devuelve el folio existente, no un segundo timbrado');

  -- ══ La tabla fiscal no se escribe desde fuera ═════════════════════════════
  for r in select * from (values ('admin', v_admin), ('billing', v_bill), ('doctor', v_doctor)) as t(rol, uid) loop
    perform tests.act_as(r.uid);
    perform tests.throws_any(
      format($q$insert into public.fiscal_documents (id, order_id, status, receiver) values (gen_random_uuid(), %L, 'pendiente', %L::jsonb)$q$, v_o, tests.fiscal()),
      array['permission denied', 'row-level security', 'FISCAL_'],
      format('el rol %s no inserta documentos fiscales a mano', r.rol));
    perform tests.throws_any(
      format('update public.fiscal_documents set status = ''fallido'' where id = %L', v_d),
      array['permission denied', 'FISCAL_SOLO_POR_COMANDO', 'row-level security'],
      format('el rol %s no mueve el estado fiscal a mano', r.rol));
    perform tests.throws_any(
      format('delete from public.fiscal_documents where id = %L', v_d),
      array['permission denied', 'FISCAL_NO_SE_BORRA', 'row-level security'],
      format('el rol %s no borra documentos fiscales', r.rol));
    perform tests.throws_any(
      format($q$insert into public.fiscal_document_events (fiscal_document_id, to_status, event) values (%L, 'timbrado', 'timbre')$q$, v_d),
      array['permission denied', 'row-level security'],
      format('el rol %s no escribe en la bitácora fiscal', r.rol));
    perform tests.throws_any(
      format('delete from public.fiscal_document_events where fiscal_document_id = %L', v_d),
      array['permission denied', 'LEDGER_APPEND_ONLY', 'row-level security'],
      format('el rol %s no borra la bitácora fiscal', r.rol));
  end loop;

  -- ══ Lectura acotada ══════════════════════════════════════════════════════
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.fiscal_documents where id = v_d), 1, 'Dirección lee los documentos fiscales');
  perform tests.act_as(v_bill);
  perform tests.eq((select count(*)::int from public.fiscal_documents where id = v_d), 1, 'Facturación lee los documentos fiscales');
  perform tests.act_as(v_doctor);
  perform tests.eq((select count(*)::int from public.fiscal_documents where id = v_d), 0, 'el doctor NO lee la tabla fiscal (ve su pedido, no el libro)');
  perform tests.act_as(v_wh);
  perform tests.eq((select count(*)::int from public.fiscal_documents where id = v_d), 0, 'almacén NO lee la tabla fiscal');
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.fiscal_documents', 'permission denied',
    'anónimo no tiene ni permiso de lectura sobre el libro fiscal');
  perform tests.throws('select count(*) from public.fiscal_document_events', 'permission denied',
    'anónimo no tiene ni permiso de lectura sobre la bitácora fiscal');

  -- ══ CROSS-TENANT: un doctor no factura el pedido de otro ═════════════════
  perform tests.act_as(v_otro);
  perform tests.throws(format('select public.solicitar_cfdi(%L, %L, %L::jsonb)', gen_random_uuid(), v_o, tests.fiscal()),
    'NO_AUTORIZADO', 'un doctor no puede solicitar la factura de un pedido ajeno');
  perform tests.throws(format('select public.estado_fiscal_pedido(%L)', v_o),
    'NO_AUTORIZADO', 'un doctor no consulta el estado fiscal de un pedido ajeno');
  perform tests.throws('select public.conciliar_cfdi()', 'NO_AUTORIZADO', 'la conciliación fiscal es solo de Dirección');
  perform tests.act_as(v_bill);
  perform tests.throws('select public.conciliar_cfdi()', 'NO_AUTORIZADO', 'ni Facturación concilia');

  -- ══ Internos fuera del alcance de los clientes ═══════════════════════════
  perform tests.act_as(v_admin);
  for r in select * from (values
      ('_w3_reclamar', format('select public._w3_reclamar(%L, gen_random_uuid())', v_d)),
      ('_w3_transicion', format('select public._w3_transicion(%L, ''fallido'', ''fallo'')', v_d)),
      ('_w3_op_finish', format('select public._w3_op_finish(gen_random_uuid(), ''cfdi_solicitado'', ''{}''::jsonb, ''{}''::jsonb)')),
      ('_w3_proyectar', format('select public._w3_proyectar(%L)', v_o)),
      ('_w3_fingerprint', format('select public._w3_fingerprint(%L, %L::jsonb)', v_o, tests.fiscal())),
      ('_w3_receptor', format('select public._w3_receptor(%L, null)', v_o))
    ) as t(fn, sql) loop
    perform tests.throws(r.sql, 'permission denied',
      format('ni Dirección puede invocar el interno %s', r.fn));
  end loop;
end $t$;
rollback;

-- ── El doctor dueño SÍ puede pedir su factura, pero no tocar la evidencia ───────────────
begin;
do $t$
declare
  v_doctor uuid := tests.user('doctor'); v_p uuid := tests.product(100); v_o uuid; v_d uuid;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_doctor);
  v_d := (public.solicitar_cfdi(gen_random_uuid(), v_o, tests.fiscal())->>'doc_id')::uuid;
  perform tests.ok(v_d is not null, 'el doctor dueño puede solicitar su propia factura');
  perform tests.eq(public.estado_fiscal_pedido(v_o)->>'status', 'pendiente',
    'y puede consultar el estado de su propio pedido');
  perform tests.throws(format('update public.orders set invoice_meta = null where id = %L', v_o),
    'FISCAL_SOLO_POR_COMANDO', 'pero no puede borrar la evidencia fiscal de su pedido');
end $t$;
rollback;

-- ── set_order_fiscal_snapshot sigue funcionando y no abre un hueco ──────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);

  -- Mientras la intención está pendiente, corregir el receptor sincroniza AMBOS lados.
  perform public.set_order_fiscal_snapshot(v_o, tests.fiscal('CCC010101CC1'));
  perform tests.eq((select invoice_meta->'receiver'->>'rfc' from public.orders where id = v_o), 'CCC010101CC1',
    'el snapshot del pedido se actualiza');
  perform tests.eq((select receiver->>'rfc' from public.fiscal_documents where id = v_d), 'CCC010101CC1',
    'y la intención fiscal queda con el MISMO receptor (la huella no se desfasa)');
  perform tests.eq((select count(*)::int from public.fiscal_document_events
                     where fiscal_document_id = v_d and event = 'solicitud_actualizada'), 1,
    'el cambio deja rastro en la bitácora fiscal');

  -- Una vez que la intención salió, el snapshot ya no se toca por esta vía.
  perform tests.timbrar(v_d, 'ABCDEF01-1111-2222-3333-444455556666');
  perform tests.act_as(v_admin);
  perform tests.throws_any(format('select public.set_order_fiscal_snapshot(%L, %L::jsonb)', v_o, tests.fiscal('DDD010101DD1')),
    array['YA_TIMBRADO', 'FISCAL_SOLICITUD_CONGELADA'],
    'con CFDI emitido el receptor ya no se cambia por esta vía');
end $t$;
rollback;
