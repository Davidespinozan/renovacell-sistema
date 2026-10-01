-- W3-A · LA MÁQUINA DE ESTADOS Y LA REGLA CENTRAL DE W3:
--   TIMEOUT / ERROR DE RED ≠ "NO SE TIMBRÓ".
-- `fallido` = se demuestra que el PAC no produjo efecto → se puede reintentar.
-- `incierto` = pudo producirlo → NO se reintenta, se concilia. Y de `incierto` no se
-- puede volver a `en_proceso` por ningún camino.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_r jsonb;
  v_pares text[][] := array[
    ['pendiente','en_proceso'], ['pendiente','fallido'], ['en_proceso','timbrado'],
    ['en_proceso','fallido'], ['en_proceso','incierto'], ['incierto','timbrado'],
    ['incierto','fallido'], ['timbrado','cancelado']];
  v_malos text[][] := array[
    ['incierto','en_proceso'],   -- de un estado ambiguo NO se reintenta
    ['pendiente','timbrado'],    -- no se timbra sin reclamar
    ['pendiente','incierto'],    -- no hay ambigüedad sin intento
    ['timbrado','fallido'],      -- un CFDI real no se "deshace"
    ['timbrado','en_proceso'],
    ['fallido','timbrado'],      -- un fallido demostrado no se convierte en timbre
    ['fallido','en_proceso'],    -- se solicita de nuevo, no se resucita
    ['cancelado','timbrado'],
    ['en_proceso','pendiente'],
    ['en_proceso','en_proceso']];
  i int;
begin
  perform tests.act_as_owner();
  for i in 1 .. array_length(v_pares, 1) loop
    perform tests.ok(public._w3_transicion_valida(v_pares[i][1], v_pares[i][2]),
      format('transición permitida: %s → %s', v_pares[i][1], v_pares[i][2]));
  end loop;
  for i in 1 .. array_length(v_malos, 1) loop
    perform tests.ok(not public._w3_transicion_valida(v_malos[i][1], v_malos[i][2]),
      format('transición PROHIBIDA: %s → %s', v_malos[i][1], v_malos[i][2]));
  end loop;

  -- ── El rechazo es real, no solo declarativo ────────────────────────────────
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.act_as_owner();
  perform tests.throws(format($q$select public._w3_transicion(%L, 'timbrado', 'timbre', null, 'salto', null,
      'AAAABBBB-1111-2222-3333-444455556666', null, 'sandbox')$q$, v_d),
    'FISCAL_TRANSICION_INVALIDA', 'no se puede timbrar una solicitud sin reclamarla primero');

  -- ── TIMEOUT: se va a `incierto`, conservando el rastro del intento ─────────
  perform public._w3_reclamar(v_d, gen_random_uuid());
  v_r := public._w3_transicion(v_d, 'incierto', 'incierto', 'en_proceso', 'timeout al PAC', null,
    null, null, 'produccion', null, null, null, 'timeout', 'no llegó respuesta del proveedor');
  perform tests.eq(v_r->>'status', 'incierto', 'un timeout deja la intención en incierto, no en fallido');
  perform tests.eq((select error_code from public.fiscal_documents where id = v_d), 'timeout',
    'se conserva por qué quedó ambigua');
  perform tests.eq((select attempts from public.fiscal_documents where id = v_d), 1,
    'el intento quedó contado');
  perform tests.ok((select claimed_at is not null from public.fiscal_documents where id = v_d),
    'incierto conserva la marca del reclamo: hubo un intento real');

  -- De incierto NO se sale reintentando.
  perform tests.throws(format($q$select public._w3_transicion(%L, 'en_proceso', 'claim', null, 'reintento')$q$, v_d),
    'FISCAL_TRANSICION_INVALIDA', 'de un estado incierto NO se reintenta: se concilia');
  perform tests.ok(public._w3_reclamar(v_d, gen_random_uuid()) is null,
    'el reclamo no toca un documento incierto (solo reclama pendientes)');

  -- La conciliación SÍ puede resolverlo, en cualquiera de los dos sentidos.
  v_r := public._w3_transicion(v_d, 'timbrado', 'conciliacion', 'incierto', 'el PAC sí lo tenía', null,
    'AAAABBBB-1111-2222-3333-444455556666', 'FAC-9', 'produccion', null, null, now(),
    null, null, null, 'adoptado por conciliación');
  perform tests.eq(v_r->>'status', 'timbrado', 'la conciliación adopta un timbre huérfano');
  perform tests.eq((select uuid from public.fiscal_documents where id = v_d), 'AAAABBBB-1111-2222-3333-444455556666',
    'el folio adoptado queda registrado');
  perform tests.ok((select reconciled_at is not null from public.fiscal_documents where id = v_d),
    'queda constancia de que se conoció por conciliación');
  perform tests.eq((select error_code from public.fiscal_documents where id = v_d), null,
    'al resolverse, el motivo de ambigüedad se limpia');

  -- ── La bitácora tiene la historia COMPLETA, en orden ──────────────────────
  perform tests.eq((select string_agg(to_status, '→' order by created_at, id)
                      from public.fiscal_document_events where fiscal_document_id = v_d),
    'pendiente→en_proceso→incierto→timbrado',
    'la historia completa quedó registrada, incluido el paso por incierto');
end $t$;
rollback;

-- ── DESCARTAR: libera sin inventar. Y un incierto NO se descarta ────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_wh uuid := tests.user('warehouse'); v_p uuid := tests.product(100);
  v_o uuid; v_d uuid; v_r jsonb;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);

  perform tests.throws(format('select public.descartar_solicitud_cfdi(%L, %L, '''')', gen_random_uuid(), v_d),
    'MOTIVO_REQUERIDO', 'descartar exige decir por qué');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.descartar_solicitud_cfdi(%L, %L, ''error de captura'')', gen_random_uuid(), v_d),
    'NO_AUTORIZADO', 'almacén no descarta solicitudes fiscales');

  perform tests.act_as(v_admin);
  v_r := public.descartar_solicitud_cfdi(gen_random_uuid(), v_d, 'se capturó el cliente equivocado');
  perform tests.eq(v_r->>'status', 'applied', 'Dirección puede descartar una solicitud que nunca salió');
  perform tests.eq((select status from public.fiscal_documents where id = v_d), 'fallido',
    'la solicitud descartada queda como fallida, no borrada');
  perform tests.eq((select reconcile_note from public.fiscal_documents where id = v_d), 'se capturó el cliente equivocado',
    'el motivo del descarte queda guardado');
  perform tests.eq((select count(*)::int from public.fiscal_document_events
                     where fiscal_document_id = v_d and event = 'descarte'), 1,
    'el descarte deja su fila en la bitácora');

  -- Un incierto NO se puede descartar: sería declarar que no se timbró sin saberlo.
  v_d := tests.solicitud(v_o);
  perform tests.act_as_owner();
  perform public._w3_reclamar(v_d, gen_random_uuid());
  perform public._w3_transicion(v_d, 'incierto', 'incierto', 'en_proceso', 'red caída', null,
    null, null, 'produccion', null, null, null, 'red', 'sin respuesta');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.descartar_solicitud_cfdi(%L, %L, ''ya no la quiero'')', gen_random_uuid(), v_d),
    'CFDI_INCIERTO', 'un estado incierto no se descarta: hay que conciliarlo');
end $t$;
rollback;

-- ── estado_fiscal_pedido: la UI nunca recibe permiso para reintentar un incierto ────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_e jsonb;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_e := public.estado_fiscal_pedido(v_o);
  perform tests.eq(v_e->>'status', 'sin_solicitud', 'sin intención, el estado lo dice claro');
  perform tests.ok((v_e->>'puede_solicitar')::boolean, 'y se puede solicitar');
  perform tests.ok(not (v_e->>'timbrado_habilitado')::boolean, 'W3-A declara que el timbrado NO está habilitado');

  v_d := tests.solicitud(v_o);
  v_e := public.estado_fiscal_pedido(v_o);
  perform tests.eq(v_e->>'status', 'pendiente', 'con intención registrada el estado es pendiente');
  perform tests.ok(not (v_e->>'puede_reintentar')::boolean, 'nada que reintentar todavía');

  perform tests.act_as_owner();
  perform public._w3_reclamar(v_d, gen_random_uuid());
  perform public._w3_transicion(v_d, 'incierto', 'incierto', 'en_proceso', 'timeout', null,
    null, null, 'produccion', null, null, null, 'timeout', 'sin respuesta del PAC');
  perform tests.act_as(v_admin);
  v_e := public.estado_fiscal_pedido(v_o);
  perform tests.eq(v_e->>'status', 'incierto', 'el estado ambiguo se muestra tal cual');
  perform tests.ok(not (v_e->>'puede_reintentar')::boolean, 'NUNCA se ofrece reintentar desde incierto');
  perform tests.ok(not (v_e->>'puede_solicitar')::boolean, 'ni solicitar de nuevo');
  perform tests.ok((v_e->>'requiere_conciliacion')::boolean, 'se pide conciliación explícitamente');

  -- Un fallido SÍ es reintentable: ahí sí se demostró que no hubo efecto.
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  v_d := tests.solicitud(v_o);
  perform tests.act_as_owner();
  perform public._w3_reclamar(v_d, gen_random_uuid());
  perform public._w3_transicion(v_d, 'fallido', 'fallo', 'en_proceso', 'rechazo de validación', null,
    null, null, 'sandbox', null, null, null, 'validacion', 'RFC del receptor no existe');
  perform tests.act_as(v_admin);
  v_e := public.estado_fiscal_pedido(v_o);
  perform tests.ok((v_e->>'puede_reintentar')::boolean, 'un fallo demostrado SÍ es reintentable');
  perform tests.eq(v_e->>'error_message', 'RFC del receptor no existe', 'y el operador ve por qué falló');
end $t$;
rollback;
