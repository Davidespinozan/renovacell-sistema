-- SEC-C4-FISCAL-3 (147) · crear_pedido_con_receptor: pedido + receptor fiscal inicial en UNA transacción.
-- (huellas de crear_pedido / vender_pos / precio re-ancladas por MAYOREO-REGLAS 20270222: precio con el pedido completo)
-- crear_pedido NO cambia (única implementación comercial). Con factura el receptor es obligatorio y válido ANTES de crear
-- nada; sin factura se ignora. Un pedido existente solo se confirma a QUIEN LO CREÓ y si la solicitud es la MISMA,
-- comparada contra el alta original; en cualquier otro caso, conflicto sin datos y sin escribir. Sin acceso nuevo.
begin;
create function pg_temp.huella() returns text language plpgsql as $f$
declare r record; n bigint; acc text := '';
begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1 loop
    execute format('select count(*) from public.%I', r.relname) into n; acc := acc || r.relname || ':' || n || ',';
  end loop;
  return md5(acc) || '|' || (select coalesce(md5(string_agg(id::text || ':' || coalesce(invoice_meta::text, '-') || ':' || invoice_requested || ':' || shipping_meta::text, ',' order by id)), '-') from public.orders);
end $f$;
create function pg_temp.cuentas() returns jsonb language plpgsql as $f$
declare r record; n bigint; acc jsonb := '{}';
begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1 loop
    execute format('select count(*) from public.%I', r.relname) into n; acc := acc || jsonb_build_object(r.relname, n);
  end loop; return acc;
end $f$;
create function pg_temp.boom() returns trigger language plpgsql as $f$ begin raise exception 'FALLO_INYECTADO: %', tg_argv[0]; end $f$;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); posA uuid := tests.user('pos', 'f3-posa@t.local'); posB uuid := tests.user('pos', 'f3-posb@t.local');
  posS uuid := tests.user('pos', 'f3-poss@t.local'); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse'); v_drv uuid := tests.user('driver');
  dA uuid := tests.user('doctor', 'f3-da@t.local'); dB uuid := tests.user('doctor', 'f3-db@t.local'); dNov uuid := tests.user('doctor', 'f3-dn@t.local');
  p uuid := tests.product(100); p2 uuid := tests.product(250); cH uuid; cH2 uuid; cA uuid; cB uuid; cOff uuid; cPerf uuid;
  rec jsonb := tests.fiscal('XAXX010101000'); rec2 jsonb := tests.fiscal('BBB010101BB2');
  env jsonb := '{"address":{"line1":"Calle 1","city":"Culiacán"}}'; lin jsonb; lin2 jsonb;
  o uuid; o2 uuid; r jsonb; r2 jsonb; h0 text; n int; caso record; f text; msg text; a jsonb; b jsonb; d jsonb; k text; dif1 text := ''; dif2 text := ''; perf0 text;
  SIG text := 'public.crear_pedido_con_receptor(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb)';
  CONF text := 'PEDIDO_EXISTENTE_CONFLICTO: ese identificador ya corresponde a otra solicitud de pedido';
begin
  -- nueva(id, folio, doctor, lineas, envio, factura, cuenta, receptor) → SQL
  f := 'select public.crear_pedido_con_receptor(%L::uuid, %L, %L::uuid, %L::jsonb, %L::jsonb, %L::boolean, %L::uuid, %L::jsonb)';
  lin := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2), jsonb_build_object('product_id', p2, 'qty', 1));
  lin2 := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1));
  perform tests.act_as_service();
  update public.profiles set verified = false where id = dNov;
  insert into public.customers (full_name, phone, source) values ('Cuenta Comercial F3', '6670001111', 'odoo') returning id into cH;
  insert into public.customers (full_name, source) values ('Otra Cuenta F3', 'odoo') returning id into cH2;
  insert into public.customers (full_name, source, profile_id) values ('Cuenta Doctor A', 'portal', dA) returning id into cA;
  insert into public.customers (full_name, source, profile_id) values ('Cuenta Doctor B', 'portal', dB) returning id into cB;
  insert into public.customers (full_name, source, active) values ('Inactiva F3', 'odoo', false) returning id into cOff;
  insert into public.customers (full_name, source) values ('Con Perfil F3', 'odoo') returning id into cPerf;
  perform tests.act_as_owner();
  perform tests.suspender(posS);
  perform tests.act_as(v_admin); perform public.cliente_fiscal_guardar(cPerf, null, tests.fiscal('PPP010101PP1') || '{"alias":"Permanente"}'::jsonb, true);
  perform tests.act_as_owner();

  -- ══ 0 · FORMA ══════════════════════════════════════════════════════════════════════════════
  perform tests.ok(md5(pg_get_functiondef(SIG::regprocedure)) = '5769c551e6ca60003ba0fcf9390d80d1', '0.1 · la función es la de la 147');
  perform tests.ok(md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) = '62039cc835b93f7c0119b1c54c774495'
               and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crear_pedido') = 1
               and md5(pg_get_functiondef('public.set_order_fiscal_snapshot(uuid,jsonb)'::regprocedure)) = 'd27eba9834466d71e5a3439614801bb7'
               and md5(pg_get_functiondef('public.solicitar_cfdi(uuid,uuid,jsonb)'::regprocedure)) = '4ee1daa01dd51d5187bc46fbc2397e3d'
               and md5(pg_get_functiondef('public._fiscal_entrada_error(jsonb)'::regprocedure)) = 'b651a11fd4cd94040473a1aa503986c0',
    '0.2 · crear_pedido (una sola firma), set_order_fiscal_snapshot, solicitar_cfdi y la validación de la 146 NO cambiaron');
  perform tests.ok((select prosecdef and proowner = 'postgres'::regrole and proconfig = array['search_path=public'] and pronargdefaults = 0 and pronargs = 8 from pg_proc where oid = SIG::regprocedure)
               and has_function_privilege('authenticated', SIG, 'execute') and not has_function_privilege('anon', SIG, 'execute'),
    '0.3 · SECURITY DEFINER, search_path fijo, 8 parámetros obligatorios; ejecutable por authenticated, no por anon');

  -- ══ A · CREACIÓN CON FACTURA ═══════════════════════════════════════════════════════════════
  o := gen_random_uuid(); perf0 := (select md5(coalesce(string_agg(c.meta::text, ',' order by c.id), '')) || ':' || (select count(*) from public.customer_fiscal_profiles) from public.customers c);
  perform tests.act_as(posA);
  execute format(f, o, 'F3-A1', null, lin, env, true, cH, rec || '{"rfc":"  xaxx010101000 ","email_facturacion":" Facturacion@Test.Local "}'::jsonb) into r;
  perform tests.act_as_owner();
  perform tests.ok((r ->> 'order_id')::uuid = o and (r ->> 'total')::numeric = 450 and jsonb_array_length(r -> 'items') = 2 and r ->> 'folio' = 'F3-A1' and not (r ? 'idempotent'),
    'A1 · Ventas crea el pedido con factura: misma respuesta que crear_pedido (pedido, folio, total del servidor, renglones)');
  perform tests.ok((select invoice_requested and invoice_meta = jsonb_build_object('receiver', rec) and status = 'pending_payment' and payment_status = 'pending' and customer_id = cH and doctor_id is null
                      and shipping_meta -> 'customer' ->> 'id' = cH::text and shipping_meta ->> 'placed_by' like '%(Ventas)' and shipping_meta ->> 'seller_origen' is not null
                      and shipping_meta -> 'address' ->> 'line1' = 'Calle 1' from public.orders where id = o),
    'A2 · el pedido nace con su receptor canónico y con cuenta, capturista, atribución y envío puestos por crear_pedido');
  perform tests.ok((select count(*) = 2 and sum(qty * unit_price) = 450 from public.order_items where order_id = o), 'A3 · renglones y precios del servidor');
  perform tests.ok(perf0 = (select md5(coalesce(string_agg(c.meta::text, ',' order by c.id), '')) || ':' || (select count(*) from public.customer_fiscal_profiles) from public.customers c)
               and not exists (select 1 from public.fiscal_documents where order_id = o),
    'A4 · no se toca el perfil fiscal permanente de ninguna cuenta ni se crea una solicitud de CFDI implícita');
  perform tests.ok((select count(*) filter (where action = 'INSERT orders') = 1 and count(*) filter (where action = 'UPDATE orders') = 1 and bool_and(actor = posA) and count(distinct created_at) = 1
                      from public.audit_logs where resource_type = 'orders' and resource_id = o::text), 'A5 · bitácora: un alta y un cambio, del mismo usuario y en la MISMA transacción');
  -- precios del cliente ignorados; vendedor/capturista enviados por el cliente descartados
  o2 := gen_random_uuid(); perform tests.act_as(posA);
  execute format(f, o2, 'F3-A6', null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1)), env || '{"seller":"otro@x.mx","placed_by":"Dirección","seller_profile_id":"11111111-1111-4111-8111-111111111111"}'::jsonb, true, cH, rec) into r;
  perform tests.act_as_owner();
  perform tests.ok((r ->> 'total')::numeric = 100 and (select shipping_meta ->> 'placed_by' like '%(Ventas)' and shipping_meta ->> 'seller' is distinct from 'otro@x.mx' from public.orders where id = o2),
    'A6 · precio, vendedor y capturista enviados por el cliente se ignoran (los decide crear_pedido)');
  -- Dirección y doctor verificado en su cuenta
  o2 := gen_random_uuid(); perform tests.act_as(v_admin); execute format(f, o2, 'F3-A7', null, lin2, env, true, cPerf, rec) into r; perform tests.act_as_owner();
  perform tests.ok((select invoice_meta -> 'receiver' ->> 'rfc' = 'XAXX010101000' and shipping_meta ->> 'placed_by' = 'Administración' from public.orders where id = o2), 'A7 · Dirección: receptor capturado (no el perfil permanente PPP… de la cuenta)');
  o2 := gen_random_uuid(); perform tests.act_as(dA); execute format(f, o2, null, dA, lin2, env, true, cA, rec) into r; perform tests.act_as_owner();
  perform tests.ok((select doctor_id = dA and customer_id = cA and invoice_meta = jsonb_build_object('receiver', rec) from public.orders where id = o2), 'A8 · doctor verificado, su cuenta');
  o2 := gen_random_uuid(); perform tests.act_as(dA); execute format(f, o2, null, dA, lin2, env, true, null, rec) into r; perform tests.act_as_owner();
  perform tests.ok((select customer_id = cA from public.orders where id = o2), 'A9 · doctor sin indicar cuenta: el servidor deriva la suya');

  -- ══ B · SIN FACTURA: el receptor se ignora ═════════════════════════════════════════════════
  for caso in select * from (values ('B1 · sin receptor', null::jsonb), ('B2 · receptor válido enviado', rec), ('B3 · receptor inválido enviado', '{"rfc":"MAL"}'::jsonb),
                                    ('B4 · estado timbrada enviado', rec || '{"status":"timbrada"}'::jsonb), ('B5 · basura', '[1,"x"]'::jsonb)) t(nombre, receptor) loop
    o2 := gen_random_uuid(); perform tests.act_as(posA); execute format(f, o2, null, null, lin2, env, false, cH, caso.receptor); perform tests.act_as_owner();
    perform tests.ok((select invoice_meta is null and not invoice_requested from public.orders where id = o2) and not exists (select 1 from public.fiscal_documents where order_id = o2), caso.nombre || ' → pedido sin datos fiscales ni solicitud');
  end loop;
  o2 := gen_random_uuid(); perform tests.act_as(posA); execute format(f, o2, null, null, lin2, env, null, cH, rec); perform tests.act_as_owner();
  perform tests.ok((select invoice_meta is null and not invoice_requested from public.orders where id = o2), 'B6 · factura NULL = sin factura');

  -- ══ C · RECEPTOR AUSENTE O INVÁLIDO: no se crea NADA ═══════════════════════════════════════
  h0 := pg_temp.huella(); perform tests.act_as(posA);
  for caso in select * from (values
      ('C01 · ausente (NULL)', null::jsonb, 'DATOS_FISCALES_REQUERIDOS'), ('C02 · JSON null', 'null'::jsonb, 'DATOS_FISCALES_REQUERIDOS'),
      ('C03 · vacío', '{}'::jsonb, 'FISCAL_INVALIDO: RFC requerido'), ('C04 · RFC inválido', rec || '{"rfc":"MAL"}', 'FISCAL_INVALIDO: RFC debe tener'),
      ('C05 · razón social vacía', rec || '{"razon_social":" "}', 'FISCAL_INVALIDO: Razón social requerida'), ('C06 · régimen mal formado', rec || '{"regimen":"6O1"}', 'FISCAL_INVALIDO: Régimen fiscal con formato'),
      ('C07 · CP inválido', rec || '{"cp":"800"}', 'FISCAL_INVALIDO: El CP debe tener 5'), ('C08 · uso CFDI inválido', rec || '{"uso_cfdi":"g03"}', 'FISCAL_INVALIDO: Uso de CFDI con formato'),
      ('C09 · correo inválido', rec || '{"email_facturacion":"x"}', 'FISCAL_INVALIDO: Correo de facturación no válido'), ('C10 · incompleto (sin correo)', rec - 'email_facturacion', 'FISCAL_INVALIDO: Correo de facturación requerido'),
      ('C11 · estado timbrada', rec || '{"status":"timbrada"}', 'FISCAL_INVALIDO: Campo no permitido'), ('C12 · UUID de documento', rec || '{"uuid":"x"}', 'FISCAL_INVALIDO: Campo no permitido'),
      ('C13 · fecha de timbrado', rec || '{"emitida_at":"2026-01-01"}', 'FISCAL_INVALIDO: Campo no permitido'), ('C14 · id de proveedor', rec || '{"facturama_id":"F1"}', 'FISCAL_INVALIDO: Campo no permitido'),
      ('C15 · clave desconocida', rec || '{"otra":"x"}', 'FISCAL_INVALIDO: Campo no permitido'), ('C16 · objeto anidado', rec || '{"razon_social":{"a":1}}', 'FISCAL_INVALIDO: El campo razon_social debe ser texto'),
      ('C17 · tipo incorrecto', rec || '{"cp":80000}', 'FISCAL_INVALIDO: El campo cp debe ser texto'), ('C18 · envuelto como en POS {receiver:…}', jsonb_build_object('receiver', rec), 'FISCAL_INVALIDO: Campo no permitido'),
      ('C19 · arreglo', jsonb_build_array(rec), 'FISCAL_INVALIDO: El receptor fiscal debe ser un objeto'), ('C20 · texto', '"XAXX010101000"'::jsonb, 'FISCAL_INVALIDO: El receptor fiscal debe ser un objeto'),
      ('C21 · 5,000 caracteres', rec || jsonb_build_object('razon_social', repeat('A', 5000)), 'FISCAL_INVALIDO: los datos de factura exceden'),
      ('C22 · salto de línea', rec || jsonb_build_object('razon_social', E'A\nB'), 'FISCAL_INVALIDO: El campo razon_social contiene caracteres')
    ) t(nombre, receptor, patron) loop
    perform tests.throws(format(f, gen_random_uuid(), null, null, lin, env, true, cH, caso.receptor), caso.patron, caso.nombre);
  end loop;
  perform tests.throws(format(f, gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'qty', 1)), env, true, cH, rec), 'no existe', 'C23 · receptor válido + producto inexistente (falla la creación comercial)');
  perform tests.throws(format(f, gen_random_uuid(), null, null, lin, env, true, cOff, rec), 'CUSTOMER_INEXISTENTE', 'C24 · receptor válido + cuenta inactiva');
  perform tests.throws(format(f, gen_random_uuid(), null, null, '[]'::jsonb, env, true, cH, rec), 'no tiene renglones', 'C25 · receptor válido + sin renglones');
  perform tests.throws(format(f, null, null, null, lin, env, true, cH, rec), 'PEDIDO_ID_REQUERIDO', 'C26 · sin identificador de pedido');
  perform tests.act_as_owner();
  perform tests.eq(pg_temp.huella(), h0, 'C27 · 26 solicitudes rechazadas no dejaron NADA (todas las tablas, incluida la bitácora)');

  -- ══ D · REINTENTOS SEGUROS ═════════════════════════════════════════════════════════════════
  h0 := pg_temp.huella(); perform tests.act_as(posA);
  execute format(f, o, 'F3-A1', null, lin, env, true, cH, rec) into r2;
  perform tests.ok(r2 = jsonb_build_object('order_id', o, 'total', 450, 'folio', 'F3-A1', 'idempotent', true), 'D01 · reintento idéntico del creador: éxito marcado como repetido, con SU folio y total');
  for caso in select * from (values
      ('D02 · renglones en otro orden', (select jsonb_agg(x order by x ->> 'qty') from jsonb_array_elements(lin) x), env, rec),
      ('D03 · precio enviado distinto (no es dato del servidor)', (select jsonb_agg(x || '{"unit_price":1}'::jsonb) from jsonb_array_elements(lin) x), env, rec),
      ('D04 · vendedor/capturista enviados por el cliente (se descartan)', lin, env || '{"seller":"x@y.z","placed_by":"otro"}'::jsonb, rec),
      ('D05 · receptor con espacios y mayúsculas distintas (misma forma canónica)', lin, env, rec || '{"rfc":" xaxx010101000 ","email_facturacion":"FACTURACION@test.local"}'::jsonb)
    ) t(nombre, lineas, envio, receptor) loop
    execute format(f, o, 'F3-A1', null, caso.lineas, caso.envio, true, cH, caso.receptor) into r2;
    perform tests.ok(coalesce((r2 ->> 'idempotent')::boolean, false), caso.nombre || ' → misma solicitud: éxito repetido');
  end loop;
  execute format(f, o, 'OTRO-FOLIO', null, lin, env, true, cH, rec) into r2;
  perform tests.ok(r2 ->> 'folio' = 'F3-A1', 'D06 · el folio no es contenido comercial (lo asigna el servidor): se confirma con el folio ORIGINAL');
  for caso in select * from (values
      ('D07 · otro receptor',            null::uuid, lin, env, true, cH, rec2),
      ('D08 · sin factura',              null, lin, env, false, cH, rec),
      ('D09 · otra cantidad',            null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 3), jsonb_build_object('product_id', p2, 'qty', 1)), env, true, cH, rec),
      ('D10 · otro producto',            null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2), jsonb_build_object('product_id', p, 'qty', 1)), env, true, cH, rec),
      ('D11 · un renglón de más',        null, lin || jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), env, true, cH, rec),
      ('D12 · un renglón de menos',      null, lin2, env, true, cH, rec),
      ('D13 · otro domicilio',           null, lin, '{"address":{"line1":"Calle 2","city":"Culiacán"}}'::jsonb, true, cH, rec),
      ('D14 · sin domicilio',            null, lin, null::jsonb, true, cH, rec),
      ('D15 · otra cuenta',              null, lin, env, true, cH2, rec),
      ('D16 · sin cuenta',               null, lin, env, true, null::uuid, rec),
      ('D17 · con otro comprador',       dB,   lin, env, true, cH, rec),
      ('D18 · envío no-objeto',          null, lin, '[1]'::jsonb, true, cH, rec)
    ) t(nombre, doctor, lineas, envio, factura, cuenta, receptor) loop
    begin
      execute format(f, o, 'F3-A1', caso.doctor, caso.lineas, caso.envio, caso.factura, caso.cuenta, caso.receptor);
      raise exception 'FAIL: % — no falló', caso.nombre;
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      perform tests.eq(sqlerrm, CONF, caso.nombre || ' → conflicto, con el MISMO mensaje genérico (sin folio, total ni datos)');
    end;
  end loop;
  -- Otro usuario, aun con la solicitud idéntica y conociendo el UUID
  for caso in select * from (values ('D19 · otro vendedor, solicitud idéntica', posB), ('D20 · Dirección, solicitud idéntica', v_admin)) t(nombre, quien) loop
    perform tests.act_as(caso.quien);
    begin execute format(f, o, 'F3-A1', null, lin, env, true, cH, rec); raise exception 'FAIL: % — no falló', caso.nombre;
    exception when others then if sqlerrm like 'FAIL:%' then raise; end if; perform tests.eq(sqlerrm, CONF, caso.nombre || ' → conflicto genérico: conocer el UUID no autoriza');
    end;
  end loop;
  perform tests.act_as(dB);
  begin execute format(f, o, null, dB, lin2, env, true, cB, rec); raise exception 'FAIL: D21 no falló';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; perform tests.eq(sqlerrm, CONF, 'D21 · un doctor con el UUID de un pedido ajeno y SU propia cuenta → conflicto genérico');
  end;
  perform tests.act_as(v_wh); perform tests.throws(format(f, o, 'F3-A1', null, lin, env, true, cH, rec), 'No autorizado', 'D22 · rol sin permiso: se rechaza por rol ANTES de saber si el pedido existe');
  perform tests.act_as_owner();
  perform tests.eq(pg_temp.huella(), h0, 'D23 · ningún reintento (propio, distinto o ajeno) escribió nada: sin duplicados ni sobrescrituras');
  perform tests.ok((select invoice_meta = jsonb_build_object('receiver', rec) from public.orders where id = o), 'D24 · el receptor original sigue intacto');
  -- Referencia: crear_pedido SÍ devuelve folio y total de un pedido ajeno (comportamiento histórico, no se toca aquí)
  perform tests.act_as(posB); r2 := public.crear_pedido(o, null, null, lin2, null, false, cH2); perform tests.act_as_owner();
  perform tests.ok(r2 ->> 'folio' = 'F3-A1' and (r2 ->> 'total')::numeric = 450, 'D25 · (referencia) crear_pedido sigue igual: expone folio y total por UUID — la función nueva no lo hereda');
  -- Cambios LEGÍTIMOS posteriores no producen falsos conflictos: se compara contra el alta ORIGINAL
  perform tests.act_as(v_bill); perform public.set_order_fiscal_snapshot(o, rec2);
  perform tests.act_as_owner(); perform set_config('app.trusted', 'on', true);
  update public.orders set shipping_meta = shipping_meta || '{"address":{"line1":"Corregida","city":"Culiacán"},"tracking":"X1"}'::jsonb where id = o;
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(posA); execute format(f, o, 'F3-A1', null, lin, env, true, cH, rec) into r2; perform tests.act_as_owner();
  perform tests.ok(coalesce((r2 ->> 'idempotent')::boolean, false) and (select invoice_meta -> 'receiver' ->> 'rfc' = 'BBB010101BB2' from public.orders where id = o),
    'D26 · tras una corrección legítima del receptor y del envío, el reintento ORIGINAL del creador sigue confirmándose y NO revierte la corrección');
  perform tests.act_as(posA); perform tests.throws(format(f, o, 'F3-A1', null, lin, env, true, cH, rec2), 'PEDIDO_EXISTENTE_CONFLICTO', 'D27 · y un reintento con el receptor corregido (que no fue el original) sigue siendo conflicto');
  -- Pedidos creados por el flujo ANTERIOR
  o2 := gen_random_uuid(); perform public.crear_pedido(o2, null, null, lin2, env, false, cH);
  execute format(f, o2, null, null, lin2, env, false, cH, null) into r2;
  perform tests.ok(coalesce((r2 ->> 'idempotent')::boolean, false), 'D28 · pedido SIN factura creado antes con crear_pedido por el mismo usuario: misma solicitud ⇒ se confirma');
  perform tests.throws(format(f, o2, null, null, lin2, env, true, cH, rec), 'PEDIDO_EXISTENTE_CONFLICTO', 'D29 · ese mismo pedido pidiendo ahora factura ⇒ conflicto (no se le añade receptor por esta vía)');
  -- D30 · (pedido creado en DOS llamadas por el flujo anterior ⇒ conflicto) necesita dos transacciones reales: se prueba
  --       por HTTP en contract/w1_postgrest_contract.mjs y con sesiones reales en concurrency/sec_c4f3_concurrency.sh.
  perform tests.act_as_owner();
  -- Doctor: reintento propio
  perform tests.act_as(dA); o2 := gen_random_uuid(); execute format(f, o2, null, dA, lin2, env, true, null, rec); execute format(f, o2, null, dA, lin2, env, true, cA, rec) into r2;
  perform tests.ok(coalesce((r2 ->> 'idempotent')::boolean, false), 'D31 · doctor: reintento propio (indicando o no su cuenta) se confirma');
  perform tests.throws(format(f, o2, null, dA, lin2, env, true, cB, rec), 'PEDIDO_EXISTENTE_CONFLICTO', 'D32 · doctor: reintento señalando la cuenta de OTRO ⇒ conflicto, sin datos');
  perform tests.act_as_owner();

  -- ══ E · AUTORIZACIÓN: no se amplía ═════════════════════════════════════════════════════════
  h0 := pg_temp.huella();
  perform tests.act_as(v_bill); perform tests.throws(format(f, gen_random_uuid(), null, null, lin2, env, true, cH, rec), 'No autorizado', 'E1 · Facturación: sin permiso nuevo');
  perform tests.act_as(v_wh);   perform tests.throws(format(f, gen_random_uuid(), null, null, lin2, env, true, cH, rec), 'No autorizado', 'E2 · Almacén');
  perform tests.act_as(v_drv);  perform tests.throws(format(f, gen_random_uuid(), null, null, lin2, env, true, cH, rec), 'No autorizado', 'E3 · Repartidor');
  perform tests.act_as(dNov);   perform tests.throws(format(f, gen_random_uuid(), null, dNov, lin2, env, true, null, rec), 'No autorizado', 'E4 · doctor no verificado');
  perform tests.act_as(dA);     perform tests.throws(format(f, gen_random_uuid(), null, dA, lin2, env, true, cB, rec), 'CUENTA_NO_AUTORIZADA', 'E5 · doctor con la cuenta de otro');
  perform tests.act_as(dA);     perform tests.throws(format(f, gen_random_uuid(), null, dA, lin2, env, true, cH, rec), 'CUENTA_NO_AUTORIZADA', 'E6 · doctor con una cuenta comercial ajena (mismo error genérico)');
  perform tests.act_as(dA);     perform tests.throws(format(f, gen_random_uuid(), null, dB, lin2, env, true, cB, rec), 'No autorizado', 'E7 · doctor haciéndose pasar por otro comprador');
  perform tests.act_as(posS);   perform tests.throws_any(format(f, gen_random_uuid(), null, null, lin2, env, true, cH, rec), array['CUENTA_SUSPENDIDA', 'No autorizado'], 'E8 · usuario suspendido');
  perform tests.act_as_service(); perform tests.throws(format(f, gen_random_uuid(), null, null, lin2, env, true, cH, rec), 'No autorizado', 'E9 · service_role: sin privilegio nuevo (igual que crear_pedido)');
  perform tests.act_as_anon();  perform tests.throws(format(f, gen_random_uuid(), null, null, lin2, env, true, cH, rec), 'permission denied', 'E10 · anónimo: sin EXECUTE');
  perform tests.act_as(posA);   perform tests.throws(format(f, gen_random_uuid(), null, dA, lin2, env, true, cB, rec), 'PAR_INCONSISTENTE', 'E11 · Ventas: comprador y cuenta que no corresponden (regla CX-0b de crear_pedido)');
  perform tests.act_as_owner();
  perform tests.eq(pg_temp.huella(), h0, 'E12 · ninguna de las denegaciones dejó efectos');

  -- ══ F · ATOMICIDAD ANTE FALLOS INYECTADOS ══════════════════════════════════════════════════
  h0 := pg_temp.huella();
  -- F1/F2 antes y durante la creación: cubiertos en C (receptor inválido; producto/cuenta inválidos).
  -- F3/F4 · después de crear el pedido, al guardar el receptor
  create trigger zz_f3_boom before update on public.orders for each row when (new.invoice_meta ? 'receiver') execute function pg_temp.boom('al guardar el receptor');
  perform tests.act_as(posA); perform tests.throws(format(f, gen_random_uuid(), null, null, lin2, env, true, cH, rec), 'FALLO_INYECTADO: al guardar el receptor', 'F3 · fallo después de crear el pedido y al guardar el receptor');
  perform tests.act_as_owner(); drop trigger zz_f3_boom on public.orders;
  perform tests.eq(pg_temp.huella(), h0, 'F4 · no quedó pedido "con factura y sin receptor": todo se revirtió');
  -- F5 · durante la bitácora del cambio (trigger de auditoría)
  create trigger zz_f3_boom before insert on public.audit_logs for each row when (new.action = 'UPDATE orders') execute function pg_temp.boom('en la bitácora del receptor');
  perform tests.act_as(posA); perform tests.throws(format(f, gen_random_uuid(), null, null, lin2, env, true, cH, rec), 'FALLO_INYECTADO: en la bitácora', 'F5 · fallo al escribir la bitácora del receptor');
  perform tests.act_as_owner(); drop trigger zz_f3_boom on public.audit_logs;
  perform tests.eq(pg_temp.huella(), h0, 'F6 · sin pedido, sin receptor huérfano y sin bitácora a medias');
  -- F7 · durante la bitácora del ALTA
  create trigger zz_f3_boom before insert on public.audit_logs for each row when (new.action = 'INSERT orders') execute function pg_temp.boom('en la bitácora del alta');
  perform tests.act_as(posA); perform tests.throws(format(f, gen_random_uuid(), null, null, lin2, env, true, cH, rec), 'FALLO_INYECTADO: en la bitácora del alta', 'F7 · fallo durante la creación (bitácora del alta)');
  perform tests.act_as_owner(); drop trigger zz_f3_boom on public.audit_logs;
  -- F8 · fallo DESPUÉS de que la función respondió, dentro de la misma transacción del cliente
  o2 := gen_random_uuid(); perform tests.act_as(posA);
  begin execute format(f, o2, null, null, lin2, env, true, cH, rec); raise exception 'FALLO_INYECTADO: antes de confirmar';
  exception when others then null; end;
  perform tests.act_as_owner();
  perform tests.ok(pg_temp.huella() = h0 and not exists (select 1 from public.orders where id = o2), 'F8 · fallo tras la respuesta y antes de confirmar: no queda nada');
  -- F9 · la entrada "Fiscal" de la bitácora de aplicación es de mejor esfuerzo (como en el resto del módulo): no bloquea
  create trigger zz_f3_boom before insert on public.audit_logs for each row when (new.resource_type = 'app' and new.action = 'Snapshot fiscal congelado') execute function pg_temp.boom('en la nota fiscal');
  o2 := gen_random_uuid(); perform tests.act_as(posA); execute format(f, o2, null, null, lin2, env, true, cH, rec);
  perform tests.act_as_owner(); drop trigger zz_f3_boom on public.audit_logs;
  perform tests.ok((select invoice_meta = jsonb_build_object('receiver', rec) from public.orders where id = o2), 'F9 · si falla solo la nota "Fiscal" de la bitácora de aplicación, el pedido y su receptor quedan completos (regla existente de _fiscal_audit)');
  -- F10 · sin la fila de bitácora del alta, el reintento falla cerrado
  o2 := gen_random_uuid(); perform tests.act_as(posA); execute format(f, o2, null, null, lin2, env, true, cH, rec); perform tests.act_as_owner();
  alter table public.audit_logs disable trigger trg_audit_logs_append_only; delete from public.audit_logs where resource_type = 'orders' and resource_id = o2::text and action = 'INSERT orders'; alter table public.audit_logs enable trigger trg_audit_logs_append_only;
  perform tests.act_as(posA); perform tests.throws(format(f, o2, null, null, lin2, env, true, cH, rec), 'PEDIDO_EXISTENTE_CONFLICTO', 'F10 · si no se puede demostrar quién creó el pedido, el reintento falla cerrado (conflicto)');
  perform tests.act_as_owner();

  -- ══ G · EQUIVALENCIA: dos llamadas (antes) vs una (ahora) ══════════════════════════════════
  a := pg_temp.cuentas(); o := gen_random_uuid(); o2 := gen_random_uuid();
  perform tests.act_as(posA); perform public.crear_pedido(o, 'F3-G1', null, lin, env, true, cH); perform public.set_order_fiscal_snapshot(o, rec);
  perform tests.act_as_owner(); b := pg_temp.cuentas();
  perform tests.act_as(posA); execute format(f, o2, 'F3-G2', null, lin, env, true, cH, rec);
  perform tests.act_as_owner(); d := pg_temp.cuentas();
  for k in select jsonb_object_keys(a) loop
    if (b ->> k)::int <> (a ->> k)::int then dif1 := dif1 || k || '+' || ((b ->> k)::int - (a ->> k)::int) || ' '; end if;
    if (d ->> k)::int <> (b ->> k)::int then dif2 := dif2 || k || '+' || ((d ->> k)::int - (b ->> k)::int) || ' '; end if;
  end loop;
  perform tests.eq(dif2, dif1, 'G1 · mismas filas nuevas en las mismas tablas (' || dif1 || ')');
  perform tests.ok((select (to_jsonb(x) - 'id' - 'external_ref' - 'created_at') = (to_jsonb(y) - 'id' - 'external_ref' - 'created_at') from public.orders x, public.orders y where x.id = o and y.id = o2),
    'G2 · el pedido es idéntico columna por columna (salvo id, folio y fecha): cuenta, total, estado, pago, factura, receptor, envío, vendedor y capturista');
  perform tests.ok((select array_agg(product_id::text || ':' || qty || ':' || unit_price order by product_id) from public.order_items where order_id = o)
                 = (select array_agg(product_id::text || ':' || qty || ':' || unit_price order by product_id) from public.order_items where order_id = o2), 'G3 · mismos renglones y precios');
  perform tests.ok((select array_agg(action order by action) from public.audit_logs where resource_type = 'orders' and resource_id = o::text)
                 = (select array_agg(action order by action) from public.audit_logs where resource_type = 'orders' and resource_id = o2::text)
               and (select count(*) from public.audit_logs where resource_type = 'app' and resource_id = 'order:' || o) = (select count(*) from public.audit_logs where resource_type = 'app' and resource_id = 'order:' || o2),
    'G4 · misma bitácora (alta, cambio y nota fiscal)');
  perform tests.ok((select count(distinct created_at) from public.audit_logs where resource_type = 'orders' and resource_id = o2::text) = 1, 'G5 · diferencia INTENCIONAL: en la función nueva alta y receptor comparten transacción');
  -- la solicitud de CFDI posterior usa el receptor inicial, igual en ambos
  perform tests.act_as(v_admin); r := public.solicitar_cfdi(gen_random_uuid(), o2, null); perform tests.act_as_owner();
  perform tests.ok((select receiver ->> 'rfc' from public.fiscal_documents where id = (r ->> 'doc_id')::uuid) = 'XAXX010101000', 'G6 · la solicitud de CFDI posterior toma el receptor inicial del pedido');

  -- ══ H · COMPATIBILIDAD DE crear_pedido ═════════════════════════════════════════════════════
  perform tests.act_as(posA);
  perform tests.throws(format('select public.crear_pedido(%L::uuid, null, null, %L::jsonb)', gen_random_uuid(), lin2), 'FALTA_IDENTIDAD', 'H1 · crear_pedido con 4 posicionales resuelve a la firma de siempre, sin ambigüedad');
  perform tests.throws(format('select public.crear_pedido(%L::uuid, null, null, %L::jsonb, %L::jsonb)', gen_random_uuid(), lin2, env), 'FALTA_IDENTIDAD', 'H2 · con 5 posicionales, igual');
  r := public.crear_pedido(gen_random_uuid(), null, null, lin2, null, false, cH);
  perform tests.ok((r ->> 'total')::numeric = 100 and not (r ? 'idempotent'), 'H3 · con 7 posicionales (como el checkout del doctor)');
  o := gen_random_uuid();
  r := public.crear_pedido(p_order_id => o, p_folio => null, p_doctor_id => null, p_lines => lin2, p_customer_id => cH);
  perform tests.ok((r ->> 'order_id')::uuid = o and not (r ? 'idempotent'), 'H4 · por nombre con opcionales omitidos (como Nuevo Pedido hoy)');
  r := public.crear_pedido(p_order_id => o, p_folio => null, p_doctor_id => null, p_lines => lin2, p_customer_id => cH);
  perform tests.ok(coalesce((r ->> 'idempotent')::boolean, false), 'H5 · su respuesta de repetido no cambió');
  perform tests.throws($q$select public.crear_pedido_con_receptor(p_order_id => gen_random_uuid(), p_folio => null, p_doctor_id => null, p_lines => '[]'::jsonb, p_receiver => '{}'::jsonb)$q$, 'does not exist', 'H6 · la función nueva exige su contrato completo (sin valores por defecto)');
  perform tests.throws(format('select public.crear_pedido_con_receptor(%L::uuid, null, null, %L::jsonb, %L::jsonb, true, %L::uuid)', gen_random_uuid(), lin2, env, cH), 'does not exist', 'H7 · y tampoco se alcanza con 7 posicionales');
  perform tests.act_as_owner();
  perform tests.eq(tests.conciliacion_errores(), 0, 'Z1 · inventario concilia');
  perform tests.eq(tests.fiscal_errores(), 0, 'Z2 · libro fiscal concilia');
end $t$;
rollback;
