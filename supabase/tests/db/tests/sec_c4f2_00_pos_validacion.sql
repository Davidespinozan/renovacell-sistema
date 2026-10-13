-- SEC-C4-FISCAL-2 (146) · El receptor fiscal de una venta POS lo valida y lo normaliza el SERVIDOR.
-- Con factura: solo {receiver:{6 campos de texto}}; cualquier otra clave (status, uuid, fechas…), tipo, tamaño o formato
-- inválido rechaza la venta ANTES de crear pedido, cobro, inventario, custodia u operación. Sin factura: lo recibido se
-- ignora y no se persiste. La idempotencia sigue sobre la ENTRADA recibida. Un receptor capturado e inválido ya no se
-- sustituye en silencio por el perfil del cliente al solicitar el CFDI. No cambia quién vende ni quién solicita.
begin;
create function pg_temp.huella() returns text language plpgsql as $f$
declare r record; n bigint; acc text := '';
begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1 loop
    execute format('select count(*) from public.%I', r.relname) into n; acc := acc || r.relname || ':' || n || ',';
  end loop;
  return md5(acc) || '|' || (select coalesce(md5(string_agg(id::text || ':' || quantity, ',' order by id)), '-') from public.lots)
                  || '|' || (select coalesce(sum(held_delta), 0) from public.custody_lines);
end $f$;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); posA uuid := tests.user('pos', 'f2-posa@t.local'); v_doc uuid := tests.user('doctor'); v_wh uuid := tests.user('warehouse');
  p uuid := tests.product(100); lot uuid; cC uuid; cP uuid; cus uuid; lines jsonb; allocs jsonb;
  rec jsonb := tests.fiscal('XAXX010101000'); recp jsonb := tests.fiscal('PPP010101PP1');
  o uuid; op uuid; h0 text; q0 int; caso record; sql text; im jsonb; n int; r jsonb; d uuid;
  SIG text := 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)';
begin
  -- ══ ESCENARIO ══════════════════════════════════════════════════════════════════════════════
  perform tests.act_as_service();
  insert into public.customers (full_name, source) values ('Cuenta Comercial F2', 'odoo') returning id into cC;      -- sin perfil fiscal
  insert into public.customers (full_name, source) values ('Cuenta Con Perfil F2', 'odoo') returning id into cP;     -- con perfil fiscal permanente
  perform tests.act_as_owner(); lot := tests.stock(p, 'F2-LOT', 60);
  perform tests.act_as(v_admin); perform public.cliente_fiscal_guardar(cP, null, recp || '{"alias":"Permanente"}'::jsonb, true);
  perform tests.act_as_owner();
  lines := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 100));
  allocs := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 1));
  create temp table _v (sql text) on commit drop;
  -- venta(op, solicita, meta, cliente, custodia) → texto SQL
  insert into _v values (format('select public.vender_pos(%%L::uuid, %%L, 100, ''efectivo'', null, ''{}''::jsonb, %L::jsonb, %L::jsonb, %%L::boolean, %%L::jsonb, %%L::uuid, null, %%L::uuid)', lines, allocs));
  select v.sql into sql from _v v;

  -- ══ 0 · FORMA: huellas, internas, sin cambios colaterales ══════════════════════════════════
  perform tests.ok(md5(pg_get_functiondef(SIG::regprocedure)) = '643cda22dcd76283ae8225ebb6afd188' and md5(pg_get_functiondef('public._w3_receptor(uuid,jsonb)'::regprocedure)) = 'bb7b1d1a51edd1cbf4e8427045fb0dcb',
    '0.1 · vender_pos y _w3_receptor son las de la 146');
  perform tests.ok(md5(pg_get_functiondef('public.set_order_fiscal_snapshot(uuid,jsonb)'::regprocedure)) = 'd27eba9834466d71e5a3439614801bb7'
               and md5(pg_get_functiondef('public.solicitar_cfdi(uuid,uuid,jsonb)'::regprocedure)) = '4ee1daa01dd51d5187bc46fbc2397e3d'
               and md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) = 'bee5aa3614e2b9e0327ebec6a1b38e2e'
               and md5(pg_get_functiondef('public._fiscal_error(jsonb)'::regprocedure)) = 'e8ff16dba9165213c6ad8d69f4a7d81f'
               and md5(pg_get_functiondef('public._fiscal_clean(jsonb)'::regprocedure)) = '1e8d88c21e6a1fd469ea101126c658f6',
    '0.2 · set_order_fiscal_snapshot, solicitar_cfdi, crear_pedido, _fiscal_error y _fiscal_clean NO cambiaron (FISCAL-1 y FISCAL-3 no se tocan)');
  perform tests.ok(not has_function_privilege('authenticated', 'public._fiscal_entrada_pos(boolean,jsonb)', 'execute') and not has_function_privilege('anon', 'public._fiscal_entrada_pos(boolean,jsonb)', 'execute')
               and not has_function_privilege('authenticated', 'public._fiscal_entrada_error(jsonb)', 'execute') and not has_function_privilege('anon', 'public._fiscal_entrada_error(jsonb)', 'execute')
               and not has_function_privilege('authenticated', 'public._w3_receptor(uuid,jsonb)', 'execute'),
    '0.3 · las funciones auxiliares son internas (sin EXECUTE para anon ni authenticated)');
  perform tests.act_as(posA);
  perform tests.throws($q$select public._fiscal_entrada_pos(true, '{}'::jsonb)$q$, 'permission denied', '0.4 · un vendedor no puede llamar la auxiliar directamente');
  perform tests.act_as_owner();

  -- ══ A · RECEPTOR VÁLIDO: se persiste SOLO la forma canónica ════════════════════════════════
  o := gen_random_uuid(); perform tests.act_as(posA);
  perform tests.ok((select public.vender_pos(o, 'F2-A1', 100, 'efectivo', null, '{}', lines, allocs, true,
     jsonb_build_object('receiver', jsonb_build_object('rfc', '  xaxx010101000 ', 'razon_social', '  Cliente de Prueba SA de CV  ', 'regimen', ' 601 ', 'cp', ' 80000 ', 'uso_cfdi', ' G03 ', 'email_facturacion', ' Facturacion@Test.Local ')), cC, null, null)),
    'A1 · Ventas vende con factura a una cuenta comercial');
  perform tests.act_as_owner();
  select invoice_meta into im from public.orders where id = o;
  perform tests.jsonb_igual(im, jsonb_build_object('receiver', rec), 'A2 · invoice_meta = {receiver} normalizado (RFC en mayúsculas, correo en minúsculas, sin espacios)');
  perform tests.ok((select invoice_requested and status = 'delivered' and payment_status = 'paid' and customer_id = cC from public.orders where id = o), 'A3 · la venta quedó solicitando factura, pagada y entregada');
  perform tests.ok((select array_agg(k order by k) from jsonb_object_keys(im) k) = array['receiver']
               and (select array_agg(k order by k) from jsonb_object_keys(im -> 'receiver') k) = array['cp', 'email_facturacion', 'razon_social', 'regimen', 'rfc', 'uso_cfdi'], 'A4 · sin claves fuera de la lista positiva');
  o := gen_random_uuid(); perform tests.act_as(v_admin);
  perform tests.ok((select public.vender_pos(o, 'F2-A5', 100, 'tarjeta', null, '{}', lines, allocs, true, jsonb_build_object('receiver', rec), null, null, null)), 'A5 · Dirección: mostrador con factura');
  perform tests.act_as_owner();
  perform tests.jsonb_igual((select invoice_meta from public.orders where id = o), jsonb_build_object('receiver', rec), 'A6 · mostrador con factura persiste el receptor canónico');
  o := gen_random_uuid(); perform tests.act_as(posA);
  perform tests.ok((select public.vender_pos(o, 'F2-A7', 100, 'efectivo', null, '{}', lines, allocs, true,
     jsonb_build_object('receiver', rec || jsonb_build_object('rfc', 'ÑAN&010101AB1', 'razon_social', 'Ñandú & Hijos, S.A. de C.V.', 'regimen', '626', 'uso_cfdi', 'CP01')), null, null, null)), 'A7 · Ñ, & y claves CP01/626 son válidos');
  perform tests.act_as_owner();

  -- ══ B/C · RECEPTOR INVÁLIDO Y ESTADOS FALSIFICADOS: se rechaza y no queda NADA ═════════════
  h0 := pg_temp.huella(); q0 := tests.qty(lot);
  perform tests.act_as(posA);
  for caso in select * from (values
      ('B01 · factura sin datos (NULL)',                 null::jsonb,                                                   'DATOS_FISCALES_REQUERIDOS'),
      ('B02 · factura con objeto vacío',                 '{}'::jsonb,                                                   'DATOS_FISCALES_REQUERIDOS'),
      ('B03 · receptor null',                            '{"receiver":null}'::jsonb,                                    'DATOS_FISCALES_REQUERIDOS'),
      ('B04 · receptor vacío',                           '{"receiver":{}}'::jsonb,                                      'FISCAL_INVALIDO: RFC requerido'),
      ('B05 · RFC vacío',                                jsonb_build_object('receiver', rec || '{"rfc":""}'),             'FISCAL_INVALIDO: RFC requerido'),
      ('B06 · RFC mal formado',                          jsonb_build_object('receiver', rec || '{"rfc":"MAL"}'),          'FISCAL_INVALIDO: RFC debe tener'),
      ('B07 · RFC con formato inválido',                 jsonb_build_object('receiver', rec || '{"rfc":"1234567890123"}'),'FISCAL_INVALIDO: Formato de RFC'),
      ('B08 · razón social vacía',                       jsonb_build_object('receiver', rec || '{"razon_social":"  "}'),  'FISCAL_INVALIDO: Razón social requerida'),
      ('B09 · régimen ausente',                          jsonb_build_object('receiver', rec - 'regimen'),                 'FISCAL_INVALIDO: Régimen fiscal requerido'),
      ('B10 · régimen con formato inválido',             jsonb_build_object('receiver', rec || '{"regimen":"6O1"}'),      'FISCAL_INVALIDO: Régimen fiscal con formato'),
      ('B11 · CP inválido',                              jsonb_build_object('receiver', rec || '{"cp":"8000"}'),          'FISCAL_INVALIDO: El CP debe tener 5'),
      ('B12 · uso de CFDI ausente',                      jsonb_build_object('receiver', rec - 'uso_cfdi'),                'FISCAL_INVALIDO: Uso de CFDI requerido'),
      ('B13 · uso de CFDI con formato inválido',         jsonb_build_object('receiver', rec || '{"uso_cfdi":"g03"}'),     'FISCAL_INVALIDO: Uso de CFDI con formato'),
      ('B14 · correo inválido',                          jsonb_build_object('receiver', rec || '{"email_facturacion":"no-es-correo"}'), 'FISCAL_INVALIDO: Correo de facturación no válido'),
      ('B15 · correo ausente',                           jsonb_build_object('receiver', rec - 'email_facturacion'),       'FISCAL_INVALIDO: Correo de facturación requerido'),
      ('B16 · campo null',                               jsonb_build_object('receiver', rec || '{"cp":null}'),            'FISCAL_INVALIDO: El campo cp debe ser texto'),
      ('B17 · número en lugar de texto',                 jsonb_build_object('receiver', rec || '{"cp":80000}'),           'FISCAL_INVALIDO: El campo cp debe ser texto'),
      ('B18 · booleano en lugar de texto',               jsonb_build_object('receiver', rec || '{"rfc":true}'),           'FISCAL_INVALIDO: El campo rfc debe ser texto'),
      ('B19 · estructura anidada',                       jsonb_build_object('receiver', rec || '{"razon_social":{"a":"b"}}'), 'FISCAL_INVALIDO: El campo razon_social debe ser texto'),
      ('B20 · arreglo como valor',                       jsonb_build_object('receiver', rec || '{"rfc":["XAXX010101000"]}'), 'FISCAL_INVALIDO: El campo rfc debe ser texto'),
      ('B21 · razón social de 301 caracteres',           jsonb_build_object('receiver', rec || jsonb_build_object('razon_social', repeat('A', 301))), 'FISCAL_INVALIDO: La razón social es demasiado larga'),
      ('B22 · campo de 5,000 caracteres',                jsonb_build_object('receiver', rec || jsonb_build_object('razon_social', repeat('A', 5000))), 'FISCAL_INVALIDO: los datos de factura exceden'),
      ('B23 · relleno de espacios (401)',                jsonb_build_object('receiver', rec || jsonb_build_object('cp', '80000' || repeat(' ', 396))), 'FISCAL_INVALIDO: El campo cp es demasiado largo'),
      ('B24 · salto de línea en la razón social',        jsonb_build_object('receiver', rec || jsonb_build_object('razon_social', E'Cliente\nSA')), 'FISCAL_INVALIDO: El campo razon_social contiene caracteres'),
      ('B25 · receptor como texto',                      '{"receiver":"XAXX010101000"}'::jsonb,                         'FISCAL_INVALIDO: El receptor fiscal debe ser un objeto'),
      ('B26 · receptor como arreglo',                    jsonb_build_object('receiver', jsonb_build_array(rec)),          'FISCAL_INVALIDO: El receptor fiscal debe ser un objeto'),
      ('B27 · datos de factura como arreglo',            jsonb_build_array(jsonb_build_object('receiver', rec)),          'FISCAL_INVALIDO: los datos de factura deben ser un objeto'),
      ('B28 · datos de factura como texto',              '"receiver"'::jsonb,                                           'FISCAL_INVALIDO: los datos de factura deben ser un objeto'),
      ('B29 · correo de 255 caracteres',                 jsonb_build_object('receiver', rec || jsonb_build_object('email_facturacion', repeat('a', 250) || '@b.mx')), 'FISCAL_INVALIDO: El correo de facturación es demasiado largo'),
      ('C01 · status timbrada inyectado',                jsonb_build_object('receiver', rec, 'status', 'timbrada'),       'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C02 · status emitida inyectado',                 jsonb_build_object('receiver', rec, 'status', 'emitida'),        'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C03 · estado solicitada inyectado',              jsonb_build_object('receiver', rec, 'estado', 'solicitada'),     'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C04 · UUID fiscal inventado',                    jsonb_build_object('receiver', rec, 'uuid', '11111111-2222-4333-8444-555555555555'), 'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C05 · fecha de timbrado inventada',              jsonb_build_object('receiver', rec, 'emitida_at', '2026-01-01T00:00:00Z'), 'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C06 · bloque interno fiscal inventado',          jsonb_build_object('receiver', rec, 'fiscal', jsonb_build_object('status', 'timbrado', 'doc_id', gen_random_uuid())), 'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C07 · facturama_id / simulated',                 jsonb_build_object('receiver', rec, 'facturama_id', 'X1', 'simulated', false), 'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C08 · solo status, sin receptor',                '{"status":"timbrada"}'::jsonb,                                'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C09 · clave Receiver (mayúscula) no es receiver','{"Receiver":{}}'::jsonb,                                      'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C10 · clave receptor (alias) no admitida',       jsonb_build_object('receptor', rec),                             'FISCAL_INVALIDO: los datos de factura solo admiten el receptor'),
      ('C11 · status DENTRO del receptor',               jsonb_build_object('receiver', rec || '{"status":"timbrada"}'),  'FISCAL_INVALIDO: Campo no permitido en el receptor'),
      ('C12 · uuid DENTRO del receptor',                 jsonb_build_object('receiver', rec || '{"uuid":"x"}'),           'FISCAL_INVALIDO: Campo no permitido en el receptor'),
      ('C13 · alias legacy (name/taxRegime) no admitido',jsonb_build_object('receiver', rec || '{"name":"X"}'),           'FISCAL_INVALIDO: Campo no permitido en el receptor'),
      ('C14 · clave desconocida',                        jsonb_build_object('receiver', rec, 'cualquier_cosa', 1),        'FISCAL_INVALIDO: los datos de factura solo admiten el receptor')
    ) as t(nombre, meta, patron) loop
    perform tests.throws(format(sql, gen_random_uuid(), 'F2-BAD', true, caso.meta, cC, null), caso.patron, caso.nombre);
  end loop;
  perform tests.act_as_owner();
  perform tests.eq(pg_temp.huella(), h0, 'E1 · 43 ventas rechazadas no dejaron NADA: ni pedido, ni cobro, ni inventario, ni custodia, ni comisión, ni operación (todas las tablas)');
  perform tests.eq(tests.qty(lot), q0, 'E2 · existencias del lote intactas');
  perform tests.eq(tests.conciliacion_errores(), 0, 'E3 · inventario concilia');

  -- ══ D · SIN FACTURA: lo recibido se ignora y no se persiste ════════════════════════════════
  perform tests.act_as(posA);
  for caso in select * from (values
      ('D1 · venta normal sin datos fiscales',           null::jsonb),
      ('D2 · receptor inválido recibido sin factura',    '{"receiver":{"rfc":"MAL"}}'::jsonb),
      ('D3 · receptor válido recibido sin factura',      jsonb_build_object('receiver', rec)),
      ('D4 · status timbrada recibido sin factura',      jsonb_build_object('receiver', rec, 'status', 'timbrada', 'uuid', 'x')),
      ('D5 · basura recibida sin factura',               '[1, "x", {"a": 1}]'::jsonb)
    ) as t(nombre, meta) loop
    o := gen_random_uuid();
    execute format(sql, o, 'F2-D' || left(o::text, 8), false, caso.meta, cC, null);
    perform tests.act_as_owner();
    perform tests.ok((select invoice_meta is null and invoice_requested = false and status = 'delivered' and payment_status = 'paid' from public.orders where id = o), caso.nombre || ' → vendida, invoice_meta NULL, sin solicitud de factura');
    perform tests.act_as(posA);
  end loop;
  o := gen_random_uuid(); execute format('select public.vender_pos(%L::uuid, ''F2-D6'', 100, ''efectivo'', null, ''{}''::jsonb, %L::jsonb, %L::jsonb)', o, lines, allocs);
  perform tests.act_as_owner();
  perform tests.ok((select invoice_meta is null and not invoice_requested from public.orders where id = o), 'D6 · llamada corta (sin parámetros fiscales): sin cambio');
  o := gen_random_uuid(); perform tests.act_as(posA);
  execute format('select public.vender_pos(%L::uuid, ''F2-D7'', 100, ''efectivo'', null, ''{}''::jsonb, %L::jsonb, %L::jsonb, null, %L::jsonb)', o, lines, allocs, jsonb_build_object('receiver', rec));
  perform tests.act_as_owner();
  perform tests.ok((select invoice_meta is null and not invoice_requested from public.orders where id = o), 'D7 · solicitud NULL = sin factura: la presencia de datos fiscales no infiere una solicitud');

  -- ══ E · ATOMICIDAD EN CUSTODIA ═════════════════════════════════════════════════════════════
  cus := tests.custodia('vendedor', posA); perform tests.entregar(cus, lot, 3);
  h0 := pg_temp.huella();
  perform tests.act_as(posA);
  perform tests.throws(format(sql, gen_random_uuid(), 'F2-CUS', true, jsonb_build_object('receiver', rec, 'status', 'timbrada'), null, cus), 'FISCAL_INVALIDO', 'E4 · venta desde custodia con estado falsificado: rechazada');
  perform tests.act_as_owner();
  perform tests.ok(pg_temp.huella() = h0 and tests.en_poder(cus, lot) = 3, 'E5 · la custodia no se consumió y nada cambió');
  o := gen_random_uuid(); perform tests.act_as(posA);
  execute format(sql, o, 'F2-CUS2', true, jsonb_build_object('receiver', rec), null, cus);
  perform tests.act_as_owner();
  perform tests.ok(tests.en_poder(cus, lot) = 2 and (select invoice_meta = jsonb_build_object('receiver', rec) from public.orders where id = o), 'E6 · con receptor válido la venta desde custodia sí procede');

  -- ══ F · IDEMPOTENCIA: la huella sigue sobre la ENTRADA recibida ════════════════════════════
  op := gen_random_uuid(); im := jsonb_build_object('receiver', rec);
  perform tests.act_as(posA); execute format(sql, op, 'F2-F', true, im, cC, null);
  perform tests.act_as_owner(); h0 := pg_temp.huella(); q0 := tests.qty(lot);
  perform tests.act_as(posA);
  execute format(sql, op, 'F2-F', true, im, cC, null);
  perform tests.act_as_owner();
  perform tests.ok(pg_temp.huella() = h0 and tests.qty(lot) = q0, 'F1 · misma operación y mismos datos: éxito idempotente, sin segunda venta ni segundo descuento');
  perform tests.act_as(posA);
  perform tests.throws(format(sql, op, 'F2-F', true, jsonb_build_object('receiver', rec || '{"rfc":"BBB010101BB2"}'), cC, null), 'OP_ID_REUTILIZADO', 'F2 · misma operación con OTRO receptor: rechazada (no se acepta en silencio)');
  perform tests.throws(format(sql, op, 'F2-F', false, im, cC, null), 'OP_ID_REUTILIZADO', 'F3 · misma operación cambiando la solicitud de factura: rechazada');
  perform tests.throws(format(sql, op, 'F2-F', true, jsonb_build_object('receiver', rec || '{"cp":" 80000 "}'), cC, null), 'OP_ID_REUTILIZADO', 'F4 · receptor que solo difiere en espacios: la normalización NO fusiona dos solicitudes distintas');
  perform tests.throws(format(sql, op, 'F2-F', true, jsonb_build_object('receiver', rec, 'status', 'timbrada'), cC, null), 'OP_ID_REUTILIZADO', 'F5 · misma operación añadiendo un estado: rechazada');
  perform tests.act_as_owner();
  perform tests.eq(pg_temp.huella(), h0, 'F6 · ninguno de los reintentos distintos dejó efectos');
  -- rechazo por receptor inválido y reintento corregido con el MISMO identificador
  op := gen_random_uuid(); perform tests.act_as(posA);
  perform tests.throws(format(sql, op, 'F2-G', true, jsonb_build_object('receiver', rec || '{"rfc":"MAL"}'), cC, null), 'FISCAL_INVALIDO', 'F7 · operación rechazada por receptor inválido');
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from public.inventory_operations where op_id = op) and not exists (select 1 from public.orders where id = op), 'F8 · la operación rechazada no quedó registrada (ni como aplicada ni como pedido)');
  perform tests.act_as(posA); execute format(sql, op, 'F2-G', true, im, cC, null);
  perform tests.act_as_owner();
  perform tests.ok((select invoice_meta = im from public.orders where id = op) and (select count(*) from public.orders where id = op) = 1, 'F9 · el reintento corregido con el mismo identificador se aplica UNA vez');

  -- ══ G · SOLICITUD DE CFDI: un receptor capturado e inválido no se sustituye ════════════════
  -- G1 · receptor capturado válido: se usa ese (no el perfil del cliente)
  o := gen_random_uuid(); perform tests.act_as(posA); execute format(sql, o, 'F2-G1', true, im, cP, null);
  perform tests.act_as(v_admin); r := public.solicitar_cfdi(gen_random_uuid(), o, null);
  perform tests.act_as_owner();
  perform tests.ok((select receiver ->> 'rfc' from public.fiscal_documents where id = (r ->> 'doc_id')::uuid) = 'XAXX010101000', 'G1 · con receptor capturado válido, la solicitud usa el capturado (no el perfil permanente)');
  -- G2 · sin receptor capturado: el perfil permanente sigue aplicando (flujo legítimo preservado)
  o := gen_random_uuid(); perform tests.act_as(posA); execute format(sql, o, 'F2-G2', false, null, cP, null);
  perform tests.act_as(v_admin); r := public.solicitar_cfdi(gen_random_uuid(), o, null);
  perform tests.act_as_owner();
  perform tests.ok((select receiver ->> 'rfc' from public.fiscal_documents where id = (r ->> 'doc_id')::uuid) = 'PPP010101PP1', 'G2 · sin receptor capturado, el perfil predeterminado del cliente sigue aplicando');
  -- G3 · receptor capturado INVÁLIDO (estado heredado, forzado como dueño): ya NO se sustituye
  o := gen_random_uuid(); perform tests.act_as(posA); execute format(sql, o, 'F2-G3', false, null, cP, null);
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  update public.orders set invoice_requested = true, invoice_meta = '{"receiver":{"rfc":"MAL","razon_social":"Capturado a mano"}}'::jsonb where id = o;
  perform set_config('app.trusted', 'off', true);
  n := (select count(*) from public.fiscal_documents);
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.solicitar_cfdi(%L, %L, null)', gen_random_uuid(), o), 'DATOS_FISCALES_REQUERIDOS', 'G3 · receptor capturado inválido + perfil permanente válido: la solicitud se RECHAZA (antes facturaba al perfil)');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.fiscal_documents) = n and public._w3_receptor(o, null) is null, 'G4 · no se creó documento fiscal; el receptor resuelto es NULL');
  -- G5 · la corrección legítima sigue disponible: receptor explícito válido
  perform tests.act_as(v_admin); r := public.solicitar_cfdi(gen_random_uuid(), o, rec);
  perform tests.act_as_owner();
  perform tests.ok((select receiver ->> 'rfc' from public.fiscal_documents where id = (r ->> 'doc_id')::uuid) = 'XAXX010101000', 'G5 · con un receptor explícito válido la solicitud procede');
  -- G6 · formas "sin captura": objeto vacío, valores en blanco o null → perfil permanente; formas no-objeto → NULL
  o := gen_random_uuid(); perform tests.act_as(posA); execute format(sql, o, 'F2-G6', false, null, cP, null);
  perform tests.act_as_owner();
  for caso in select * from (values ('{"receiver":{}}'::jsonb, 'PPP010101PP1'), ('{"receiver":null}'::jsonb, 'PPP010101PP1'), ('{"receiver":{"rfc":"  ","razon_social":""}}'::jsonb, 'PPP010101PP1'),
                                    ('{}'::jsonb, 'PPP010101PP1'), ('{"receiver":"texto"}'::jsonb, null), ('{"receiver":[1]}'::jsonb, null), ('{"receiver":{"otra":"x"}}'::jsonb, null)) as t(meta, esperado) loop
    perform set_config('app.trusted', 'on', true); update public.orders set invoice_meta = caso.meta where id = o; perform set_config('app.trusted', 'off', true);
    perform tests.ok((public._w3_receptor(o, null) ->> 'rfc') is not distinct from caso.esperado, format('G6 · %s → %s', caso.meta, coalesce(caso.esperado, 'NULL (no se sustituye)')));
  end loop;
  -- G7 · pedido de mostrador sin cliente y sin receptor: sigue sin poder facturarse (sin cambio)
  o := gen_random_uuid(); perform tests.act_as(posA); execute format(sql, o, 'F2-G7', false, null, null, null);
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.solicitar_cfdi(%L, %L, null)', gen_random_uuid(), o), 'DATOS_FISCALES_REQUERIDOS', 'G7 · mostrador sin receptor: DATOS_FISCALES_REQUERIDOS (como antes)');
  perform tests.act_as_owner();

  -- ══ H · AUTORIZACIÓN SIN CAMBIOS ═══════════════════════════════════════════════════════════
  perform tests.act_as(v_doc); perform tests.throws(format(sql, gen_random_uuid(), 'F2-H', true, im, null, null), 'No autorizado', 'H1 · doctor: sigue sin vender por POS');
  perform tests.act_as(v_wh);  perform tests.throws(format(sql, gen_random_uuid(), 'F2-H', true, im, null, null), 'No autorizado', 'H2 · almacén: sigue sin vender por POS');
  perform tests.act_as(v_wh);  perform tests.throws(format(sql, gen_random_uuid(), 'F2-H', true, '{"status":"timbrada"}', null, null), 'No autorizado', 'H3 · sin autorización el rechazo es por rol, antes de mirar los datos fiscales');
  perform tests.act_as_anon(); perform tests.throws(format(sql, gen_random_uuid(), 'F2-H', true, im, null, null), 'permission denied', 'H4 · anónimo: sin EXECUTE');
  perform tests.act_as_owner();
  perform tests.eq(tests.conciliacion_errores(), 0, 'Z1 · inventario concilia al final');
  perform tests.eq(tests.custodia_errores(), 0, 'Z2 · custodia concilia al final');
  perform tests.eq(tests.fiscal_errores(), 0, 'Z3 · libro fiscal concilia al final');
end $t$;
rollback;
