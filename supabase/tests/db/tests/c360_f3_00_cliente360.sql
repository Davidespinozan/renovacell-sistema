-- C360-F3 · Customer 360 canónico: lectura por rol, teléfonos/domicilios/perfiles fiscales con comandos
-- autoritativos, checkout con perfil fiscal elegido, snapshots inmutables, cartera de CC-7, legados sin
-- autoridad, cierre de escrituras genéricas. (Números = matriz del dueño.)
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos');
  vb uuid := tests.user('billing'); vw uuid := tests.user('warehouse');
  cA uuid; cB uuid; cSin uuid; t1 uuid; t2 uuid; t3 uuid; l1 uuid; l2 uuid; l3 uuid; f1 uuid; f2 uuid; fB uuid; p uuid; k uuid; rv uuid; n int; ord uuid; r jsonb; x jsonb; e0 bigint;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);
  update public.profiles set meta = coalesce(meta, '{}') || '{"shipping":{"line1":"Calle del Alta 5","colonia":"Centro","cp":"82000","city":"Mazatlán","state":"Sinaloa","phone":"6691112233"}}'::jsonb where id = dA;
  cA := tests.cliente(dA); cB := tests.cliente(dB);
  insert into public.customers (full_name, email, phone, seller_name) values ('Cliente sin portal', 'sinportal@test.local', '669 444 5566', 'Vendedor Importado') returning id into cSin;
  update public.customers set seller_name = 'Vendedor Importado' where id = cA;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1);
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'F3-L', 50);

  -- ══ legado de teléfono: customers.phone (alta/importación) → principal canónico, sin duplicar ══
  perform tests.ok((select count(*) = 1 and bool_and(es_principal and origen = 'legado' and numero_norm = '6690000000') from public.customer_phones where customer_id = cA), 'J · el teléfono del alta queda como principal canónico (legado)');
  perform tests.ok((select count(*) = 1 from public.customer_phones where customer_id = cSin and numero_norm = '6694445566'), 'J · cliente sin portal también');
  update public.customers set phone = '669-000-0000' where id = cA;   -- mismo número con otro formato: no duplica
  perform tests.eq((select count(*)::int from public.customer_phones where customer_id = cA), 1, 'J · escritura heredada idempotente por número normalizado');

  -- ══ 6/7/8/9 · teléfonos (doctor dueño) ═══════════════════════════════════════════════════════
  perform tests.act_as(dA);
  t1 := (public.cliente_telefono_guardar(null, null, '+52 669 123 4567', 'whatsapp', false) ->> 'id')::uuid;
  perform tests.act_as_service();
  perform tests.ok((select etiqueta = 'whatsapp' and not es_principal from public.customer_phones where id = t1), '6 · agregar teléfono con etiqueta');
  perform tests.act_as(dA);
  perform tests.throws(format('select public.cliente_telefono_guardar(null, null, %L, ''celular'')', '669 123 4567'), 'TELEFONO_DUPLICADO', '6 · sin duplicados por número');
  perform tests.throws(format('select public.cliente_telefono_guardar(null, null, %L, ''celular'')', '123'), 'TELEFONO_INVALIDO', '6 · formato validado');
  perform tests.throws(format('select public.cliente_telefono_guardar(null, null, %L, ''fax'')', '6697778899'), 'ETIQUETA_INVALIDA', '6 · etiqueta cerrada');
  perform public.cliente_telefono_guardar(null, t1, '669 123 4568', 'celular');
  perform tests.act_as_service();
  perform tests.ok((select numero_norm = '6691234568' and etiqueta = 'celular' from public.customer_phones where id = t1), '7 · editar teléfono');
  perform tests.act_as(dA);
  perform public.cliente_telefono_principal(t1);
  perform tests.act_as_service();
  perform tests.ok((select es_principal from public.customer_phones where id = t1) and (select phone = '669 123 4568' from public.customers where id = cA), '8 · principal + espejo customers.phone');
  perform tests.act_as(dA);
  r := public.cliente_telefono_archivar(t1);
  perform tests.act_as_service();
  perform tests.ok((select not activo and not es_principal from public.customer_phones where id = t1) and (r ->> 'nuevo_principal') is not null
               and (select count(*) = 1 from public.customer_phones where customer_id = cA and es_principal and activo), '9/43 · archivar el principal promueve el activo más antiguo (determinista)');

  -- ══ 10–15 · domicilios ═══════════════════════════════════════════════════════════════════════
  perform tests.act_as(dA);
  l1 := (public.cliente_ubicacion_guardar(null, null, '{"tipo":"CONSULTORIO","name":"Consultorio Chapultepec","line1":"Av. Chapultepec","exterior_number":"100","neighborhood":"Americana","postal_code":"44160","municipio":"Guadalajara","city":"Guadalajara","state":"Jalisco"}'::jsonb) ->> 'id')::uuid;
  perform tests.act_as_service();
  perform tests.ok((select tipo = 'CONSULTORIO' and name = 'Consultorio Chapultepec' and municipio = 'Guadalajara' and is_default and doctor_id = dA and customer_id = cA from public.doctor_locations where id = l1), '10/14/15 · alta con tipo, alias libre y municipio; primera = predeterminada; anclada a doctor y cliente');
  perform tests.act_as(dA);
  perform tests.throws($$select public.cliente_ubicacion_guardar(null, null, '{"tipo":"YATE","name":"x","line1":"Calle 1","postal_code":"44160","city":"G","state":"J"}'::jsonb)$$, 'DOMICILIO_INVALIDO', '14 · tipo cerrado');
  perform tests.throws($$select public.cliente_ubicacion_guardar(null, null, '{"tipo":"CASA","name":"Casa","line1":"Calle 1","postal_code":"441","city":"G","state":"J"}'::jsonb)$$, 'DOMICILIO_INVALIDO', '10 · CP de 5 dígitos');
  l2 := (public.cliente_ubicacion_guardar(null, null, '{"tipo":"CLINICA_HOSPITAL","name":"Hospital Ángeles","line1":"Av. Hospital","postal_code":"44100","city":"Guadalajara","state":"Jalisco"}'::jsonb, true) ->> 'id')::uuid;
  perform tests.act_as_service();
  perform tests.ok((select is_default from public.doctor_locations where id = l2) and not (select is_default from public.doctor_locations where id = l1), '12 · predeterminado único');
  perform tests.act_as(dA);
  perform public.cliente_ubicacion_guardar(null, l1, '{"tipo":"CONSULTORIO","name":"Consultorio Chapultepec 2","line1":"Av. Chapultepec","exterior_number":"200","postal_code":"44160","city":"Guadalajara","state":"Jalisco"}'::jsonb);
  perform tests.act_as_service();
  perform tests.ok((select exterior_number = '200' and name = 'Consultorio Chapultepec 2' from public.doctor_locations where id = l1), '11 · editar domicilio');

  -- ══ 16–19 · perfiles fiscales (doctor) ═══════════════════════════════════════════════════════
  perform tests.act_as(dA);
  f1 := (public.cliente_fiscal_guardar(null, null, tests.fiscal('AAA010101AA1') || '{"alias":"Persona física"}'::jsonb) ->> 'id')::uuid;
  f2 := (public.cliente_fiscal_guardar(null, null, tests.fiscal('BBB010101BB2') || '{"alias":"Clínica SA"}'::jsonb) ->> 'id')::uuid;
  perform tests.act_as_service();
  perform tests.ok((select es_predeterminado from public.customer_fiscal_profiles where id = f1) and not (select es_predeterminado from public.customer_fiscal_profiles where id = f2), '16 · varios perfiles; el primero queda predeterminado');
  perform tests.eq((select meta -> 'fiscal' ->> 'rfc' from public.customers where id = cA), 'AAA010101AA1', 'L · espejo de compatibilidad = predeterminado');
  perform tests.act_as(dA);
  perform tests.throws(format('select public.cliente_fiscal_guardar(null, null, %L)', '{"rfc":"MAL"}'), 'FISCAL_INVALIDO', '16 · validación W3 (mismos campos)');
  perform public.cliente_fiscal_guardar(null, f2, tests.fiscal('BBB010101BB2') || '{"alias":"Clínica SA de CV","uso_cfdi":"G01"}'::jsonb);
  perform public.cliente_fiscal_predeterminar(f2);
  perform tests.act_as_service();
  perform tests.ok((select alias = 'Clínica SA de CV' and uso_cfdi = 'G01' and es_predeterminado from public.customer_fiscal_profiles where id = f2), '17/18 · editar y elegir predeterminado');
  perform tests.eq((select meta -> 'fiscal' ->> 'rfc' from public.customers where id = cA), 'BBB010101BB2', '18 · el espejo sigue al predeterminado');

  -- ══ 22/23 · checkout con perfil elegido; 21 · nunca uno ajeno ════════════════════════════════
  perform tests.act_as(dB);
  fB := (public.cliente_fiscal_guardar(null, null, tests.fiscal('CCC010101CC3')) ->> 'id')::uuid;
  perform tests.act_as_service();
  k := (public.cc_carrito_abrir('doctor', null, dA) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(k, 'doctor', null, dA, p, 1, 'f3-1');
  perform tests.act_as(dA);
  r := public.cc_checkout_revisar(k); rv := (r ->> 'review_id')::uuid; n := (r ->> 'cart_rev')::int;
  perform tests.throws(format('select public.cc_checkout_confirmar(%L, ''op-f3x'', %s, true, %L)', rv, n, fB), 'PERFIL_FISCAL_INVALIDO', '21 · el doctor no usa el perfil fiscal de otro cliente');
  r := public.cc_checkout_confirmar(rv, 'op-f3', n, true, f1);
  ord := (r ->> 'order_id')::uuid;
  perform tests.act_as_service();
  perform tests.ok((select invoice_requested and invoice_meta -> 'receiver' ->> 'rfc' = 'AAA010101AA1' and customer_id = cA from public.orders where id = ord), '22/23 · el perfil ELEGIDO (no el predeterminado) se congela como receptor');
  perform tests.eq(public._w3_receptor(ord) ->> 'rfc', 'AAA010101AA1', '23 · W3 sigue desde el receptor congelado');

  -- ══ 24/25/AA · editar/archivar después NO reescribe el pedido ════════════════════════════════
  perform tests.act_as(dA);
  perform public.cliente_fiscal_guardar(null, f1, tests.fiscal('DDD010101DD4'));
  perform public.cliente_fiscal_archivar(f1);
  perform public.cliente_ubicacion_guardar(null, l2, '{"tipo":"CLINICA_HOSPITAL","name":"Hospital nuevo","line1":"Otra calle","postal_code":"44100","city":"Guadalajara","state":"Jalisco"}'::jsonb);
  perform public.cliente_ubicacion_archivar(l2);
  perform public.cliente_telefono_guardar(null, null, '6699998877', 'consultorio', true);
  perform tests.act_as_service();
  perform tests.ok((select invoice_meta -> 'receiver' ->> 'rfc' = 'AAA010101AA1' and shipping_meta -> 'address' ->> 'line1' = 'Av. Hospital' and shipping_meta -> 'customer' ->> 'phone' = '6690000000' from public.orders where id = ord),   -- principal vigente AL CREAR el pedido
                   '24/25 · fiscal, domicilio y teléfono posteriores NO tocan el pedido (receptor, dirección y cliente congelados)');
  perform tests.ok((select not activo from public.customer_fiscal_profiles where id = f1) and exists (select 1 from public.doctor_locations where id = l2 and not active), '13/19 · archivar ≠ borrar');
  perform tests.ok((select is_default and active from public.doctor_locations where id = l1), '43 · archivar el predeterminado promueve otro de forma determinista');
  perform tests.eq(public._w3_receptor(ord) ->> 'rfc', 'AAA010101AA1', '24 · cambiar el predeterminado no reescribe pedidos');

  -- ══ 35 · el legado del perfil no le gana al canónico; meta.fiscal solo lo escribe el servidor ══
  perform tests.act_as(dA);
  update public.profiles set meta = jsonb_set(meta, '{fiscal}', tests.fiscal('EEE010101EE5')) where id = dA;   -- (legado editable por el doctor)
  perform tests.act_as_service();
  update public.orders set invoice_meta = null where id = ord;   -- (solo para probar la precedencia del respaldo)
  perform tests.eq(public._w3_receptor(ord) ->> 'rfc', 'BBB010101BB2', '35 · sin snapshot: perfil canónico predeterminado antes que el legado del perfil');

  -- ══ 36 · domicilio del alta: adopción explícita, nunca automática ni duplicada ════════════════
  perform tests.ok(not exists (select 1 from public.doctor_locations where line1 = 'Calle del Alta 5'), '36 · no se fabrican domicilios en silencio');
  perform tests.act_as(dA);
  r := public.cliente_ubicacion_adoptar_alta(null);
  perform tests.ok((r ->> 'adoptado')::boolean, '36 · adopción explícita del domicilio del alta');
  r := public.cliente_ubicacion_adoptar_alta(null);
  perform tests.eq(r ->> 'motivo', 'ya_existe', '36 · idempotente');
  perform tests.act_as(v_admin);
  perform tests.eq(public.cliente_ubicacion_adoptar_alta(cB) ->> 'motivo', 'sin_domicilio_de_alta', '36 · sin datos no se adopta');

  -- ══ 1/26/27/28/29/30/31/32/34 · lectura como Dirección ═══════════════════════════════════════
  r := public.cliente_360(cA);
  perform tests.eq(r ->> 'rol', 'direccion', '1 · Dirección');
  perform tests.ok((r -> 'resumen' -> 'vendedor' ->> 'id')::uuid = s1 and r -> 'resumen' ->> 'vendedor_historico' = 'Vendedor Importado', '26/34 · vendedor actual = cartera; seller_name solo como histórico');
  perform tests.ok(jsonb_array_length(r -> 'comercial' -> 'historial') >= 0 and r -> 'comercial' ? 'atribucion', '27/28 · historial y atribución por separado');
  perform tests.ok(jsonb_array_length(r -> 'pedidos') = 1 and r -> 'pedidos' -> 0 ->> 'folio' is not null and r -> 'pedidos' -> 0 ? 'estado_pago', '29/30 · pedidos por customer_id con estado de pago W2');
  perform tests.ok(r ? 'facturas' and r ? 'pagos' and r ? 'actividad' and r ? 'profesional', '31 · facturas W3, pagos y actividad presentes');
  perform tests.ok(jsonb_array_length(r -> 'actividad') >= 5 and not (r -> 'actividad')::text ilike '%6691234568%', 'Y · actividad real y sin valores personales');
  perform tests.ok(jsonb_array_length(r -> 'domicilios' -> 'lista') = 2 and (r -> 'domicilios' ->> 'archivados')::int = 1, '13 · domicilios activos y archivados contados');

  -- ══ 2/3/20/37 · vendedor: su cartera sí, ajena no, fiscal nunca ══════════════════════════════
  perform tests.act_as(s1);
  r := public.cliente_360(cA);
  perform tests.eq(r ->> 'rol', 'vendedor', '2 · vendedor asignado lee');
  perform tests.ok(r -> 'facturacion' -> 0 ->> 'razon_social' is null and r -> 'facturacion' -> 0 ->> 'rfc' like 'BBB%***%', '2 · fiscal enmascarado para el vendedor');
  perform tests.ok(not (r ? 'pagos') and not (r ? 'profesional') and r -> 'comercial' -> 'historial' = 'null'::jsonb, '2 · sin pagos, profesional ni historial de cartera');
  perform public.cliente_telefono_guardar(cA, null, '6695554433', 'recepcion');
  perform public.cliente_contacto_guardar(cA, '{"email":"nuevo@test.local","city":"Zapopan"}'::jsonb);
  perform public.cliente_nota_agregar(cA, 'Prefiere entregas por la mañana.');
  perform tests.throws(format('select public.cliente_contacto_guardar(%L, %L)', cA, '{"full_name":"Otro"}'), 'CAMPO_NO_PERMITIDO', '37 · el vendedor no cambia la identidad');
  perform tests.throws(format('select public.cliente_fiscal_guardar(%L, null, %L)', cA, tests.fiscal('FFF010101FF6')), 'NO_AUTORIZADO', '20 · el vendedor no edita fiscal');
  perform tests.throws(format('select public.upsert_customer_fiscal(%L, %L)', cA, tests.fiscal('FFF010101FF6')), 'NO_AUTORIZADO', '37 · ni por la RPC heredada');
  perform tests.throws(format('select public.cliente_360(%L)', cB), 'NO_AUTORIZADO', '3 · cliente fuera de su cartera: no lo lee');
  perform tests.throws(format('select public.cliente_telefono_guardar(%L, null, %L, ''celular'')', cB, '6691231231'), 'NO_AUTORIZADO', '3 · ni lo edita');
  perform tests.throws(format('select public.upsert_customer_contact(%L, %L)', cB, '{"city":"X"}'), 'NO_AUTORIZADO', '37 · RPC heredada acotada a su cartera');
  perform public.upsert_customer_contact(cA, '{"seller_name":"Yo mismo","full_name":"Hackeado","city":"Tlaquepaque"}'::jsonb);
  perform tests.act_as_service();
  perform tests.ok((select seller_name = 'Vendedor Importado' and full_name <> 'Hackeado' and city = 'Tlaquepaque' from public.customers where id = cA), '37 · el vendedor ya no escribe seller_name ni nombre');
  perform tests.act_as(s2);
  perform tests.throws(format('select public.cliente_360(%L)', cA), 'NO_AUTORIZADO', '3 · otro vendedor no lee la cartera ajena');
  perform tests.throws(format('select public.cliente_nota_agregar(%L, %L)', cA, 'x'), 'NO_AUTORIZADO', '3 · ni deja notas');

  -- ══ 4/5 · doctor: lo suyo sí, lo ajeno no ═════════════════════════════════════════════════════
  perform tests.act_as(dA);
  r := public.cliente_360(null);
  perform tests.ok(r ->> 'rol' = 'dueno' and r -> 'facturacion' -> 0 ->> 'razon_social' is not null and not (r ? 'comercial') and not (r ? 'actividad') and not (r ? 'profesional'), '4 · el doctor lee lo suyo (sin comercial/actividad/profesional)');
  perform tests.throws(format('select public.cliente_360(%L)', cB), 'NO_AUTORIZADO', '5 · el doctor no lee a otro cliente');
  perform tests.throws(format('select public.cliente_contacto_guardar(null, %L)', '{"email":"x@y.mx"}'), 'CAMPO_NO_PERMITIDO', '4 · el doctor no cambia su correo comercial aquí');
  perform tests.throws(format('select public.cliente_nota_agregar(%L, %L)', cA, 'x'), 'NO_AUTORIZADO', '4 · el doctor no escribe notas internas');

  -- ══ 38 · facturación: solo fiscal ═════════════════════════════════════════════════════════════
  perform tests.act_as(vb);
  r := public.cliente_360(cA);
  perform tests.ok(r ->> 'rol' = 'facturacion' and not (r ? 'comercial') and r ? 'facturas', '38 · facturación lee lo necesario');
  perform public.cliente_fiscal_guardar(cA, null, tests.fiscal('GGG010101GG7'));
  perform tests.throws(format('select public.cliente_telefono_guardar(%L, null, %L, ''celular'')', cA, '6691231232'), 'NO_AUTORIZADO', '38 · facturación no edita teléfonos');
  perform tests.throws(format('select public.upsert_customer_contact(%L, %L)', cA, '{"city":"X"}'), 'NO_AUTORIZADO', '38 · ni contacto por la RPC heredada');
  perform tests.act_as(vw);
  perform tests.throws(format('select public.cliente_360(%L)', cA), 'NO_AUTORIZADO', 'almacén sin acceso');

  -- ══ 37/39 · sin escrituras directas; anon fuera ═══════════════════════════════════════════════
  perform tests.act_as(dA);
  perform tests.throws(format('update public.doctor_locations set line1 = %L where id = %L', 'x', l1), 'permission denied', '37 · sin UPDATE directo a domicilios');
  perform tests.throws(format('insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state) values (%L, ''x'', ''x'', ''00000'', ''x'', ''x'')', dA), 'permission denied', '37 · sin INSERT directo');
  perform tests.throws('select * from public.customer_phones', 'permission denied', '37 · tablas canónicas sin acceso directo');
  perform tests.act_as(s1);
  update public.customers set seller_name = 'x' where id = cA;   -- RLS: 0 filas (solo Dirección actualiza)
  perform tests.act_as_service();
  perform tests.ok((select seller_name = 'Vendedor Importado' from public.customers where id = cA), '37 · el vendedor no escribe customers directo');
  perform tests.act_as(s1);
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cliente_360(%L)', cA), 'permission denied', '39 · anon');
  perform tests.throws(format('select public.cliente_telefono_guardar(%L, null, %L, ''celular'')', cA, '6691231233'), 'permission denied', '39 · anon no escribe');

  -- ══ 33 · CC no se duplica; 46 · CC-7 intacto ═════════════════════════════════════════════════
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name like 'customer\_%' and column_name in ('content', 'mensaje', 'message')), '33 · Customer 360 no guarda mensajes');
  perform tests.ok((select count(*) = 1 from public.cc_cartera where profile_id = dA and seller_profile_id = s1), '46 · la cartera no la toca C360');
  perform tests.ok((select count(*) from public.customer_events where customer_id = cA) >= 10 and (select count(*) from public.customer_notes where customer_id = cA) = 1, 'Y · eventos y notas auditados');
  perform tests.throws('delete from public.customer_events', 'APPEND_ONLY', 'Y · bitácora de cliente append-only');
end $t$;
rollback;
