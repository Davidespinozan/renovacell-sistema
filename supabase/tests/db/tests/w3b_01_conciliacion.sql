-- W3-B · LA REGLA ASIMÉTRICA.
--   ENCONTRADO    → se puede adoptar automáticamente.
--   NO ENCONTRADO → no demuestra nada, y NUNCA concluye solo.
-- Concluir "no existe comprobante" a partir de una consulta vacía reabriría el P0
-- que W3-A cerró. Por eso esa conclusión exige cuatro condiciones verificadas en la
-- BASE y, además, el acto explícito de Dirección.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing');
  v_doctor uuid := tests.user('doctor'); v_p uuid := tests.product(100);
  v_o uuid; v_d uuid; v_claim uuid; v_ev jsonb;
begin
  perform tests.emisor('AAA010101AAA');
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.reclamar_id(v_d, 'produccion');
  select claim_id into v_claim from public.fiscal_documents where id = v_d;
  perform public.registrar_resultado_cfdi(gen_random_uuid(), v_d, v_claim, 'incierto',
    null, null, null, 'timeout', 'sin respuesta del proveedor');

  -- ── Una consulta vacía NO cambia el estado ────────────────────────────────
  perform tests.sondeo(v_d, 'vacio');
  perform tests.eq((select status from public.fiscal_documents where id = v_d), 'incierto',
    'un sondeo vacío NO convierte la intención en fallida');
  perform tests.eq((select count(*)::int from public.fiscal_reconciliations where fiscal_document_id = v_d), 1,
    'pero sí queda registrado como evidencia');

  -- ── Un solo sondeo no habilita la resolución negativa ─────────────────────
  v_ev := public.evidencia_inexistencia_cfdi(v_d);
  perform tests.ok(not (v_ev->>'listo_para_resolucion_negativa')::boolean,
    'con un solo sondeo la evidencia es insuficiente');
  perform tests.throws(format('select public.resolver_cfdi_inexistente(%L, %L, ''no aparece'')', gen_random_uuid(), v_d),
    'FISCAL_INTENTO_RECIENTE', 'un intento recién hecho no se declara inexistente');

  -- ── Dos sondeos SIN separación tampoco ────────────────────────────────────
  perform tests.envejecer_reclamo(v_d, interval '3 hours');
  perform tests.sondeo(v_d, 'vacio');
  v_ev := public.evidencia_inexistencia_cfdi(v_d);
  perform tests.eq((v_ev->>'sondeos_vacios')::int, 2, 'hay dos sondeos vacíos');
  perform tests.ok(not (v_ev->>'dos_sondeos_separados')::boolean,
    'pero sin separación en el tiempo no cuentan: un retraso de replicación los explicaría');
  perform tests.throws(format('select public.resolver_cfdi_inexistente(%L, %L, ''no aparece'')', gen_random_uuid(), v_d),
    'FISCAL_EVIDENCIA_INSUFICIENTE', 'dos consultas pegadas no bastan');

  -- ── Con separación real, la evidencia ya alcanza… ─────────────────────────
  perform tests.sondeo(v_d, 'vacio', null, 'lookup_serie_folio', interval '4 hours');
  v_ev := public.evidencia_inexistencia_cfdi(v_d);
  perform tests.ok((v_ev->>'dos_sondeos_separados')::boolean, 'con separación temporal la evidencia es válida');
  perform tests.ok((v_ev->>'listo_para_resolucion_negativa')::boolean, 'el dictamen ya habilita la resolución');

  -- ── …pero NO basta la evidencia: hace falta DIRECCIÓN ─────────────────────
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.resolver_cfdi_inexistente(%L, %L, ''no aparece'')', gen_random_uuid(), v_d),
    'NO_AUTORIZADO', 'Facturación NO puede declarar que no existe comprobante');
  perform tests.eq((select status from public.fiscal_documents where id = v_d), 'incierto',
    'y la intención sigue incierta');

  -- ── Dirección sí, y con motivo ────────────────────────────────────────────
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.resolver_cfdi_inexistente(%L, %L, ''  '')', gen_random_uuid(), v_d),
    'MOTIVO_REQUERIDO', 'Dirección debe explicar en qué se basa');
  perform tests.eq(public.resolver_cfdi_inexistente(gen_random_uuid(), v_d,
                     'tres consultas al PAC sin resultado en 8 horas')->>'fiscal_status', 'fallido',
    'Dirección concluye la resolución negativa');
  perform tests.eq((select error_code from public.fiscal_documents where id = v_d), 'inexistente_confirmado',
    'el motivo queda clasificado');
  perform tests.eq((select folio from public.fiscal_documents where id = v_d), '1',
    'el folio NO se recicla: el hueco se conserva para la auditoría');
end $t$;
rollback;

-- ── EVIDENCIA POSITIVA: se adopta, y bloquea cualquier conclusión negativa ──────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_claim uuid; v_ev jsonb;
  v_uuid text := 'A1B2C3D4-1111-2222-3333-444455556666';
begin
  perform tests.emisor('AAA010101AAA');
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.reclamar_id(v_d, 'produccion');
  select claim_id into v_claim from public.fiscal_documents where id = v_d;
  perform public.registrar_resultado_cfdi(gen_random_uuid(), v_d, v_claim, 'incierto',
    null, null, null, 'timeout', 'sin respuesta');

  -- Un sondeo vacío previo no impide adoptar después: lo positivo manda.
  perform tests.sondeo(v_d, 'vacio', null, 'lookup_serie_folio', interval '5 hours');
  perform tests.sondeo(v_d, 'encontrado', v_uuid);
  perform tests.eq(public.adoptar_cfdi(gen_random_uuid(), v_d, v_uuid, 'FAC-1', now(), 'Vigente')->>'fiscal_status',
    'timbrado', 'la evidencia positiva se adopta');
  perform tests.eq((select uuid from public.fiscal_documents where id = v_d), v_uuid,
    'el folio fiscal encontrado queda registrado');
  perform tests.ok((select reconciled_at is not null from public.fiscal_documents where id = v_d),
    'queda constancia de que se supo por conciliación');

  -- El SAT es la autoridad: si dice que no existe, NO se adopta.
  perform tests.throws(format('select public.adoptar_cfdi(%L, %L, %L, null, null, ''No encontrado'')',
      gen_random_uuid(), v_d, 'B1B2C3D4-1111-2222-3333-444455556666'),
    'SAT_NO_ENCONTRADO', 'no se adopta un folio que el SAT no reconoce');
end $t$;
rollback;

-- ── La evidencia positiva BLOQUEA la resolución negativa ────────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_claim uuid; v_ev jsonb;
begin
  perform tests.emisor('AAA010101AAA');
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.reclamar_id(v_d, 'produccion');
  select claim_id into v_claim from public.fiscal_documents where id = v_d;
  perform public.registrar_resultado_cfdi(gen_random_uuid(), v_d, v_claim, 'incierto',
    null, null, null, 'red', 'sin respuesta');
  perform tests.envejecer_reclamo(v_d, interval '5 hours');
  perform tests.sondeo(v_d, 'vacio', null, 'lookup_serie_folio', interval '6 hours');
  perform tests.sondeo(v_d, 'vacio');
  -- Un sondeo encontró algo en algún momento ⇒ jamás se concluye que no existe.
  perform tests.sondeo(v_d, 'encontrado', 'C1C2C3C4-1111-2222-3333-444455556666');
  v_ev := public.evidencia_inexistencia_cfdi(v_d);
  perform tests.ok(not (v_ev->>'sin_evidencia_positiva')::boolean, 'el dictamen detecta la evidencia positiva');
  perform tests.ok(not (v_ev->>'listo_para_resolucion_negativa')::boolean, 'y bloquea la resolución negativa');
  perform tests.throws(format('select public.resolver_cfdi_inexistente(%L, %L, ''insisto'')', gen_random_uuid(), v_d),
    'FISCAL_EVIDENCIA_POSITIVA', 'ni Dirección puede declarar inexistente algo que apareció');

  -- VARIOS CANDIDATOS ⇒ revisión manual, nunca autocorrección.
  perform tests.sondeo(v_d, 'multiple');
  perform tests.eq((select count(*)::int from public.conciliar_cfdi() where check_id = 'C16_candidatos_multiples'), 1,
    'C16: varios candidatos se reportan para revisión manual');
  perform tests.eq((public.estado_fiscal_pedido(v_o)->>'requiere_revision_manual')::text, 'true',
    'el operador ve que hace falta revisión manual');
end $t$;
rollback;

-- ── VENTANA DE REENVÍO (72 h del SAT − 6 h de margen = 66 h) ────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_claim uuid; v_id jsonb;
begin
  perform tests.emisor('AAA010101AAA');
  perform tests.eq(public._w3_plazo_timbrado()::text, '72:00:00', 'el plazo legal del SAT es 72 h');
  perform tests.eq(public._w3_margen_replay()::text, '06:00:00', 'el margen de seguridad es 6 h');
  perform tests.eq(public._w3_ventana_replay()::text, '66:00:00', 'la ventana operativa de reenvío es 66 h');

  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.reclamar_id(v_d, 'produccion');
  select claim_id into v_claim from public.fiscal_documents where id = v_d;
  perform public.registrar_resultado_cfdi(gen_random_uuid(), v_d, v_claim, 'incierto',
    null, null, null, 'timeout', 'sin respuesta');

  v_id := public.identidad_cfdi(v_d);
  perform tests.ok((v_id->>'replay_permitido')::boolean, 'recién ocurrido, el reenvío es seguro');

  -- Dentro de la ventana (65 h) sigue permitido.
  perform tests.envejecer_date(v_d, interval '65 hours');
  perform tests.ok((public.identidad_cfdi(v_d)->>'replay_permitido')::boolean,
    'a 65 h el reenvío sigue dentro de la ventana segura');

  -- Pasado el margen (67 h) se bloquea, aunque el plazo legal de 72 h no haya vencido.
  perform tests.envejecer_date(v_d, interval '67 hours');
  perform tests.ok(not (public.identidad_cfdi(v_d)->>'replay_permitido')::boolean,
    'a 67 h el reenvío YA está bloqueado: el margen protege de la frontera legal');
  perform tests.ok(not (public.estado_fiscal_pedido(v_o)->>'replay_permitido')::boolean,
    'y el operador tampoco recibe permiso de reenviar');

  -- Pero la CONSULTA y la ADOPCIÓN siguen disponibles después de la ventana.
  perform tests.lives(format('select public.registrar_sondeo_cfdi(%L, %L, ''lookup_serie_folio'', ''vacio'')',
    gen_random_uuid(), v_d), 'la conciliación por consulta sigue permitida tras vencer la ventana');
  perform tests.eq(public.adoptar_cfdi(gen_random_uuid(), v_d,
      'D1D2C3D4-1111-2222-3333-444455556666', 'FAC-9', now(), 'Vigente')->>'fiscal_status', 'timbrado',
    'y la adopción de un comprobante existente también');
  perform tests.eq((select folio from public.fiscal_documents where id = v_d), '1',
    'sin generar folio nuevo para reemplazar la intención incierta');

  perform tests.eq((select count(*)::int from public.conciliar_cfdi() where check_id = 'C14_ventana_reenvio_vencida'), 0,
    'resuelta la intención, el aviso de ventana vencida desaparece');
end $t$;
rollback;

-- ── El resultado solo lo escribe el dueño del reclamo ───────────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid; v_claim uuid;
begin
  perform tests.emisor('AAA010101AAA');
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.reclamar_id(v_d, 'sandbox');
  select claim_id into v_claim from public.fiscal_documents where id = v_d;

  perform tests.throws(format('select public.registrar_resultado_cfdi(%L, %L, %L, ''timbrado'', %L)',
      gen_random_uuid(), v_d, gen_random_uuid(), 'E1E2C3D4-1111-2222-3333-444455556666'),
    'FISCAL_RECLAMO_AJENO', 'un intento con otro claim no puede escribir el resultado');
  perform tests.throws(format('select public.registrar_resultado_cfdi(%L, %L, %L, ''timbrado'', null)',
      gen_random_uuid(), v_d, v_claim),
    'FISCAL_TIMBRE_SIN_UUID', 'no se marca timbrado sin folio fiscal');
  perform tests.throws(format('select public.registrar_resultado_cfdi(%L, %L, %L, ''fallido'', null, null, null, null, ''x'')',
      gen_random_uuid(), v_d, v_claim),
    'FISCAL_MOTIVO_REQUERIDO', 'un fallo lleva su clasificación');
  perform tests.eq(public.registrar_resultado_cfdi(gen_random_uuid(), v_d, v_claim, 'timbrado',
      'F1F2C3D4-1111-2222-3333-444455556666', 'FAC-7', now())->>'fiscal_status', 'timbrado',
    'el dueño del reclamo sí registra el timbre');
  perform tests.throws(format('select public.registrar_resultado_cfdi(%L, %L, %L, ''fallido'', null, null, null, ''x'', ''y'')',
      gen_random_uuid(), v_d, v_claim),
    'FISCAL_SIN_RECLAMO_ACTIVO', 'ya resuelto, no se vuelve a escribir el resultado');
end $t$;
rollback;
