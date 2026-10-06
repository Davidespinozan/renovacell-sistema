-- C360-0 · El checkout canónico persiste la identidad comercial: perfil autenticado → customers.id
-- (uq_customers_profile). Sin cliente vinculado y activo: falla cerrado, sin pedido. La identidad NO
-- viene del cliente, del correo ni de seller_name. Snapshots, atribución, idempotencia y autoridad intactos.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); dC uuid := tests.user('doctor'); dE uuid := tests.user('doctor'); s1 uuid := tests.user('pos');
  cuA uuid; cuB uuid; cuC uuid; cuE uuid; cuOtro uuid; p uuid; kA uuid; kB uuid; kC uuid; kE uuid; r jsonb; rv uuid; n int; ord uuid; ord2 uuid; o0 bigint;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'C360-L', 50);
  cuA := tests.cliente(dA); cuC := tests.cliente(dC, false); cuE := tests.cliente(dE);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1);
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, is_default)
  select d, 'Consultorio', 'Av. del Mar 10', '82000', 'Mazatlán', 'Sinaloa', true from unnest(array[dA, dB, dC, dE]) d;
  kA := (public.cc_carrito_abrir('doctor', null, dA) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(kA, 'doctor', null, dA, p, 2, 'a1');
  kB := (public.cc_carrito_abrir('doctor', null, dB) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(kB, 'doctor', null, dB, p, 1, 'b1');
  kC := (public.cc_carrito_abrir('doctor', null, dC) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(kC, 'doctor', null, dC, p, 1, 'c1');
  kE := (public.cc_carrito_abrir('doctor', null, dE) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(kE, 'doctor', null, dE, p, 1, 'e1');
  -- 4 · colisión de correo: otro customer (sin portal) con el MISMO correo del perfil dE; y el de dE con otro correo
  update public.customers set email = 'otro-correo@test.local' where id = cuE;
  insert into public.customers (full_name, email, active) select 'Homónimo por correo', p2.email, true from public.profiles p2 where p2.id = dE returning id into cuOtro;
  select count(*) into o0 from public.orders;

  -- ══ 1 · doctor con cliente vinculado → order.customer_id correcto ══════════════
  perform tests.act_as(dA);
  r := public.cc_checkout_revisar(kA);
  perform tests.eq((r ->> 'listo')::boolean, true, '1 · revisión lista con cliente vinculado');
  rv := (r ->> 'review_id')::uuid; n := (r ->> 'cart_rev')::int;
  r := public.cc_checkout_confirmar(rv, 'op-A', n, true);
  ord := (r ->> 'order_id')::uuid;
  perform tests.ok((r ->> 'confirmado')::boolean, '1 · confirmado');
  perform tests.act_as_service();
  perform tests.ok((select customer_id = cuA and doctor_id = dA from public.orders where id = ord), '1 · orders.customer_id = cliente canónico; doctor_id intacto');
  perform tests.ok((select shipping_meta -> 'customer' ->> 'id' = cuA::text and shipping_meta -> 'customer' ->> 'phone' = '6690000000' from public.orders where id = ord), '1 · snapshot del cliente en el pedido (W1)');

  -- ══ 6/7/8 · atribución, dirección y factura sin cambios ═══════════════════════
  perform tests.ok((select shipping_meta ->> 'seller_profile_id' = s1::text and shipping_meta ->> 'seller_origen' = 'cartera' from public.orders where id = ord), '6 · atribución por cartera (CC-7) intacta');
  perform tests.ok((select shipping_meta -> 'address' ->> 'line1' like 'Av. del Mar 10%' and shipping_meta -> 'address' ->> 'cp' = '82000' and shipping_meta ->> 'source' = 'cc_checkout' from public.orders where id = ord), '7 · snapshot de dirección intacto');
  perform tests.ok((select invoice_requested and invoice_meta is null from public.orders where id = ord), '8 · intención de factura; el receptor se congela aparte (como antes)');
  perform tests.act_as(dA);
  perform public.set_order_fiscal_snapshot(ord, tests.fiscal('AAA010101AA1'));
  perform tests.act_as_service();
  perform tests.eq((select invoice_meta -> 'receiver' ->> 'rfc' from public.orders where id = ord), 'AAA010101AA1', '8 · snapshot del receptor por pedido (sin cambios)');
  -- con customer_id el respaldo del receptor CFDI ya usa el maestro fiscal del CLIENTE (antes caía al legado del perfil)
  perform tests.act_as(v_admin); perform public.upsert_customer_fiscal(cuA, tests.fiscal('BBB010101BB2')); perform tests.act_as_service();
  perform tests.eq(public._w3_receptor(ord) ->> 'rfc', 'AAA010101AA1', '8 · el snapshot del pedido sigue mandando sobre el maestro');
  update public.orders set invoice_meta = null where id = ord;   -- (solo prueba del respaldo)
  perform tests.eq(public._w3_receptor(ord) ->> 'rfc', 'BBB010101BB2', '8 · sin snapshot, el receptor sale del CLIENTE canónico');

  -- ══ 2 · reintento → mismo resultado, sin duplicado ═══════════════════════════
  perform tests.act_as(dA);
  r := public.cc_checkout_confirmar(rv, 'op-A', n, true);
  perform tests.ok((r ->> 'order_id')::uuid = ord and (r ->> 'idempotente')::boolean, '2 · reintento idempotente: mismo pedido');
  perform tests.act_as_service();
  perform tests.eq((select count(*)::int from public.orders where customer_id = cuA), 1, '2 · un solo pedido del cliente');

  -- ══ 9 · CC-7 intacto: carrito convertido, handoff conservado, nuevo carrito vacío ══
  perform tests.ok((select estado = 'converted' and converted_order_id = ord and handoff_estado = 'solicitado' from public.cc_carts where id = kA), '9 · carrito canónico convertido; su handoff se conserva');

  -- ══ 3 · perfil SIN cliente → falla cerrado ═════════════════════════════════════
  perform tests.act_as(dB);
  r := public.cc_checkout_revisar(kB);
  perform tests.ok(not (r ->> 'listo')::boolean and r -> 'problemas' @> '["CLIENTE_NO_VINCULADO"]' and r ->> 'review_id' is null, '3 · sin cliente: revisión NO lista (CLIENTE_NO_VINCULADO), sin revisión');
  -- revisión emitida con cliente, que luego se desvincula: confirmar FALLA CERRADO sin pedido
  perform tests.act_as_service(); cuB := tests.cliente(dB);
  perform tests.act_as(dB);
  r := public.cc_checkout_revisar(kB); rv := (r ->> 'review_id')::uuid; n := (r ->> 'cart_rev')::int;
  perform tests.act_as_service(); update public.customers set profile_id = null where id = cuB;
  perform tests.act_as(dB);
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op-B'', %s)', rv, n), 'CLIENTE_NO_VINCULADO', '3 · confirmar sin cliente vinculado: falla cerrado');
  perform tests.act_as_service();
  perform tests.ok(not exists (select 1 from public.orders where doctor_id = dB), '3 · ningún pedido con customer_id NULL');
  perform tests.ok((select estado = 'active' from public.cc_carts where id = kB) and (select consumed_at is null from public.cc_checkout_reviews where id = rv)
               and not exists (select 1 from public.cc_checkout_operations where cart_id = kB), '3 · carrito, revisión y libro intactos (transacción revertida)');
  -- cliente INACTIVO → tampoco
  perform tests.act_as(dC);
  perform tests.ok(public.cc_checkout_revisar(kC) -> 'problemas' @> '["CLIENTE_NO_VINCULADO"]', '3 · cliente inactivo = no vinculado');

  -- ══ 4 · la identidad NO sale del correo ════════════════════════════════════════
  perform tests.act_as(dE);
  r := public.cc_checkout_revisar(kE);
  r := public.cc_checkout_confirmar((r ->> 'review_id')::uuid, 'op-E', (r ->> 'cart_rev')::int);
  ord2 := (r ->> 'order_id')::uuid;
  perform tests.act_as_service();
  perform tests.ok((select customer_id = cuE and customer_id <> cuOtro from public.orders where id = ord2), '4 · cliente por perfil, no por correo (el homónimo por correo se ignora)');
  perform tests.eq((select count(*)::int from public.customers where profile_id in (dA, dE)), 2, '4 · no se crean clientes duplicados');

  -- ══ 5/10 · nada de autoridad del cliente; autorización intacta ════════════════
  perform tests.ok(not exists (select 1 from pg_proc pr join pg_namespace s on s.oid = pr.pronamespace where s.nspname = 'public' and pr.proname in ('cc_checkout_revisar', 'cc_checkout_confirmar')
                                and pg_get_function_identity_arguments(pr.oid) ~ 'customer'), '5 · ningún parámetro de cliente en revisar/confirmar (no se puede suplantar)');
  perform tests.act_as(dE);
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op-x'')', rv), 'NO_AUTORIZADO', '10 · otro doctor no confirma una revisión ajena');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_checkout_revisar(%L)', kB), 'NO_AUTORIZADO', '10 · Dirección no usa el checkout del cliente');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_checkout_revisar(%L)', kB), 'permission denied', '10 · anon sin acceso');
  perform tests.throws(format('select public._cc_chk_customer(%L)', dA), 'permission denied', '5 · el helper de identidad no es invocable por clientes');
  perform tests.act_as_owner();
  perform tests.eq((select count(*) from public.orders) - o0, 2::bigint, 'solo los dos pedidos esperados');
  perform tests.eq((select count(*)::int from public.orders where customer_id is null and shipping_meta ->> 'source' = 'cc_checkout'), 0, '1 · ningún pedido canónico sin customer_id');
end $t$;
rollback;
