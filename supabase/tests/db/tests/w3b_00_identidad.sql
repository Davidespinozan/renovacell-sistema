-- W3-B · LA IDENTIDAD ANTE EL PROVEEDOR: se asigna una vez, antes del efecto externo,
-- y no se reasigna nunca. Facturama identifica una operación por (Folio, Date), así que
-- esos dos valores son la diferencia entre un reintento seguro y un CFDI duplicado.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(116); v_o uuid; v_o2 uuid; v_d uuid; v_d2 uuid; v_r jsonb; v_r2 jsonb;
  v_folio text; v_date text;
begin
  perform tests.emisor('AAA010101AAA', '80000');
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);

  -- ── Antes del reclamo NO hay identidad ─────────────────────────────────────
  perform tests.ok((select folio is null and provider_date_sent is null and issuer_rfc is null
                      from public.fiscal_documents where id = v_d),
    'una solicitud pendiente todavía no tiene identidad ante el proveedor');

  -- ── El reclamo la asigna completa ─────────────────────────────────────────
  v_r := tests.reclamar_id(v_d, 'sandbox');
  perform tests.eq(v_r->>'status', 'applied', 'el reclamo se aplica');
  perform tests.eq(v_r->>'serie', 'REN', 'la serie es REN (D-W3-7), no la elige el cliente');
  perform tests.eq(v_r->>'folio', '1', 'el primer folio del dominio es 1');
  perform tests.eq(v_r->>'issuer_rfc', 'AAA010101AAA', 'el RFC del emisor queda congelado');
  perform tests.eq(v_r->>'order_number', v_d::text, 'OrderNumber ES el id de la intención: estable por construcción');
  perform tests.ok((v_r->>'provider_date_sent') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$',
    'el Date se envía en el formato exacto que exige el proveedor');
  perform tests.ok((v_r->>'replay_vence_en')::timestamptz > now(),
    'el reenvío nace dentro de la ventana segura');
  perform tests.eq((select status from public.fiscal_documents where id = v_d), 'en_proceso',
    'la intención quedó en proceso');

  select folio, provider_date_sent into v_folio, v_date from public.fiscal_documents where id = v_d;

  -- ── CONGELADA: ni el contexto de comando puede reasignarla ────────────────
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  perform tests.throws(format('update public.fiscal_documents set folio = ''999'' where id = %L', v_d),
    'FISCAL_IDENTIDAD_PROVEEDOR_CONGELADA', 'el folio NO se reasigna');
  perform tests.throws(format('update public.fiscal_documents set provider_date_sent = ''2020-01-01T00:00:00'' where id = %L', v_d),
    'FISCAL_IDENTIDAD_PROVEEDOR_CONGELADA', 'el Date NO se recalcula');
  perform tests.throws(format('update public.fiscal_documents set serie = ''OTRA'' where id = %L', v_d),
    'FISCAL_IDENTIDAD_PROVEEDOR_CONGELADA', 'la serie NO cambia');
  perform tests.throws(format('update public.fiscal_documents set issuer_rfc = ''BBB010101BBB'' where id = %L', v_d),
    'FISCAL_IDENTIDAD_PROVEEDOR_CONGELADA', 'el RFC del emisor NO cambia');
  perform set_config('app.trusted', 'off', true);

  -- ── Tras un resultado INCIERTO, la identidad SOBREVIVE intacta ────────────
  perform tests.act_as(v_admin);
  perform public.registrar_resultado_cfdi(gen_random_uuid(), v_d,
    (select claim_id from public.fiscal_documents where id = v_d), 'incierto',
    null, null, null, 'timeout', 'el proveedor no respondió');
  perform tests.eq((select status from public.fiscal_documents where id = v_d), 'incierto',
    'un timeout deja la intención incierta');
  perform tests.eq((select folio from public.fiscal_documents where id = v_d), v_folio,
    'el folio se conserva tras el resultado desconocido');
  perform tests.eq((select provider_date_sent from public.fiscal_documents where id = v_d), v_date,
    'el Date se conserva BYTE-IDÉNTICO tras el resultado desconocido');

  -- ── Un incierto NO pasa por una nueva asignación ──────────────────────────
  perform tests.throws(format('select tests.reclamar_id(%L, ''sandbox'')', v_d),
    'CFDI_INCIERTO', 'una intención incierta no se vuelve a reclamar ni recibe otro folio');
  perform tests.eq((select count(distinct folio)::int from public.fiscal_documents where id = v_d), 1,
    'sigue habiendo un solo folio para esa intención');

  -- ── Una intención NUEVA recibe un folio NUEVO ─────────────────────────────
  v_o2 := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d2 := tests.solicitud(v_o2);
  v_r2 := tests.reclamar_id(v_d2, 'sandbox');
  perform tests.eq(v_r2->>'folio', '2', 'la siguiente intención toma el folio siguiente, sin reciclar');
  perform tests.ok((v_r2->>'folio') <> v_folio, 'nunca se reutiliza un folio para otra intención');
end $t$;
rollback;

-- ── Unicidad en el ÁMBITO DEL PROVEEDOR: la serie NO participa ──────────────────────────
-- La deduplicación de Facturama es (Folio, Date) y no mira la serie: modelar la unicidad
-- solo por (serie, folio) permitiría una colisión real ante el PAC.
begin;
do $t$
declare
  v_doctor uuid := tests.user('doctor'); v_p uuid := tests.product(100);
  v_f jsonb := tests.fiscal(); v_o1 uuid; v_o2 uuid;
begin
  perform tests.emisor('AAA010101AAA');
  v_o1 := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  v_o2 := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as_owner();

  insert into public.fiscal_documents (id, order_id, status, receiver, serie, folio, issuer_rfc,
                                       provider_env, provider_date_sent)
  values (gen_random_uuid(), v_o1, 'pendiente', v_f, 'REN', '77', 'AAA010101AAA', 'produccion', '2026-10-01T10:00:00');

  -- Mismo folio, OTRA serie, mismo emisor y entorno ⇒ debe rechazarse.
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, serie, folio,
        issuer_rfc, provider_env, provider_date_sent)
      values (gen_random_uuid(), %L, 'pendiente', %L::jsonb, 'OTRA', '77', 'AAA010101AAA', 'produccion', '2026-10-01T11:00:00')$q$,
      v_o2, v_f),
    'uq_fiscal_folio_proveedor',
    'una SEGUNDA serie no puede reutilizar un folio del mismo emisor y entorno');

  -- Mismo folio en OTRO entorno sí se permite: es otra identidad ante el proveedor.
  perform tests.lives(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, serie, folio,
        issuer_rfc, provider_env, provider_date_sent)
      values (gen_random_uuid(), %L, 'pendiente', %L::jsonb, 'REN', '77', 'AAA010101AAA', 'sandbox', '2026-10-01T11:00:00')$q$,
      v_o2, v_f),
    'el mismo folio en sandbox no choca con el de producción: son identidades distintas');
end $t$;
rollback;

-- ── Formato y precondiciones ────────────────────────────────────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid := tests.product(100); v_o uuid; v_d uuid;
begin
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_d := tests.solicitud(v_o);

  -- Sin RFC del emisor NO se numera nada: numerar sería comprometerse ante el SAT.
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  update public.company_settings set rfc = null where id = 'default';
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.throws(format('select tests.reclamar_id(%L, ''sandbox'')', v_d),
    'EMISOR_SIN_RFC', 'sin RFC del emisor no se asigna identidad fiscal');
  perform tests.eq((select folio from public.fiscal_documents where id = v_d), null,
    'y el folio no quedó consumido');

  -- Entorno obligatorio y explícito.
  perform tests.emisor('AAA010101AAA');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select tests.reclamar_id(%L, ''staging'')', v_d),
    'ENTORNO_FISCAL_INVALIDO', 'el entorno fiscal no admite valores inventados');

  -- Formato del Date, por constraint.
  perform tests.act_as_owner();
  perform tests.throws(format($q$insert into public.fiscal_documents (id, order_id, status, receiver, provider_date_sent)
      values (gen_random_uuid(), %L, 'pendiente', %L::jsonb, '01/10/2026 10:00')$q$, v_o, tests.fiscal()),
    'ck_fiscal_date_formato', 'el Date solo se guarda en el formato exacto que viaja al PAC');

  -- La serie respeta el Anexo 20 (1 a 25 alfanuméricos).
  perform set_config('app.trusted', 'on', true);
  perform tests.throws($q$insert into public.fiscal_series (serie) values ('ren-minuscula')$q$,
    'ck_fiscal_serie_formato', 'la serie respeta el formato del Anexo 20');
  perform set_config('app.trusted', 'off', true);
end $t$;
rollback;
