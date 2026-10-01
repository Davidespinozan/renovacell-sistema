-- W3-A · LO QUE HACE IMPOSIBLE EL P0, POR ESTRUCTURA.
-- Estas pruebas NO pasan por los comandos: escriben directo contra la tabla (como dueño de
-- la base, saltándose la guarda) para demostrar que las constraints aguantan solas. Si algún
-- día un bug interno intentara marcar "timbrado" sin folio del SAT, la base lo rechaza.
begin;
do $t$
declare
  v_doctor uuid := tests.user('doctor'); v_p uuid := tests.product(100);
  v_o uuid; v_o2 uuid; v_f jsonb := tests.fiscal(); v_d uuid := gen_random_uuid();
  v_ins text;
begin
  perform tests.emisor('AAA010101AAA');
  v_o  := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  v_o2 := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as_owner();

  -- ── I-3 · TIMBRADO SIN UUID: rechazado ─────────────────────────────────────
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, serie, folio, issuer_rfc, provider_env, provider_date_sent)
      values (gen_random_uuid(), %L, 'timbrado', %L::jsonb, 'REN', '9001', 'AAA010101AAA', 'sandbox', '2026-10-01T10:00:00')$q$, v_o, v_f),
    'ck_fiscal_uuid_estado', 'no existe un documento timbrado sin UUID del SAT');

  -- ── I-3 · UUID EN UN ESTADO QUE NO LO ADMITE: rechazado ────────────────────
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, uuid, provider_env)
      values (gen_random_uuid(), %L, 'pendiente', %L::jsonb, 'AAAABBBB-1111-2222-3333-444455556666', 'sandbox')$q$, v_o, v_f),
    'ck_fiscal_uuid_estado', 'no hay UUID en un estado que no sea timbrado o cancelado');

  -- ── I-3 · UUID CON FORMA INVÁLIDA: rechazado ──────────────────────────────
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, uuid, provider_env, serie, folio, issuer_rfc, provider_date_sent)
      values (gen_random_uuid(), %L, 'timbrado', %L::jsonb, 'NO-ES-UN-UUID', 'sandbox', 'REN', '9002', 'AAA010101AAA', '2026-10-01T10:00:00')$q$, v_o, v_f),
    'ck_fiscal_uuid_formato', 'un folio fiscal sin forma de UUID se rechaza');
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, uuid, provider_env, serie, folio, issuer_rfc, provider_date_sent)
      values (gen_random_uuid(), %L, 'timbrado', %L::jsonb, '00000000-0000-0000-0000-000000000000', 'sandbox', 'REN', '9003', 'AAA010101AAA', '2026-10-01T10:00:00')$q$, v_o, v_f),
    'ck_fiscal_uuid_formato', 'un UUID de ceros no cuenta como folio del SAT');

  -- ── I-4 · UUID SIN ENTORNO: rechazado (un sandbox no puede pasar por real) ─
  -- Aquí el entorno DEBE faltar, así que también salta la constraint de identidad de
  -- W3-B. Se aceptan ambos nombres: las dos protegen exactamente lo mismo —que un
  -- comprobante de sandbox nunca pueda confundirse con uno real.
  perform tests.throws_any(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, uuid, serie, folio, issuer_rfc, provider_date_sent)
      values (gen_random_uuid(), %L, 'timbrado', %L::jsonb, 'AAAABBBB-1111-2222-3333-444455556666', 'REN', '9004', 'AAA010101AAA', '2026-10-01T10:00:00')$q$, v_o, v_f),
    array['ck_fiscal_env_presente', 'ck_fiscal_identidad_proveedor'],
    'un comprobante con folio siempre declara su entorno');

  -- ── I-5 · EN PROCESO SIN RECLAMO: rechazado ───────────────────────────────
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, serie, folio, issuer_rfc, provider_env, provider_date_sent)
      values (gen_random_uuid(), %L, 'en_proceso', %L::jsonb, 'REN', '9005', 'AAA010101AAA', 'sandbox', '2026-10-01T10:00:00')$q$, v_o, v_f),
    'ck_fiscal_claim', 'no hay "en proceso" sin un reclamo real detrás');
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, serie, folio, issuer_rfc, provider_env, provider_date_sent)
      values (gen_random_uuid(), %L, 'incierto', %L::jsonb, 'REN', '9006', 'AAA010101AAA', 'sandbox', '2026-10-01T10:00:00')$q$, v_o, v_f),
    'ck_fiscal_incierto', 'no se llega a incierto sin haber intentado');

  -- ── I-6 · RECEPTOR INCOMPLETO: rechazado ──────────────────────────────────
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver)
      values (gen_random_uuid(), %L, 'pendiente', '{"rfc":"XAXX010101000"}'::jsonb)$q$, v_o),
    'ck_fiscal_receptor_completo', 'no existe intención fiscal con receptor incompleto');

  -- ── Vocabulario y entorno cerrados ────────────────────────────────────────
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver)
      values (gen_random_uuid(), %L, 'inventado', %L::jsonb)$q$, v_o, v_f),
    'ck_fiscal_status', 'el vocabulario de estados está cerrado');
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, provider_env)
      values (gen_random_uuid(), %L, 'pendiente', %L::jsonb, 'staging')$q$, v_o, v_f),
    'ck_fiscal_provider_env', 'el entorno solo puede ser sandbox o produccion');

  -- ── I-1 · UN DOCUMENTO VIVO POR PEDIDO ────────────────────────────────────
  insert into public.fiscal_documents (id, order_id, status, receiver) values (v_d, v_o, 'pendiente', v_f);
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver)
      values (gen_random_uuid(), %L, 'pendiente', %L::jsonb)$q$, v_o, v_f),
    'uq_fiscal_doc_vivo', 'dos intenciones vivas para el mismo pedido: imposible');

  -- Un documento FALLIDO no ocupa la ranura.
  perform set_config('app.trusted', 'on', true);
  perform set_config('renovacell.w3_transicion', 'on', true);
  update public.fiscal_documents set status = 'fallido' where id = v_d;
  perform set_config('renovacell.w3_transicion', 'off', true);
  perform set_config('app.trusted', 'off', true);
  perform tests.lives(format($q$insert into public.fiscal_documents (id, order_id, status, receiver)
      values (gen_random_uuid(), %L, 'pendiente', %L::jsonb)$q$, v_o, v_f),
    'un fallido (sin efecto ante el PAC) libera la ranura del pedido');

  -- ── I-2 · UN UUID, UNA SOLA VEZ EN TODO EL SISTEMA ────────────────────────
  insert into public.fiscal_documents (id, order_id, status, receiver, uuid, provider_env, serie, folio, issuer_rfc, provider_date_sent)
  values (gen_random_uuid(), v_o2, 'timbrado', v_f, 'CCCCDDDD-1111-2222-3333-444455556666', 'produccion', 'REN', '9007', 'AAA010101AAA', '2026-10-01T10:00:00');
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, uuid, provider_env, serie, folio, issuer_rfc, provider_date_sent)
      values (gen_random_uuid(), %L, 'cancelado', %L::jsonb, 'CCCCDDDD-1111-2222-3333-444455556666', 'produccion', 'REN', '9008', 'AAA010101AAA', '2026-10-01T10:00:00')$q$,
      tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1))), v_f),
    'uq_fiscal_doc_uuid', 'el mismo folio del SAT no puede existir dos veces');

  -- ── I-7 · SERIE+FOLIO propios, únicos por entorno ─────────────────────────
  v_ins := format($q$insert into public.fiscal_documents (id, order_id, status, receiver, serie, folio)
      values (gen_random_uuid(), %L, 'pendiente', %L::jsonb, 'A', '1001')$q$,
      tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1))), v_f);
  perform tests.lives(v_ins, 'se puede asignar serie y folio propios');
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, serie, folio)
      values (gen_random_uuid(), %L, 'pendiente', %L::jsonb, 'A', '1001')$q$,
      tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1))), v_f),
    'uq_fiscal_doc_serie_folio', 'el folio propio no se repite: es la llave para buscar un huérfano en el PAC');
end $t$;
rollback;

-- ── La guarda protege la evidencia incluso dentro del contexto de comando ──────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);
  perform tests.timbrar(v_d, 'EEEEFFFF-1111-2222-3333-444455556666', 'produccion');
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);

  -- El folio del SAT no se reescribe ni dentro del contexto confiable.
  perform tests.throws(format($q$update public.fiscal_documents
      set uuid = '11112222-3333-4444-5555-666677778888' where id = %L$q$, v_d),
    'FISCAL_UUID_INMUTABLE', 'un folio fiscal ya registrado no se sobrescribe');
  perform tests.throws(format($q$update public.fiscal_documents set provider_env = 'sandbox' where id = %L$q$, v_d),
    'FISCAL_ENTORNO_INMUTABLE', 'el entorno de un comprobante timbrado no cambia');
  perform tests.throws(format($q$update public.fiscal_documents set receiver = %L::jsonb where id = %L$q$,
      tests.fiscal('ZZZ010101ZZ1'), v_d),
    'FISCAL_SOLICITUD_CONGELADA', 'lo que se pidió timbrar ya no se modifica después de salir');
  perform tests.throws(format($q$update public.fiscal_documents set order_id = %L where id = %L$q$,
      tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1))), v_d),
    'FISCAL_IDENTIDAD_INMUTABLE', 'una factura no cambia de pedido');
  perform set_config('app.trusted', 'off', true);
end $t$;
rollback;
