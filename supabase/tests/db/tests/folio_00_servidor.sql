-- FOLIO · El servidor genera el folio (formato legacy S<6>), único, no reciclable; el cliente puede
-- seguir mandando el suyo si no colisiona; crear_pedido devuelve el folio efectivo; POS no cambia.
begin;
do $t$
declare v_doc uuid := tests.user('doctor'); v_admin uuid := tests.fixture_admin(); pA uuid; r jsonb; r2 jsonb; f1 text; o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid(); o4 uuid := gen_random_uuid();
begin
  pA := tests.producto_fam('Rellenos', 'Folio', 100);
  perform tests.act_as(v_doc);
  -- cliente sin folio → servidor
  r := public.crear_pedido(o1, null, v_doc, jsonb_build_array(jsonb_build_object('product_id', pA, 'qty', 1)));
  f1 := r ->> 'folio';
  perform tests.ok(f1 ~ '^S[0-9]{6,}$', 'A · sin folio del cliente → folio del servidor con formato legacy S<6> (' || f1 || ')');
  perform tests.eq((select external_ref from public.orders where id = o1), f1, 'A · persistido');
  -- cliente con folio propio no usado → se respeta (compatibilidad con portal/ventas)
  r := public.crear_pedido(o2, 'S424242', v_doc, jsonb_build_array(jsonb_build_object('product_id', pA, 'qty', 1)));
  perform tests.eq(r ->> 'folio', 'S424242', 'B · folio del cliente se respeta si no existe');
  -- cliente repite folio (colisión del reloj) → NO falla: servidor asigna otro, único
  r := public.crear_pedido(o3, 'S424242', v_doc, jsonb_build_array(jsonb_build_object('product_id', pA, 'qty', 1)));
  perform tests.ok(r ->> 'folio' <> 'S424242' and r ->> 'folio' ~ '^S[0-9]{6,}$', 'C · folio repetido → el servidor asigna uno nuevo en vez de duplicar o fallar');
  perform tests.eq((select count(*) - count(distinct external_ref) from public.orders), 0::bigint, 'C · cero duplicados');
  -- idempotencia por order_id devuelve el folio efectivo
  r2 := public.crear_pedido(o3, 'S424242', v_doc, jsonb_build_array(jsonb_build_object('product_id', pA, 'qty', 1)));
  perform tests.ok((r2 ->> 'idempotent')::boolean and r2 ->> 'folio' = r ->> 'folio', 'D · reintento por order_id → mismo folio');
  -- índice único protege también al POS y a cualquier INSERT
  perform tests.act_as_service();
  perform tests.throws(format('insert into public.orders (id, external_ref, doctor_id, total, status, payment_status) values (%L, %L, %L, 1, ''draft'', ''pending'')', o4, f1, v_doc), 'uq_orders_external_ref', 'E · external_ref único a nivel base');
  -- la secuencia no recicla y salta valores ya usados
  perform setval('public.orders_folio_seq', substring(f1 from 2)::bigint - 1);   -- forzar que el siguiente valor coincida con uno usado
  perform tests.act_as(v_doc);
  r := public.crear_pedido(gen_random_uuid(), null, v_doc, jsonb_build_array(jsonb_build_object('product_id', pA, 'qty', 1)));
  perform tests.ok(r ->> 'folio' <> f1 and r ->> 'folio' ~ '^S[0-9]{6,}$', 'F · siguiente_folio salta los usados');
  -- autorización intacta (texto W1): doctor no verificado / anon
  perform tests.act_as_anon();
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, %L, ''[]''::jsonb)', v_doc), 'permission denied', 'G · anon sin crear_pedido');
  perform tests.throws('select public.siguiente_folio()', 'permission denied', 'G · siguiente_folio no es invocable por clientes');
  perform tests.act_as(v_doc);
  perform tests.throws('select public.siguiente_folio()', 'permission denied', 'G · ni por el doctor');
  perform tests.throws(format('select public.crear_pedido(gen_random_uuid(), null, %L, ''[]''::jsonb)', v_admin), 'No autorizado', 'G · un doctor no crea a nombre de otro');
  -- precio por volumen intacto
  perform tests.act_as_service(); insert into public.product_volume_prices (product_id, min_quantity, price, active) values (pA, 5, 80, true); perform tests.act_as(v_doc);
  r := public.crear_pedido(gen_random_uuid(), null, v_doc, jsonb_build_array(jsonb_build_object('product_id', pA, 'qty', 5)));
  perform tests.eq((r ->> 'total')::numeric, 400::numeric, 'H · precio_de con cantidad (volumen) intacto');
end $t$;
rollback;
