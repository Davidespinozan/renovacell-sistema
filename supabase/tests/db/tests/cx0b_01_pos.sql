-- CX-0b · vender_pos (mostrador): comprador OPCIONAL. Sin comprador = mostrador o cuenta histórica (como hoy).
-- Con comprador: perfil doctor y pareja coherente con la cuenta. Precio, inventario, caja, folio, snapshot e
-- idempotencia intactos; un rechazo no deja pedido, existencias, kardex, asiento ni operación.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse');
  v_a uuid := tests.user('doctor'); v_b uuid := tests.user('doctor'); v_sin uuid := tests.user('doctor');
  v_p uuid := tests.product(100); c_a uuid; c_b uuid; c_h uuid; c_off uuid; v_lot uuid; v_o uuid; v_ok boolean;
  lineas jsonb; alloc jsonb; antes text; despues text; e text;
  -- (order_id, folio, doctor, shipping_meta, customer, efectivo)
  tmpl constant text := 'select public.vender_pos(%L, %L, 1, ''efectivo'', %L, %L::jsonb, %L::jsonb, %L::jsonb, false, null, %L, %L)';
begin
  perform tests.act_as_service();
  insert into public.customers (full_name, email, phone, profile_id, source) values ('Cuenta A', 'a@test.local', '5551110001', v_a, 'portal') returning id into c_a;
  insert into public.customers (full_name, email, phone, profile_id, source) values ('Cuenta B', 'b@test.local', '5551110002', v_b, 'portal') returning id into c_b;
  insert into public.customers (full_name, phone, source) values ('Histórico sin portal', '5551110003', 'odoo') returning id into c_h;
  insert into public.customers (full_name, source, active) values ('Inactiva', 'odoo', false) returning id into c_off;
  perform tests.act_as_owner();
  v_lot := tests.stock(v_p, 'CX0B-POS', 40);
  lineas := jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2, 'unit_price', 1));
  alloc := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lot, 'qty', 2));

  -- ══ POSITIVOS ══════════════════════════════════════════════════════════════════════════════════
  -- 1/6/8/9/10/11/12/13 · POS, cuenta válida sin comprador
  perform tests.act_as(v_pos);
  v_o := gen_random_uuid();
  execute format(tmpl, v_o, 'P-CX0B-1', null, '{"channel":"pos","seller":"cajero@x.mx","customer":{"id":"x","name":"FALSO"}}', lineas, alloc, c_h, 500) into v_ok;
  perform tests.ok(v_ok, 'P1 · POS: cuenta histórica sin comprador → vende (respuesta true, contrato intacto)');
  perform tests.act_as_owner();
  perform tests.ok((select external_ref = 'P-CX0B-1' and customer_id = c_h and doctor_id is null and status = 'delivered' and payment_status = 'paid' and total = 200
                    from public.orders where id = v_o), 'P1 · folio del cajero, cuenta, entregado/pagado y precio del SERVIDOR (2 × 100, no el del cliente)');
  perform tests.ok((select shipping_meta -> 'customer' ->> 'name' = 'Histórico sin portal' and shipping_meta -> 'customer' ->> 'id' = c_h::text
                       and shipping_meta ->> 'seller' = (select email from public.profiles where id = v_pos) and shipping_meta ->> 'seller_origen' = 'pos_cajero'
                       and shipping_meta ->> 'channel' = 'pos' from public.orders where id = v_o),
    'P1 · snapshot del cliente del servidor (el falso se descarta); canal intacto; vendedor = cajero AUTENTICADO, no el que manda la caja (CX-0c)');
  perform tests.eq(tests.qty(v_lot), 38, 'P1 · inventario: el lote bajó 2');
  perform tests.ok(tests.kardex_ok(v_lot) and exists (select 1 from public.inventory_movements where order_id = v_o and change = -2 and reason = 'venta'), 'P1 · kardex: salida de venta registrada');
  perform tests.ok((select count(*) = 1 and sum(amount) = 200 and min(method) = 'efectivo' and min(direction) = 'in' from public.payment_entries where order_id = v_o),
    'P1 · caja: UN asiento de entrada por el total (efectivo)');
  perform tests.ok((select bool_or(coalesce(evidence_ref, '') = 'recibido=500;cambio=300') from public.payment_entries where order_id = v_o), 'P1 · caja: efectivo recibido como evidencia');
  -- 13 · idempotencia: el mismo order_id/contenido = éxito sin duplicar
  perform tests.act_as(v_pos);
  execute format(tmpl, v_o, 'P-CX0B-1', null, '{"channel":"pos","seller":"cajero@x.mx","customer":{"id":"x","name":"FALSO"}}', lineas, alloc, c_h, 500) into v_ok;
  perform tests.act_as_owner();
  perform tests.ok(v_ok and (select count(*) from public.payment_entries where order_id = v_o) = 1 and tests.qty(v_lot) = 38, 'P13 · reintento idempotente: sin doble cobro ni doble salida');

  -- 2 · comprador vinculado correctamente (A + su cuenta), por Dirección (7)
  perform tests.act_as(v_admin);
  v_o := gen_random_uuid();
  execute format(tmpl, v_o, 'P-CX0B-2', v_a, '{}', lineas, alloc, c_a, null) into v_ok;
  perform tests.act_as_owner();
  perform tests.ok(v_ok and (select doctor_id = v_a and customer_id = c_a and shipping_meta -> 'customer' ->> 'name' = 'Cuenta A' from public.orders where id = v_o),
    'P2/P7 · Dirección: comprador A con SU cuenta');
  -- 3 · comprador SIN cuenta ligada + cuenta histórica sin portal
  perform tests.act_as(v_pos);
  v_o := gen_random_uuid();
  execute format(tmpl, v_o, 'P-CX0B-3', v_sin, '{}', lineas, alloc, c_h, null) into v_ok;
  perform tests.act_as_owner();
  perform tests.ok(v_ok and (select doctor_id = v_sin and customer_id = c_h from public.orders where id = v_o), 'P3 · comprador sin cuenta ligada + histórica sin portal');
  -- 4/5 · mostrador sin cuenta ni comprador (doctor NULL)
  perform tests.act_as(v_pos);
  v_o := gen_random_uuid();
  execute format(tmpl, v_o, 'P-CX0B-4', null, '{"channel":"pos","customer":{"id":"x","name":"Inventado"}}', lineas, alloc, null, null) into v_ok;
  perform tests.act_as_owner();
  perform tests.ok(v_ok and (select doctor_id is null and customer_id is null and not (shipping_meta ? 'customer') from public.orders where id = v_o),
    'P4/P5 · mostrador anónimo: sin cuenta, sin comprador y sin snapshot inventado');
  -- comprador A sin cuenta en la venta (no es incoherente: solo falta la cuenta, como en crear_pedido del personal)
  perform tests.act_as(v_pos);
  v_o := gen_random_uuid();
  execute format(tmpl, v_o, 'P-CX0B-5', v_a, '{}', lineas, alloc, null, null) into v_ok;
  perform tests.act_as_owner();
  perform tests.ok(v_ok and (select doctor_id = v_a and customer_id is null from public.orders where id = v_o), 'P5b · comprador A sin cuenta en la venta: permitido (sin derivar, como hoy)');

  -- ══ NEGATIVOS (sin residuos) ═══════════════════════════════════════════════════════════════════
  select format('%s|%s|%s|%s|%s', (select count(*) from public.orders), tests.qty(v_lot), (select count(*) from public.inventory_movements),
                (select count(*) from public.payment_entries), (select count(*) from public.inventory_operations)) into antes;
  perform tests.act_as(v_pos);
  perform tests.throws(format(tmpl, gen_random_uuid(), 'N-1', v_a, '{}', lineas, alloc, c_b, null), 'PAR_INCONSISTENTE', 'N1 · comprador A + cuenta de B → rechazado');
  perform tests.throws(format(tmpl, gen_random_uuid(), 'N-2', v_a, '{}', lineas, alloc, c_h, null), 'PAR_INCONSISTENTE', 'N1b · comprador con cuenta + histórica ajena → rechazado');
  perform tests.throws(format(tmpl, gen_random_uuid(), 'N-3', gen_random_uuid(), '{}', lineas, alloc, c_h, null), 'COMPRADOR_INVALIDO', 'N2 · comprador inexistente → rechazado');
  perform tests.throws(format(tmpl, gen_random_uuid(), 'N-4', v_wh, '{}', lineas, alloc, null, null), 'COMPRADOR_INVALIDO', 'N7 · identidad ajena (perfil de almacén como comprador) → rechazado');
  perform tests.throws(format(tmpl, gen_random_uuid(), 'N-5', null, '{}', lineas, alloc, gen_random_uuid(), null), 'CUSTOMER_INEXISTENTE', 'N3 · cuenta inexistente → rechazada');
  perform tests.throws(format(tmpl, gen_random_uuid(), 'N-6', null, '{}', lineas, alloc, c_off, null), 'CUSTOMER_INEXISTENTE', 'N4 · cuenta inactiva → rechazada (como antes)');
  perform tests.act_as(v_admin);
  perform tests.throws(format(tmpl, gen_random_uuid(), 'N-7', v_b, '{}', lineas, alloc, c_a, null), 'PAR_INCONSISTENTE', 'N8 · Dirección tampoco crea identidad incoherente');
  perform tests.act_as(v_a);
  perform tests.throws(format(tmpl, gen_random_uuid(), 'N-8', v_a, '{}', lineas, alloc, c_a, null), 'No autorizado', 'N5 · RPC directa por un doctor → no autorizado');
  perform tests.act_as(v_wh);
  perform tests.throws(format(tmpl, gen_random_uuid(), 'N-9', null, '{}', lineas, alloc, c_h, null), 'No autorizado', 'N5b · almacén no vende en POS');
  perform tests.act_as_owner();
  select format('%s|%s|%s|%s|%s', (select count(*) from public.orders), tests.qty(v_lot), (select count(*) from public.inventory_movements),
                (select count(*) from public.payment_entries), (select count(*) from public.inventory_operations)) into despues;
  perform tests.eq(despues, antes, 'N · rechazos sin residuos (pedidos | existencia | kardex | asientos | operaciones)');
  perform tests.ok(not exists (select 1 from public.orders where external_ref like 'N-%'), 'N · ningún folio de venta rechazada quedó registrado');

  -- reintento del MISMO order_id tras un rechazo: puede venderse ya corregido (la operación no quedó a medias)
  v_o := gen_random_uuid();
  perform tests.act_as(v_pos);
  begin execute format(tmpl, v_o, 'N-10', v_a, '{}', lineas, alloc, c_b, null) into v_ok; exception when others then e := sqlerrm; end;
  execute format(tmpl, v_o, 'N-10', v_a, '{}', lineas, alloc, c_a, null) into v_ok;
  perform tests.act_as_owner();
  perform tests.ok(e like 'PAR_INCONSISTENTE%' and v_ok and (select customer_id = c_a from public.orders where id = v_o), 'N · tras un rechazo, el mismo order_id vende con la pareja correcta');
end $t$;
rollback;
