-- CX-0b · Integridad de la cuenta comercial del pedido.
--   A · crear_pedido: el doctor solo usa SU cuenta (derivada en el servidor; error genérico sin sondeo); el personal usa
--       cuentas activas con pareja comprador/cuenta coherente; el snapshot del cliente lo escribe solo el servidor.
--   B · customer_id, doctor_id y shipping_meta.customer inmutables para TODOS los actores y estados (incluye service_role,
--       app.trusted y el dueño de la BD); las actualizaciones legítimas siguen funcionando.
--   C · sin INSERT directo en orders para la API; crear_pedido / vender_pos siguen creando pedidos.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); v_bill uuid := tests.user('billing');
  v_wh uuid := tests.user('warehouse'); v_pack uuid := tests.user('packing'); v_drv uuid := tests.user('driver');
  v_a uuid := tests.user('doctor', 'doc-a@test.local'); v_b uuid := tests.user('doctor'); v_nov uuid := tests.user('doctor');
  v_sus uuid := tests.user('doctor'); v_sin uuid := tests.user('doctor');
  v_p uuid := tests.product(100); c_a uuid; c_b uuid; c_h uuid; c_off uuid; c_sus uuid;
  r jsonb; o uuid; e1 text; e2 text; e3 text; n int; st text; act text; m text; v_ok boolean; v_lot uuid;
  lineas jsonb;
begin
  lineas := jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2));
  perform tests.act_as_service();
  update public.profiles set verified = false where id = v_nov;
  insert into public.customers (full_name, email, phone, profile_id, source) values ('Cuenta A', 'a@test.local', '5550000001', v_a, 'portal') returning id into c_a;
  insert into public.customers (full_name, email, phone, profile_id, source) values ('Cuenta B', 'b@test.local', '5550000002', v_b, 'portal') returning id into c_b;
  insert into public.customers (full_name, email, phone, source) values ('Histórico sin portal', 'h@test.local', '5550000003', 'odoo') returning id into c_h;
  insert into public.customers (full_name, source, active) values ('Inactiva', 'odoo', false) returning id into c_off;
  insert into public.customers (full_name, profile_id, source) values ('Cuenta suspendida', v_sus, 'portal') returning id into c_sus;
  update public.profiles set active = false where id = v_sus;
  perform tests.act_as_owner();

  -- ══ A · CREACIÓN ══════════════════════════════════════════════════════════════════════════════
  perform tests.act_as(v_a);
  r := public.crear_pedido(gen_random_uuid(), null, v_a, lineas, null, false, c_a);
  o := (r ->> 'order_id')::uuid;
  perform tests.eq((select customer_id from public.orders where id = o), c_a, 'A1 · doctor verificado con SU cuenta: permitido');
  perform tests.eq((r ->> 'total')::numeric, 200::numeric, 'A1 · precio del servidor intacto (2 × 100)');
  perform tests.ok(r ? 'folio' and r ? 'items', 'A1 · contrato de respuesta intacto (folio, items)');
  r := public.crear_pedido(gen_random_uuid(), null, v_a, lineas);
  perform tests.eq((select customer_id from public.orders where id = (r ->> 'order_id')::uuid), c_a, 'A2 · sin p_customer_id: la cuenta se DERIVA en el servidor');
  r := public.crear_pedido(o, null, v_a, lineas, null, false, c_a);
  perform tests.ok((r ->> 'idempotent')::boolean, 'A3 · idempotencia por order_id intacta');

  -- falsificación del snapshot: el servidor lo reemplaza; el resto de shipping_meta se conserva (seller = CX-0c, sin tocar)
  r := public.crear_pedido(gen_random_uuid(), null, v_a, lineas, '{"customer":{"id":"x","name":"FALSO","phone":"000"},"seller":"pos@x.mx","notas":"n1"}', false, null);
  select shipping_meta into r from public.orders where id = (r ->> 'order_id')::uuid;
  perform tests.ok(r -> 'customer' ->> 'name' = 'Cuenta A' and r -> 'customer' ->> 'id' = c_a::text and r -> 'customer' ->> 'phone' = '5550000001', 'A4 · snapshot falso descartado: el servidor escribe el de SU cuenta');
  perform tests.ok(r ->> 'notas' = 'n1' and r ->> 'seller' = 'pos@x.mx', 'A4 · otras secciones de shipping_meta intactas (seller fuera de alcance, CX-0c)');
  perform tests.act_as(v_sin);
  r := public.crear_pedido(gen_random_uuid(), null, v_sin, lineas, '{"customer":{"name":"FALSO"}}', false, null);
  perform tests.ok((select customer_id is null and not (coalesce(shipping_meta, '{}') ? 'customer') from public.orders where id = (r ->> 'order_id')::uuid),
    'A5 · doctor sin cuenta ligada: pedido sin cuenta y SIN snapshot inventado');

  -- denegados (sin pedido) y sin sondeo: ajena / inexistente / inactiva → el MISMO mensaje
  perform tests.act_as(v_a);
  select count(*) into n from public.orders;
  begin perform public.crear_pedido(gen_random_uuid(), null, v_a, lineas, null, false, c_b); exception when others then e1 := sqlerrm; end;
  begin perform public.crear_pedido(gen_random_uuid(), null, v_a, lineas, null, false, gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  begin perform public.crear_pedido(gen_random_uuid(), null, v_a, lineas, null, false, c_off); exception when others then e3 := sqlerrm; end;
  perform tests.ok(e1 like 'CUENTA_NO_AUTORIZADA%', 'A6 · doctor con cuenta AJENA (RPC directa): denegado');
  perform tests.ok(e1 = e2 and e2 = e3, 'A7 · ajena = inexistente = inactiva: mismo mensaje (sin enumeración)');
  perform tests.ok(e1 !~* '(cuenta b|b@test|5550000002)', 'A7 · el error no revela datos de la cuenta ajena');
  perform tests.eq((select count(*) from public.orders)::int, n, 'A6/A7 · ningún pedido creado');
  perform tests.act_as(v_b);
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, %L, %L, null, false, %L)', v_a, lineas, c_a), 'No autorizado', 'A8 · doctor no puede comprar como otro doctor');
  perform tests.act_as(v_nov);
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, %L, %L)', v_nov, lineas), 'No autorizado', 'A9 · doctor NO verificado: denegado');
  perform tests.act_as(v_sus);
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, %L, %L, null, false, %L)', v_sus, lineas, c_sus), 'CUENTA_SUSPENDIDA', 'A10 · doctor suspendido: falla cerrado');

  -- personal: cuentas activas; pareja coherente
  perform tests.act_as(v_admin);
  r := public.crear_pedido(gen_random_uuid(), null, v_a, lineas, null, false, c_a);
  perform tests.eq((select customer_id from public.orders where id = (r ->> 'order_id')::uuid), c_a, 'A11 · Dirección: comprador A + SU cuenta');
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, %L, %L, null, false, %L)', v_a, lineas, c_b), 'PAR_INCONSISTENTE', 'A12 · Dirección: comprador A + cuenta de B → incompatible');
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, %L, %L, null, false, %L)', v_a, lineas, c_h), 'PAR_INCONSISTENTE', 'A13 · Dirección: comprador con cuenta + histórica ajena → incompatible');
  r := public.crear_pedido(gen_random_uuid(), null, v_sin, lineas, null, false, c_h);
  perform tests.eq((select customer_id from public.orders where id = (r ->> 'order_id')::uuid), c_h, 'A14 · Dirección: comprador SIN cuenta + histórica sin portal → permitido');
  r := public.crear_pedido(gen_random_uuid(), null, null, lineas, '{"customer":{"name":"FALSO"}}', false, c_h);
  perform tests.ok((select customer_id = c_h and doctor_id is null and shipping_meta -> 'customer' ->> 'name' = 'Histórico sin portal' from public.orders where id = (r ->> 'order_id')::uuid),
    'A15 · Dirección: cuenta histórica sin comprador digital (snapshot del servidor)');
  perform tests.act_as(v_pos);
  r := public.crear_pedido(gen_random_uuid(), null, null, lineas, null, false, c_b);
  perform tests.act_as_owner();   -- (pos no LEE pedidos ajenos a su venta: RLS)
  perform tests.eq((select customer_id from public.orders where id = (r ->> 'order_id')::uuid), c_b, 'A16 · POS: cuenta activa sin comprador');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, null, %L, null, false, %L)', lineas, c_off), 'CUSTOMER_INEXISTENTE', 'A17 · POS: cuenta inactiva → rechazada (como antes)');
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, %L, %L, null, false, %L)', v_b, lineas, c_a), 'PAR_INCONSISTENTE', 'A18 · POS: pareja incompatible');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, null, %L, null, false, %L)', lineas, c_h), 'No autorizado', 'A19 · almacén no crea pedidos');
  perform tests.act_as_owner();

  -- ══ B · INMUTABILIDAD: 8 actores × 7 estados × 8 mutaciones ═══════════════════════════════════
  foreach st in array array['pending_payment', 'paid', 'picking', 'packed', 'shipped', 'delivered', 'cancelled'] loop
    perform tests.act_as(v_admin);
    r := public.crear_pedido(gen_random_uuid(), null, v_a, lineas, '{"notas":"x"}', false, c_a);
    o := (r ->> 'order_id')::uuid;
    perform tests.act_as_owner();
    if st <> 'pending_payment' then perform tests.force_status(o, st); end if;
    foreach act in array array['doctor', 'admin', 'billing', 'warehouse', 'packing', 'service_role', 'app.trusted', 'bd_sin_jwt'] loop
      foreach m in array array[
        format('customer_id = %L', c_b), 'customer_id = null', format('doctor_id = %L', v_b), 'doctor_id = null',
        'shipping_meta = jsonb_set(shipping_meta, ''{customer}'', ''{"name":"OTRO"}'')', 'shipping_meta = shipping_meta - ''customer''',
        'shipping_meta = ''{"tracking":"T1"}''', 'shipping_meta = null'] loop
        case act
          when 'doctor' then perform tests.act_as(v_a);
          when 'admin' then perform tests.act_as(v_admin);
          when 'billing' then perform tests.act_as(v_bill);
          when 'warehouse' then perform tests.act_as(v_wh);
          when 'packing' then perform tests.act_as(v_pack);
          when 'service_role' then perform tests.act_as_service();
          when 'app.trusted' then perform tests.act_as_owner(); perform set_config('app.trusted', 'on', true);
          else perform tests.act_as_owner();
        end case;
        perform tests.throws(format('update public.orders set %s where id = %L', m, o), 'IDENTIDAD_PEDIDO_INMUTABLE', format('B · %s · %s · %s', st, act, left(m, 40)));
        perform set_config('app.trusted', 'off', true);
      end loop;
    end loop;
    perform tests.act_as_owner();
    perform tests.ok((select customer_id = c_a and doctor_id = v_a and shipping_meta -> 'customer' ->> 'name' = 'Cuenta A' from public.orders where id = o), 'B · ' || st || ' · identidad intacta tras todos los intentos');
    -- pos y chofer: RLS no les deja actualizar (0 filas, sin cambio)
    perform tests.act_as(v_pos); update public.orders set customer_id = c_b where id = o; get diagnostics n = row_count;
    perform tests.act_as(v_drv); update public.orders set customer_id = c_b where id = o; get diagnostics e1 = row_count;
    perform tests.act_as_owner();
    perform tests.ok(n = 0 and e1 = '0' and (select customer_id from public.orders where id = o) = c_a, 'B · ' || st || ' · pos/chofer: 0 filas, sin cambio');
  end loop;

  -- actualizaciones LEGÍTIMAS (no tocan la identidad) siguen funcionando
  perform tests.act_as(v_admin);
  r := public.crear_pedido(gen_random_uuid(), null, v_a, lineas, null, false, c_a); o := (r ->> 'order_id')::uuid;
  perform tests.lives(format('update public.orders set shipping_meta = shipping_meta || ''{"nota_interna":"ok"}'' where id = %L', o), 'B-ok · Dirección agrega otra sección de shipping_meta');
  perform tests.lives(format('update public.orders set customer_id = customer_id, doctor_id = doctor_id where id = %L', o), 'B-ok · reescribir el MISMO valor no es un cambio');
  perform tests.lives(format('select public.set_order_fiscal_snapshot(%L, %L)', o,
    '{"rfc":"EKU9003173C9","razon_social":"ESCUELA KEMPER URGATE","regimen":"601","cp":"42501","uso_cfdi":"G03","email_facturacion":"f@test.local"}'), 'B-ok · snapshot fiscal (set_order_fiscal_snapshot)');
  perform tests.act_as_service();
  perform tests.lives(format('update public.orders set status = ''paid'' where id = %L and status = ''pending_payment''', o), 'B-ok · webhook Stripe (service_role) cambia el estado');
  perform tests.lives(format('update public.orders set invoice_meta = coalesce(invoice_meta, ''{}'') || ''{"cancel":"x"}'' where id = %L', o), 'B-ok · cfdi-cancel (service_role) escribe invoice_meta');
  perform tests.act_as_owner();
  perform tests.force_status(o, 'packed');
  perform tests.act_as(v_wh);
  perform tests.lives(format('update public.orders set status = ''shipped'', shipping_meta = shipping_meta || ''{"tracking":"T-9","carrier":"dhl"}'' where id = %L', o), 'B-ok · despacho (markShipped: estado + merge de shipping_meta)');
  perform tests.act_as_owner();
  perform tests.ok((select status = 'shipped' and shipping_meta ->> 'tracking' = 'T-9' and shipping_meta -> 'customer' ->> 'name' = 'Cuenta A' from public.orders where id = o), 'B-ok · el despacho conserva el snapshot del cliente');
  -- cancelación por comando
  perform tests.act_as(v_admin);
  r := public.crear_pedido(gen_random_uuid(), null, v_a, lineas, null, false, c_a); o := (r ->> 'order_id')::uuid;
  perform tests.lives(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''prueba CX-0b'')', o), 'B-ok · cancelar_pedido (comando)');
  perform tests.act_as_owner();
  perform tests.ok((select status = 'cancelled' and customer_id = c_a from public.orders where id = o), 'B-ok · cancelado conserva su cuenta');
  -- efecto colateral documentado: borrar una cuenta con pedidos ya no los deja huérfanos
  perform tests.throws(format('delete from public.customers where id = %L', c_a), 'IDENTIDAD_PEDIDO_INMUTABLE', 'B-col · borrar una cuenta con pedidos falla (historial preservado)');
  -- el flujo REAL de baja (customersStore: active = false) sigue funcionando y conserva el historial
  perform tests.act_as(v_admin);
  perform tests.lives(format('update public.customers set active = false where id = %L', c_b), 'B-col · desactivar una cuenta con pedidos (flujo real de baja) funciona');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.orders where customer_id = c_b) > 0 and not (select active from public.customers where id = c_b), 'B-col · la cuenta desactivada conserva sus pedidos');

  -- C360 e historial leen la cuenta correcta; los avisos van a la cuenta del pedido
  perform tests.ok((select count(*) from public.orders where customer_id = c_b and doctor_id = v_a) = 0, 'B-hist · ningún pedido de A quedó en la cuenta de B');
  perform tests.ok(not exists (select 1 from public.comm_outbox where to_address = 'b@test.local' and profile_id = v_a), 'B-hist · ningún aviso de A salió al correo de B');

  -- ══ C · SIN INSERT DIRECTO ═══════════════════════════════════════════════════════════════════
  foreach act in array array['admin', 'pos', 'doctor'] loop
    case act when 'admin' then perform tests.act_as(v_admin); when 'pos' then perform tests.act_as(v_pos); else perform tests.act_as(v_a); end case;
    perform tests.throws(format('insert into public.orders (id, external_ref, customer_id, total, currency, status, payment_status, payment_method) values (gen_random_uuid(), %L, %L, 1, ''MXN'', ''delivered'', ''paid'', ''efectivo'')', 'X-' || act, c_b),
      'permission denied', 'C · ' || act || ' · INSERT directo (entregado + pagado, total 1) denegado');
    perform tests.throws(format('insert into public.orders (id, external_ref, doctor_id, customer_id, total, status) values (gen_random_uuid(), %L, %L, %L, 999, ''pending_payment'')', 'Y-' || act, v_a, c_a),
      'permission denied', 'C · ' || act || ' · INSERT directo pendiente (saltar precios) denegado');
  end loop;
  perform tests.act_as_anon();
  perform tests.throws('insert into public.orders (id, total) values (gen_random_uuid(), 1)', 'permission denied', 'C · anon · INSERT denegado');
  perform tests.act_as_owner();
  perform tests.ok(not has_table_privilege('authenticated', 'public.orders', 'INSERT') and not has_table_privilege('anon', 'public.orders', 'INSERT'), 'C · authenticated/anon sin privilegio INSERT');
  perform tests.ok(not exists (select 1 from pg_policy where polrelid = 'public.orders'::regclass and polcmd = 'a'), 'C · sin política INSERT');
  perform tests.ok(has_table_privilege('authenticated', 'public.orders', 'SELECT') and has_table_privilege('authenticated', 'public.orders', 'UPDATE'), 'C · SELECT/UPDATE de authenticated intactos');
  perform tests.ok((select relowner from pg_class where oid = 'public.orders'::regclass) = (select proowner from pg_proc where oid = 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)
               and (select proowner from pg_proc where oid = 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) = (select proowner from pg_proc where oid = 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure),
    'C · crear_pedido y vender_pos pertenecen al dueño de orders (no dependen del privilegio de authenticated)');
  perform tests.ok(has_table_privilege('service_role', 'public.orders', 'INSERT'), 'C · service_role conserva su acceso (servidor)');
  -- vender_pos (POS real) sigue creando pedidos
  v_lot := tests.stock(v_p, 'CX0B-L1', 5);
  perform tests.act_as(v_pos);
  v_ok := public.vender_pos(gen_random_uuid(), null, 1, 'efectivo', null, '{}',
            jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1, 'unit_price', 1, 'lot_id', null)),
            jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lot, 'qty', 1)), false, null, c_h);
  perform tests.ok(v_ok, 'C · vender_pos sigue vendiendo (POS) con cuenta histórica');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.orders where customer_id = c_h and status = 'delivered' and payment_status = 'paid') = 1, 'C · la venta POS quedó registrada por el comando');
end $t$;
rollback;
