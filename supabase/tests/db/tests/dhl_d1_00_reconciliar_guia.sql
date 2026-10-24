-- DHL D1 (190) · reconciliar_guia: Dirección resuelve un intento de guía en estado desconocido con la consulta del servidor.
-- sin_guia: decisión bajo riesgo declarado (60 min, sin hallazgos, portal, motivo, riesgo aceptado) que libera el pedido.
-- guia_confirmada: solo si la guía hallada coincide con el snapshot (referencia, servicio, CP, peso, piezas) y es única.
-- Nunca inventa costo ni datos; no toca inventario ni dinero; el aviso al cliente sale por el camino normal al enviar.
begin;
create function pg_temp.desconocido(p_doc uuid, p_prod uuid, p_id uuid, p_edad interval, p_request jsonb, p_cost numeric default null) returns uuid language plpgsql as $f$
declare o uuid;
begin
  perform tests.act_as_owner();
  o := tests.packed_order(p_doc, jsonb_build_array(jsonb_build_object('product_id', p_prod, 'qty', 1)));
  insert into public.shipping_attempts (id, order_id, provider, idempotency_key, service_code, request_fingerprint, external_reference, status, request, error, provider_cost, currency, created_at, updated_at)
  values (p_id, o, 'dhl', o::text || ':N', 'N', md5(o::text), p_id::text, 'unknown_requires_reconciliation', p_request, 'create timeout/network', p_cost, case when p_cost is null then null else 'MXN' end, now() - p_edad, now() - p_edad);
  return o;
end $f$;
create function pg_temp.guia(p_tn text, p_ref text, p_prod text, p_cp text, p_peso numeric, p_piezas int) returns jsonb language sql as $f$
  select jsonb_build_object('tracking', p_tn, 'referencias', jsonb_build_array(p_ref), 'producto', p_prod, 'destino_cp', p_cp, 'peso_total', p_peso, 'piezas', p_piezas, 'eventos', 0)
$f$;
create function pg_temp.consulta(p_ref text, p_enc jsonb, p_portal boolean default true, p_acepta boolean default true, p_edad interval default '0', p_tn text default null, p_tn_enc jsonb default null, p_resultado text default null) returns jsonb language sql as $f$
  select jsonb_build_object('consultado_en', now() - p_edad, 'referencia', p_ref,
           'por_referencia', jsonb_build_object('realizada', coalesce(p_resultado, 'x') <> 'error', 'resultado', coalesce(p_resultado, case when jsonb_array_length(p_enc) > 0 then 'encontradas' else 'sin_resultados' end), 'encontradas', p_enc),
           'portal_revisado', p_portal, 'acepta_duplicado_tardio', p_acepta)
         || case when p_tn is null then '{}'::jsonb else jsonb_build_object('por_tracking', jsonb_build_object('realizada', true, 'tracking', p_tn, 'resultado', case when jsonb_array_length(coalesce(p_tn_enc, '[]'::jsonb)) > 0 then 'encontradas' else 'sin_resultados' end, 'encontradas', coalesce(p_tn_enc, '[]'::jsonb))) end
$f$;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing'); v_pos uuid := tests.user('pos'); v_bill uuid := tests.user('billing');
  dA uuid := tests.user('doctor', 'd1-doc@t.local'); p uuid := tests.product(100); lot uuid; q0 int; m0 text;
  req jsonb := jsonb_build_object('shipper', jsonb_build_object('name', 'Renovacell', 'cp', '80197'), 'receiver', jsonb_build_object('name', 'Dra', 'address', jsonb_build_object('line1', 'Av 2', 'cp', '44100', 'city', 'Guadalajara', 'phone', '3312345678')),
                                  'pkg', jsonb_build_object('weightKg', 1.2, 'lengthCm', 20, 'widthCm', 20, 'heightCm', 10, 'pieces', 1), 'productCode', 'N', 'orderRef', 'S1');
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid(); a4 uuid := gen_random_uuid(); a5 uuid := gen_random_uuid(); a6 uuid := gen_random_uuid();
  r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; op uuid; r jsonb; rr jsonb; n int; s record;
  f text := 'select public.reconciliar_guia(%L::uuid, %L::uuid, %L, %L::jsonb, %L, %L)';
  ok jsonb; g jsonb;
begin
  perform tests.act_as_owner(); lot := tests.stock(p, 'D1-LOT', 40);
  perform tests.act_as_service(); insert into public.customers (full_name, email, source, profile_id) values ('Cliente D1', 'd1-doc@t.local', 'portal', dA);
  perform tests.act_as_owner();

  -- ══ 0 · FORMA ══
  perform tests.ok(to_regprocedure('public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)') is not null, '0.1 · comando existe');
  perform tests.ok(not has_function_privilege('anon', 'public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)', 'execute')
               and not has_function_privilege('service_role', 'public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)', 'execute')
               and has_function_privilege('authenticated', 'public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)', 'execute'), '0.2 · solo authenticated tiene EXECUTE (el rol se decide dentro); el servicio NO');
  perform tests.ok((select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'shipping_attempts' and column_name in ('request', 'reconciliacion', 'reconciled_by', 'reconciled_at')), '0.3 · columnas de evidencia');
  perform tests.ok(exists (select 1 from pg_constraint where conrelid = 'public.inventory_operations'::regclass and pg_get_constraintdef(oid) like '%reconciliacion_guia%'), '0.4 · tipo de operación registrado');
  perform tests.ok(md5(pg_get_functiondef('public.finalize_shipment(uuid,jsonb)'::regprocedure)) = 'a1cf5c01877e87f41ee0e9635b478e34' and md5(pg_get_functiondef('public.anular_guia(uuid,uuid,text)'::regprocedure)) = '35015b5940b8848f001e18ce8d6e1356'
               and md5(pg_get_functiondef('public.anular_guia_manual(uuid,uuid,text,text)'::regprocedure)) = '68f0824cb3572d7ad394886afacdd78e', '0.5 · comandos existentes NO cambiaron');
  o4 := tests.packed_order(dA, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  perform tests.throws(format($q$insert into public.shipping_attempts (order_id, idempotency_key, status, reconciliacion) values (%L::uuid, 'x', 'pending', '{}'::jsonb)$q$, o4), 'ck_shipping_attempts_reconciliacion', '0.6 · evidencia sin autor/fecha no entra');

  -- escenario: intento desconocido de hace 2 h con snapshot
  o1 := pg_temp.desconocido(dA, p, a1, interval '2 hours', req); r1 := replace(a1::text, '-', '');
  q0 := tests.qty(lot); m0 := (select md5(coalesce(string_agg(e.id::text || e.amount, ',' order by e.id), '')) from public.payment_entries e);
  ok := pg_temp.consulta(r1, '[]'::jsonb);

  -- ══ A · QUIÉN ══
  perform tests.act_as(v_wh);   perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok, 'DHL no tiene nada', null), 'NO_AUTORIZADO', 'A1 · Almacén no reconcilia');
  perform tests.act_as(v_pk);   perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok, 'DHL no tiene nada', null), 'NO_AUTORIZADO', 'A2 · Empaque tampoco');
  perform tests.act_as(v_pos);  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok, 'DHL no tiene nada', null), 'NO_AUTORIZADO', 'A3 · ni Ventas');
  perform tests.act_as(v_bill); perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok, 'DHL no tiene nada', null), 'NO_AUTORIZADO', 'A4 · ni Facturación');
  perform tests.act_as(dA);     perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok, 'DHL no tiene nada', null), 'NO_AUTORIZADO', 'A5 · ni el cliente');
  perform tests.act_as_anon();  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok, 'DHL no tiene nada', null), 'permission denied', 'A6 · anónimo: sin EXECUTE');
  perform tests.act_as_service(); perform tests.throws_any(format(f, gen_random_uuid(), a1, 'sin_guia', ok, 'DHL no tiene nada', null), array['NO_AUTORIZADO', 'denied'], 'A7 · el servicio no decide por Dirección');

  -- ══ B · VALIDACIONES ══
  perform tests.act_as(v_admin);
  perform tests.throws(format(f, null, a1, 'sin_guia', ok, 'DHL no tiene nada', null), 'OP_ID_REQUERIDO', 'B1 · sin op_id');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'otra', ok, 'DHL no tiene nada', null), 'RESOLUCION_INVALIDA', 'B2 · resolución desconocida');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok, 'corto', null), 'MOTIVO_REQUERIDO', 'B3 · motivo de 5 letras');
  perform tests.throws(format(f, gen_random_uuid(), gen_random_uuid(), 'sin_guia', ok, 'DHL no tiene nada', null), 'INTENTO_INEXISTENTE', 'B4 · intento inexistente');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', null, 'DHL no tiene nada', null), 'CONSULTA_INCOMPLETA', 'B5 · sin consulta');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok - 'consultado_en', 'DHL no tiene nada', null), 'CONSULTA_INCOMPLETA', 'B6 · consulta sin fecha');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', pg_temp.consulta(r1, '[]'::jsonb, true, true, interval '31 minutes'), 'DHL no tiene nada', null), 'CONSULTA_CADUCA', 'B7 · consulta de hace 31 min');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', pg_temp.consulta('otra-referencia', '[]'::jsonb), 'DHL no tiene nada', null), 'CONSULTA_AJENA', 'B8 · consulta de otra referencia');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', pg_temp.consulta(r1, '[]'::jsonb, true, true, '0', null, null, 'error'), 'DHL no tiene nada', null), 'CONSULTA_INCOMPLETA', 'B9 · DHL respondió error: la búsqueda no se completó');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', jsonb_set(ok, '{por_referencia,realizada}', 'false'), 'DHL no tiene nada', null), 'CONSULTA_INCOMPLETA', 'B10 · búsqueda no realizada');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok || jsonb_build_object('por_tracking', jsonb_build_object('realizada', false, 'tracking', '3143999482', 'resultado', 'error', 'encontradas', '[]'::jsonb)), 'DHL no tiene nada', null), 'CONSULTA_INCOMPLETA', 'B11 · búsqueda por número fallida: no se decide');
  perform tests.act_as_owner();
  perform tests.ok((select status = 'unknown_requires_reconciliation' and reconciliacion is null and reconciled_at is null from public.shipping_attempts where id = a1)
               and (select status = 'packed' from public.orders where id = o1) and not exists (select 1 from public.shipments where order_id = o1), 'B12 · ningún rechazo cambió nada');

  -- ══ C · SIN GUÍA (decisión bajo riesgo) ══
  perform tests.act_as(v_admin);
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', pg_temp.consulta(r1, jsonb_build_array(pg_temp.guia('3143999482', r1, 'N', '44100', 1.2, 1))), 'DHL no tiene nada', null), 'HALLAZGOS_EXISTEN', 'C1 · con una guía hallada no se resuelve sin guía');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', pg_temp.consulta(r1, '[]'::jsonb, true, true, '0', '3143999482', jsonb_build_array(pg_temp.guia('3143999482', 'otra', 'N', '44100', 1.2, 1))), 'DHL no tiene nada', null), 'HALLAZGOS_EXISTEN', 'C2 · hallazgo por número (aunque no lleve la referencia) también bloquea');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', pg_temp.consulta(r1, '[]'::jsonb, false, true), 'DHL no tiene nada', null), 'REVISION_REQUERIDA', 'C3 · sin revisar el portal');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', pg_temp.consulta(r1, '[]'::jsonb, true, false), 'DHL no tiene nada', null), 'RIESGO_NO_ACEPTADO', 'C4 · sin aceptar el riesgo de duplicado tardío');
  -- intento reciente (30 min)
  o2 := pg_temp.desconocido(dA, p, a2, interval '30 minutes', req); r2 := replace(a2::text, '-', '');
  perform tests.act_as(v_admin);
  perform tests.throws(format(f, gen_random_uuid(), a2, 'sin_guia', pg_temp.consulta(r2, '[]'::jsonb), 'DHL no tiene nada', null), 'CIERRE_PREMATURO', 'C5 · antes de 60 min no se resuelve sin guía');
  -- éxito (inventario y dinero se miden justo antes: los pedidos de apoyo ya se crearon)
  perform tests.act_as_owner(); q0 := tests.qty(lot); m0 := (select md5(coalesce(string_agg(e.id::text || e.amount, ',' order by e.id), '')) from public.payment_entries e);
  op := gen_random_uuid(); perform tests.act_as(v_admin);
  execute format(f, op, a1, 'sin_guia', ok, 'Consulté por referencia y en el portal MyDHL: no existe la guía', null) into r;
  perform tests.act_as_owner();
  perform tests.ok(r ->> 'status' = 'applied' and r ->> 'resolucion' = 'sin_guia' and (r ->> 'order_id')::uuid = o1 and r ->> 'order_status' = 'packed', 'C6 · respuesta: aplicada, sin guía, pedido sigue empacado');
  select * into s from public.shipping_attempts where id = a1;
  perform tests.ok(s.status = 'failed_safe_to_retry' and s.reconciled_by = v_admin and s.reconciled_at is not null and s.reconciliacion ->> 'resolucion' = 'sin_guia'
               and s.reconciliacion ->> 'advertencia' like 'Un 404%' and (s.reconciliacion -> 'por_referencia' ->> 'resultado') = 'sin_resultados' and s.error like 'Reconciliado por Dirección%', 'C7 · intento liberado con la evidencia y la advertencia guardadas');
  perform tests.ok((select status = 'packed' from public.orders where id = o1) and not exists (select 1 from public.shipments where order_id = o1)
               and not exists (select 1 from public.comm_outbox where order_id = o1 and plantilla = 'pedido_enviado'), 'C8 · el pedido no cambió: sin envío, sin aviso');
  perform tests.eq(tests.qty(lot), q0, 'C9 · inventario intacto');
  perform tests.eq((select md5(coalesce(string_agg(e.id::text || e.amount, ',' order by e.id), '')) from public.payment_entries e), m0, 'C10 · dinero intacto');
  perform tests.ok((select count(*) = 1 from public.inventory_operations where op_id = op and kind = 'reconciliacion_guia'), 'C11 · operación registrada');
  -- el pedido admite otra guía (el índice único ya no bloquea) y el intento liberado no vuelve a resolverse
  insert into public.shipping_attempts (order_id, provider, idempotency_key, status) values (o1, 'dhl', o1::text || ':N:2', 'pending');
  perform tests.ok((select count(*) = 1 from public.shipping_attempts where order_id = o1 and status = 'pending'), 'C12 · un intento nuevo puede reclamarse');
  delete from public.shipping_attempts where order_id = o1 and status = 'pending';
  perform tests.act_as(v_admin);
  execute format(f, op, a1, 'sin_guia', ok, 'Consulté por referencia y en el portal MyDHL: no existe la guía', null) into rr;
  perform tests.ok(rr ->> 'status' in ('applied', 'already_applied') and (rr ->> 'order_id')::uuid = o1, 'C13 · misma operación: ya aplicada, sin error');
  perform tests.throws(format(f, gen_random_uuid(), a1, 'sin_guia', ok, 'Consulté por referencia y en el portal MyDHL: no existe la guía', null), 'ESTADO_INVALIDO', 'C14 · otra operación sobre el intento ya resuelto: rechazada');
  perform tests.throws(format(f, op, a1, 'guia_confirmada', ok, 'otro motivo distinto largo', '3143999482'), 'OP_ID_REUTILIZADO', 'C15 · el mismo op_id con otra decisión no se reutiliza');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 from public.inventory_operations where kind = 'reconciliacion_guia'), 'C16 · una sola operación registrada');

  -- ══ D · GUÍA CONFIRMADA ══
  o3 := pg_temp.desconocido(dA, p, a3, interval '5 minutes', req); r3 := replace(a3::text, '-', '');          -- reciente: confirmar no exige 60 min
  g := pg_temp.guia('3143999482', r3, 'N', '44100', 1.2, 1);
  perform tests.act_as(v_admin);
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(g)), 'La guía aparece en DHL con la referencia', null), 'TRACKING_REQUERIDO', 'D1 · sin número de guía');
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(g)), 'La guía aparece en DHL con la referencia', 'ABC123'), 'TRACKING_INVALIDO', 'D2 · número que no es de DHL Express');
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(g, pg_temp.guia('3143999483', r3, 'N', '44100', 1.2, 1))), 'La guía aparece en DHL con la referencia', '3143999482'), 'AMBIGUO', 'D3 · dos guías distintas: ninguna se registra');
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, '[]'::jsonb), 'La guía aparece en DHL con la referencia', '3143999482'), 'COINCIDENCIA_INSUFICIENTE', 'D4 · el número no aparece en la consulta del servidor (no basta que lo teclee Dirección)');
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(pg_temp.guia('3143999482', 'otra-ref', 'N', '44100', 1.2, 1))), 'La guía aparece en DHL con la referencia', '3143999482'), 'COINCIDENCIA_INSUFICIENTE', 'D5 · sin la referencia del intento');
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(pg_temp.guia('3143999482', r3, 'P', '44100', 1.2, 1))), 'La guía aparece en DHL con la referencia', '3143999482'), 'COINCIDENCIA_INSUFICIENTE', 'D6 · otro servicio');
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(pg_temp.guia('3143999482', r3, 'N', '44600', 1.2, 1))), 'La guía aparece en DHL con la referencia', '3143999482'), 'COINCIDENCIA_INSUFICIENTE', 'D7 · otro CP de destino');
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(pg_temp.guia('3143999482', r3, 'N', '44100', 1.5, 1))), 'La guía aparece en DHL con la referencia', '3143999482'), 'COINCIDENCIA_INSUFICIENTE', 'D8 · peso fuera del 10 %');
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(pg_temp.guia('3143999482', r3, 'N', '44100', 1.2, 2))), 'La guía aparece en DHL con la referencia', '3143999482'), 'COINCIDENCIA_INSUFICIENTE', 'D9 · otras piezas');
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(pg_temp.guia('3143999482', r3, null, '44100', 1.2, 1))), 'La guía aparece en DHL con la referencia', '3143999482'), 'COINCIDENCIA_INSUFICIENTE', 'D10 · DHL sin producto: no se completa');
  -- guía ya registrada en otro envío
  perform tests.act_as_owner();
  insert into public.shipments (order_id, carrier, tracking_number, status, provider) values (o4, 'DHL', '3143999482', 'in_transit', 'dhl');
  perform tests.act_as(v_admin);
  perform tests.throws(format(f, gen_random_uuid(), a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(g)), 'La guía aparece en DHL con la referencia', '3143999482'), 'GUIA_YA_REGISTRADA', 'D11 · ese número ya está en otro envío');
  perform tests.act_as_owner(); delete from public.shipments where order_id = o4;
  -- sin snapshot
  o5 := pg_temp.desconocido(dA, p, a5, interval '5 minutes', null); r5 := replace(a5::text, '-', '');
  perform tests.act_as(v_admin);
  perform tests.throws(format(f, gen_random_uuid(), a5, 'guia_confirmada', pg_temp.consulta(r5, jsonb_build_array(pg_temp.guia('3143999485', r5, 'N', '44100', 1.2, 1))), 'La guía aparece en DHL con la referencia', '3143999485'), 'SIN_SNAPSHOT', 'D12 · sin snapshot no se registra (no se inventan datos)');
  perform tests.act_as_owner();
  perform tests.ok((select status = 'unknown_requires_reconciliation' and reconciliacion is null from public.shipping_attempts where id = a3) and (select status = 'packed' from public.orders where id = o3) and not exists (select 1 from public.shipments where order_id = o3), 'D13 · ningún rechazo cambió nada');

  -- éxito (coincidencia por peso dentro del 10 % y por referencia en la lista con otras referencias)
  q0 := tests.qty(lot); m0 := (select md5(coalesce(string_agg(e.id::text || e.amount, ',' order by e.id), '')) from public.payment_entries e);
  op := gen_random_uuid(); perform tests.act_as(v_admin);
  execute format(f, op, a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(jsonb_set(pg_temp.guia('3143999482', r3, 'N', '44100', 1.25, 1), '{referencias}', jsonb_build_array('OTRA', r3)))), 'La guía aparece en DHL con la referencia del intento', '3143999482') into r;
  perform tests.act_as_owner();
  perform tests.ok(r ->> 'status' = 'applied' and r ->> 'resolucion' = 'guia_confirmada' and r ->> 'tracking' = '3143999482' and r ->> 'order_status' = 'shipped' and (r ->> 'costo_pendiente')::boolean, 'D14 · respuesta: guía registrada, pedido enviado, costo pendiente');
  select * into s from public.shipping_attempts where id = a3;
  perform tests.ok(s.status = 'succeeded' and s.tracking_number = '3143999482' and s.reconciled_by = v_admin and s.reconciliacion ->> 'resolucion' = 'guia_confirmada' and s.error is null, 'D15 · intento cerrado como exitoso con evidencia');
  select * into s from public.shipments where order_id = o3;
  perform tests.ok(s.tracking_number = '3143999482' and s.provider = 'dhl' and s.carrier = 'DHL' and s.status = 'in_transit' and s.service_code = 'N' and s.provider_cost is null and s.label_path is null
               and (s.provider_meta -> 'reconciliada' ->> 'referencia') = r3 and (s.provider_meta ->> 'costo_pendiente')::boolean and s.ship_to -> 'address' ->> 'cp' = '44100' and (s.package ->> 'weightKg')::numeric = 1.2, 'D16 · envío con los datos del snapshot, sin costo inventado');
  perform tests.ok((select status = 'shipped' and shipping_meta ->> 'tracking' = '3143999482' and shipping_meta ->> 'carrier' = 'DHL' and shipping_meta ->> 'method' = 'paqueteria' from public.orders where id = o3), 'D17 · pedido enviado con la guía');
  perform tests.ok((select count(*) = 1 and bool_and(payload ->> 'rastreo' = '3143999482') from public.comm_outbox where order_id = o3 and plantilla = 'pedido_enviado'), 'D18 · el aviso "va en camino" sale por el camino normal con la guía vigente');
  perform tests.eq(tests.qty(lot), q0, 'D19 · inventario intacto');
  perform tests.eq((select md5(coalesce(string_agg(e.id::text || e.amount, ',' order by e.id), '')) from public.payment_entries e), m0, 'D20 · dinero intacto');
  perform tests.act_as(v_admin);
  execute format(f, op, a3, 'guia_confirmada', pg_temp.consulta(r3, jsonb_build_array(g)), 'La guía aparece en DHL con la referencia del intento', '3143999482') into rr;
  perform tests.ok(rr ->> 'status' in ('applied', 'already_applied') and rr ->> 'tracking' = '3143999482', 'D21 · misma operación: ya aplicada');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 from public.shipments where order_id = o3) and (select count(*) = 1 from public.shipping_attempts where order_id = o3), 'D22 · un solo envío y un solo intento');
  -- con costo conocido (la re-cotización alcanzó a guardarse antes del timeout): se conserva, sin costo pendiente
  o6 := pg_temp.desconocido(dA, p, a6, interval '5 minutes', req, 294); r6 := replace(a6::text, '-', '');
  perform tests.act_as(v_admin);
  execute format(f, gen_random_uuid(), a6, 'guia_confirmada', pg_temp.consulta(r6, jsonb_build_array(pg_temp.guia('3143999486', r6, 'N', '44100', 1.2, 1))), 'La guía aparece en DHL con la referencia del intento', '3143999486') into r;
  perform tests.act_as_owner();
  perform tests.ok(not (r ->> 'costo_pendiente')::boolean and (select provider_cost = 294 and currency = 'MXN' and not (provider_meta ? 'costo_pendiente') from public.shipments where order_id = o6), 'D23 · costo del intento conservado, nunca inventado');

  -- ══ E · COHERENCIA CON LO EXISTENTE ══
  perform tests.act_as(v_wh);
  r := public.anular_guia(gen_random_uuid(), o3, 'dirección equivocada');
  perform tests.act_as_owner();
  perform tests.ok(r ->> 'status' = 'applied' and r ->> 'guia_anulada' = '3143999482' and (select status = 'packed' from public.orders where id = o3) and (select status = 'voided_manual' from public.shipping_attempts where id = a3), 'E1 · la guía reconciliada se anula como cualquier otra (pedido vuelve a empacado)');
  perform tests.act_as(v_admin);
  perform tests.throws($q$select public.anular_guia_manual(gen_random_uuid(), gen_random_uuid(), 'ref')$q$, 'GUIA_INEXISTENTE', 'E2 · anular_guia_manual sigue igual');
  perform tests.act_as_owner();
  perform tests.eq(tests.conciliacion_errores(), 0, 'Z · inventario concilia');
end $t$;
rollback;
