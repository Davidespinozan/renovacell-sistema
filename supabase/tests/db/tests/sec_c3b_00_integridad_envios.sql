-- SEC-C3b (144) · integridad de envíos y evidencias. Paquete con SEC-C3 (143).
-- Chofer asignado: por escritura directa solo confirma su carga (despachado→en reparto) o reporta/actualiza una incidencia;
--   un envío entregado o cancelado es inmutable; "entregado" solo llega por confirmar_entrega.
-- confirmar_entrega: chofer asignado con rol vigente (desde en reparto o incidencia) o Dirección/Almacén/Empaque; la evidencia
--   debe existir en proofs/<archivo>, haberla subido el chofer del envío o quien cierra, y no ser la prueba de otro envío.
-- Cada ataque se comprueba por EFECTO: la huella de TODOS los envíos, objetos y pedidos no cambia.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing'); v_pos uuid := tests.user('pos');
  drvA uuid := tests.user('driver', 'c3b-a@t.local'); drvB uuid := tests.user('driver', 'c3b-b@t.local'); drvC uuid := tests.user('driver', 'c3b-c@t.local'); drvS uuid := tests.user('driver', 'c3b-s@t.local');
  dR uuid := tests.user('doctor', 'c3b-dr@t.local'); dE uuid := tests.user('doctor', 'c3b-de@t.local'); dB uuid := tests.user('doctor', 'c3b-db@t.local'); dC uuid := tests.user('doctor', 'c3b-dc@t.local'); dP uuid := tests.user('doctor', 'c3b-dp@t.local');
  v_nadie uuid := gen_random_uuid(); p uuid := tests.product(100); it jsonb; d uuid;
  oDesp uuid; oDesp2 uuid; oRuta uuid; oInc uuid; oEnt uuid; oCan uuid; oPor uuid; oB uuid; oBent uuid; oC uuid; oPaq uuid; oPaq2 uuid; oS uuid; oAdm uuid;
  sDesp uuid; sDesp2 uuid; sRuta uuid; sInc uuid; sEnt uuid; sCan uuid; sPor uuid; sB uuid; sBent uuid; sC uuid; sPaq uuid; sPaq2 uuid; sS uuid; sAdm uuid;
  foto text; h0 text; h1 text; t text; t2 text; n int; ts timestamptz; ine text; q text;
begin
  -- ══ ESCENARIO ════════════════════════════════════════════════════════════════════════════════
  it := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1));
  perform tests.act_as_service(); perform set_config('app.trusted', 'on', true);
  foreach d in array array[dR, dE, dB, dC] loop
    update public.profiles set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('phone', '667-' || left(d::text, 4), 'address', 'Calle ' || left(d::text, 4)) where id = d;
  end loop;
  perform set_config('app.trusted', 'off', true); perform tests.act_as_owner();
  oDesp := tests.order(dR, 'shipped', it); oDesp2 := tests.order(dR, 'shipped', it); oRuta := tests.order(dR, 'shipped', it); oInc := tests.order(dR, 'shipped', it);
  oEnt := tests.order(dE, 'delivered', it); oCan := tests.order(dE, 'cancelled', it); oPor := tests.order(dP, 'shipped', it);
  oB := tests.order(dB, 'shipped', it); oBent := tests.order(dB, 'delivered', it); oC := tests.order(dC, 'delivered', it);
  oPaq := tests.order(dB, 'shipped', it); oPaq2 := tests.order(dB, 'shipped', it); oS := tests.order(dB, 'shipped', it); oAdm := tests.order(dB, 'shipped', it);
  insert into public.shipments (order_id, driver_id, status) values (oDesp, drvA, 'despachado') returning id into sDesp;
  insert into public.shipments (order_id, driver_id, status) values (oDesp2, drvA, 'despachado') returning id into sDesp2;
  insert into public.shipments (order_id, driver_id, status, load_confirmed_at) values (oRuta, drvA, 'out_for_delivery', now() - interval '1 hour') returning id into sRuta;
  insert into public.shipments (order_id, driver_id, status, incident) values (oInc, drvA, 'incident', '{"type":"No estaba","resolved":false}') returning id into sInc;
  insert into public.shipments (order_id, driver_id, status, delivered_at, proof_image_url, received_by, ship_to) values (oEnt, drvA, 'delivered', now() - interval '1 day', 'proofs/A-ent.png', 'Recepción', '{"line1":"Original"}') returning id into sEnt;
  insert into public.shipments (order_id, driver_id, status) values (oCan, drvA, 'cancelado') returning id into sCan;
  insert into public.shipments (order_id, driver_id, status) values (oPor, drvA, 'por_despachar') returning id into sPor;
  insert into public.shipments (order_id, driver_id, status) values (oB, drvB, 'out_for_delivery') returning id into sB;
  insert into public.shipments (order_id, driver_id, status, delivered_at, proof_image_url, received_by) values (oBent, drvB, 'delivered', now(), 'proofs/B-ent.png', 'Recepción') returning id into sBent;
  insert into public.shipments (order_id, driver_id, status, delivered_at, proof_image_url, received_by) values (oC, drvC, 'delivered', now(), 'proofs/C-ent.png', 'Recepción') returning id into sC;   -- drvC: SOLO una entrega cerrada
  insert into public.shipments (order_id, carrier, tracking_number, status) values (oPaq, 'DHL', 'G1', 'in_transit') returning id into sPaq;                        -- paquetería: sin chofer
  insert into public.shipments (order_id, carrier, tracking_number, status) values (oPaq2, 'DHL', 'G2', 'in_transit') returning id into sPaq2;
  insert into public.shipments (order_id, driver_id, status) values (oS, drvS, 'out_for_delivery') returning id into sS;
  insert into public.shipments (order_id, driver_id, status) values (oAdm, drvB, 'out_for_delivery') returning id into sAdm;
  ine := 'identity/' || dB || '/ine-front.jpg';
  insert into storage.objects (bucket_id, name, owner, owner_id) values
    ('proofs', 'proofs/A-ent.png', drvA, drvA::text), ('proofs', 'proofs/A-nueva.png', drvA, drvA::text), ('proofs', 'proofs/A-otra.png', null, drvA::text),
    ('proofs', 'proofs/B-ent.png', drvB, drvB::text), ('proofs', 'proofs/B-suelta.png', drvB, drvB::text), ('proofs', 'proofs/B-dos.png', drvB, drvB::text), ('proofs', 'proofs/C-ent.png', drvC, drvC::text),
    ('proofs', 'proofs/admin.png', v_admin, v_admin::text), ('proofs', 'proofs/sub/anidada.png', drvA, drvA::text),
    ('proofs', ine, null, null), ('proofs', 'transfers/' || oB || '/1.jpg', null, null), ('media', 'proofs/A-media.png', drvA, drvA::text);
  perform tests.suspender(drvS);
  foto := $f$select md5(coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.shipments s), '') || '#'
                     || coalesce((select string_agg(o.bucket_id || '/' || o.name || ':' || coalesce(o.owner::text, '') || ':' || coalesce(o.owner_id, '') || ':' || coalesce(o.metadata::text, ''), '|' order by o.bucket_id, o.name) from storage.objects o), '') || '#'
                     || coalesce((select string_agg(x.id::text || x.status || coalesce(x.doctor_id::text, ''), '|' order by x.id) from public.orders x), ''))$f$;
  execute foto into h0;

  -- ══ ESTRUCTURA ═══════════════════════════════════════════════════════════════════════════════
  perform tests.ok(md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) = 'b1e791b99ca8043cb1e2913e0b294600' and md5(pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure)) = '3da25f3db1514408463b5fb38f61d0b6'
               and md5(pg_get_functiondef('public._sec_c3b_proteger_evidencia()'::regprocedure)) = '668040eb39bb13f44578d83716255b92', 'C3b · candado, cierre y protector de evidencia en su versión SEC-C3b (md5)');
  perform tests.ok((select count(*) = 3 and bool_and(proowner = 'postgres'::regrole and prosecdef and proconfig = array['search_path=public']) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('shipments_guard', 'confirmar_entrega', '_sec_c3b_proteger_evidencia'))
               and has_function_privilege('authenticated', 'public.confirmar_entrega(uuid,text,text)', 'execute') and not has_function_privilege('anon', 'public.confirmar_entrega(uuid,text,text)', 'execute')
               and not has_function_privilege('authenticated', 'public._sec_c3b_proteger_evidencia()', 'execute'), 'C3b · una firma cada una, dueño postgres, SECURITY DEFINER, search_path fijo; mismos permisos de confirmar_entrega');
  perform tests.ok((select indisunique and indisvalid and indpred is not null from pg_index where indexrelid = 'public.shipments_proof_unica'::regclass)
               and (select count(*) = 1 from pg_trigger where tgrelid = 'storage.objects'::regclass and tgname = 'sec_c3b_proteger_evidencia' and tgtype = 27 and tgenabled = 'O'), 'C3b · índice único de evidencia y disparador de proofs instalados');
  perform tests.ok((select string_agg(t.tgname || ':' || t.tgtype, ',' order by t.tgname) from pg_trigger t where t.tgrelid = 'public.shipments'::regclass and not t.tgisinternal) = 'shipments_audit_trigger:21,shipments_guard_trg:19'
               and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shipments') = 4, 'C3b · shipments conserva sus dos disparadores y sus cuatro políticas');

  -- ══ ATAQUES DEL CHOFER POR ESCRITURA DIRECTA (PostgREST) ═════════════════════════════════════
  perform tests.act_as(drvA);
  -- INV-1 · entrega cerrada: ni reabrir, ni tocar nada
  foreach t in array array['despachado', 'out_for_delivery', 'incident', 'por_despachar', 'in_transit', 'delivered'] loop
    perform tests.sin_efecto(format('update public.shipments set status = %L where id = %L', t, sEnt), foto, h0, 'C3b · ataque · reabrir la entrega cerrada (→ ' || t || '): sin efecto');
  end loop;
  perform tests.throws(format('update public.shipments set status = %L where id = %L', 'despachado', sEnt), 'ENVIO_CERRADO', 'C3b · reabrir se rechaza con ENVIO_CERRADO');
  perform tests.ok((select meta ->> 'phone' is null and meta ->> 'address' is null from public.doctor_directory where id = dE), 'C3b · tras intentar reabrir, el chofer NO recupera teléfono ni dirección del doctor');
  foreach q in array array[
      format('update public.shipments set proof_image_url = null where id = %L', sEnt),
      format('update public.shipments set proof_image_url = %L where id = %L', 'proofs/A-nueva.png', sEnt),
      format('update public.shipments set proof_image_url = %L where id = %L', 'proofs/B-ent.png', sEnt),
      format('update public.shipments set received_by = %L where id = %L', 'Otro', sEnt),
      format('update public.shipments set delivered_at = now() - interval %L where id = %L', '9 days', sEnt),
      format('update public.shipments set ship_to = %L where id = %L', '{"line1":"Falsa"}', sEnt),
      format('update public.shipments set incident = %L where id = %L', '{"type":"x"}', sEnt),
      format('update public.shipments set load_confirmed_at = now() where id = %L', sEnt),
      format('update public.shipments set status = status where id = %L', sEnt),
      format('update public.shipments set status = %L where id = %L', 'out_for_delivery', sCan),
      format('update public.shipments set incident = %L, status = %L where id = %L', '{"type":"x"}', 'incident', sCan)] loop
    perform tests.sin_efecto(q, foto, h0, 'C3b · ataque · entrega cerrada o cancelada inmutable: ' || left(regexp_replace(q, '^update public.shipments set ', ''), 60));
  end loop;
  -- INV-4/INV-5 · envío ACTIVO: la evidencia y todo lo demás no se escriben a mano
  foreach q in array array[
      format('update public.shipments set proof_image_url = %L where id = %L', 'proofs/B-suelta.png', sRuta),
      format('update public.shipments set proof_image_url = %L where id = %L', 'proofs/B-ent.png', sRuta),
      format('update public.shipments set proof_image_url = %L where id = %L', 'proofs/A-nueva.png', sRuta),
      format('update public.shipments set proof_image_url = %L where id = %L', ine, sRuta),
      format('update public.shipments set order_id = %L where id = %L', oB, sRuta),
      format('update public.shipments set driver_id = %L where id = %L', drvB, sRuta),
      format('update public.shipments set driver_id = null where id = %L', sRuta),
      format('update public.shipments set carrier = %L, tracking_number = %L where id = %L', 'DHL', 'X', sRuta),
      format('update public.shipments set ship_to = %L where id = %L', '{"line1":"Falsa"}', sRuta),
      format('update public.shipments set received_by = %L, delivered_at = now() where id = %L', 'Yo', sRuta),
      format('update public.shipments set estimated_delivery_at = now(), dispatched_by = %L, dispatched_at = now() where id = %L', 'x', sRuta),
      format('update public.shipments set provider_meta = %L, package = %L, customer_charge = 1, provider_cost = 1 where id = %L', '{}', '{}', sRuta),
      format('update public.shipments set label_url = %L, label_path = %L where id = %L', 'x', 'x', sRuta),
      format('update public.shipments set id = gen_random_uuid() where id = %L', sRuta),
      format('update public.shipments set created_at = now() - interval %L where id = %L', '1 year', sRuta),
      -- "entregado" por escritura directa, con o sin evidencia
      format('update public.shipments set status = %L where id = %L', 'delivered', sRuta),
      format('update public.shipments set status = %L, delivered_at = now(), proof_image_url = %L, received_by = %L where id = %L', 'delivered', 'proofs/A-nueva.png', 'Yo', sRuta),
      -- transiciones que no son del chofer
      format('update public.shipments set status = %L where id = %L', 'cancelado', sRuta),
      format('update public.shipments set status = %L where id = %L', 'despachado', sRuta),
      format('update public.shipments set status = %L where id = %L', 'por_despachar', sRuta),
      format('update public.shipments set status = %L where id = %L', 'in_transit', sRuta),
      format('update public.shipments set status = %L where id = %L', 'cualquiera', sRuta),
      format('update public.shipments set status = %L where id = %L', 'incident', sRuta),                                   -- incidencia SIN datos de incidencia
      format('update public.shipments set incident = %L where id = %L', '{"type":"x"}', sRuta),                            -- incidencia sin pasar a incidencia
      format('update public.shipments set status = %L, incident = %L, load_confirmed_at = now() where id = %L', 'incident', '{"type":"x"}', sRuta),
      format('update public.shipments set status = %L where id = %L', 'out_for_delivery', sInc),                           -- resolver la incidencia es de Dirección/Almacén
      format('update public.shipments set status = %L, incident = %L where id = %L', 'out_for_delivery', '{"resolved":true}', sInc),
      format('update public.shipments set status = %L where id = %L', 'despachado', sInc),
      format('update public.shipments set status = %L where id = %L', 'out_for_delivery', sPor),                            -- Almacén aún no despacha
      format('update public.shipments set status = %L where id = %L', 'despachado', sPor),
      format('update public.shipments set status = %L, incident = %L where id = %L', 'incident', '{"type":"x"}', sPor),
      format('update public.shipments set status = %L, incident = %L where id = %L', 'out_for_delivery', '{"type":"x"}', sDesp),   -- confirmar carga colando una incidencia
      -- envíos ajenos y altas
      format('update public.shipments set status = %L, incident = %L where id = %L', 'incident', '{"type":"x"}', sB),
      format('update public.shipments set driver_id = %L where id = %L', drvA, sB),
      format('update public.shipments set driver_id = %L where id = %L', drvA, sPaq),
      format('insert into public.shipments (order_id, driver_id, status) values (%L, %L, %L)', oB, drvA, 'out_for_delivery'),
      format('delete from public.shipments where id = %L', sEnt),
      format('update public.orders set doctor_id = %L where id = %L', dB, oRuta),
      format('update public.orders set status = %L where id = %L', 'delivered', oRuta)] loop
    perform tests.sin_efecto(q, foto, h0, 'C3b · ataque · ' || left(regexp_replace(q, '^(update|insert into|delete from) public\.', ''), 78));
  end loop;
  perform tests.throws(format('update public.shipments set proof_image_url = %L where id = %L', 'proofs/B-suelta.png', sRuta), 'No autorizado', 'C3b · cambiar la evidencia a mano se rechaza con error (no en silencio)');
  perform tests.throws(format('update public.shipments set status = %L where id = %L', 'delivered', sRuta), 'TRANSICION_NO_PERMITIDA', 'C3b · "entregado" por escritura directa se rechaza: solo confirmar_entrega cierra');
  perform tests.ok(not exists (select 1 from storage.objects where bucket_id = 'proofs' and name in ('proofs/B-suelta.png', 'proofs/B-ent.png', 'proofs/C-ent.png', ine)), 'C3b · tras los intentos, el chofer A sigue sin leer fotos ajenas ni la INE');
  -- evidencia registrada: ni borrar, ni mover, ni reemplazar
  foreach q in array array['delete from storage.objects where bucket_id = ''proofs'' and name = ''proofs/A-ent.png''',
      'update storage.objects set name = ''proofs/A-movida.png'' where bucket_id = ''proofs'' and name = ''proofs/A-ent.png''',
      'update storage.objects set metadata = ''{"size":1}'' where bucket_id = ''proofs'' and name = ''proofs/A-ent.png''',
      'update storage.objects set bucket_id = ''media'' where bucket_id = ''proofs'' and name = ''proofs/A-ent.png''',
      'delete from storage.objects where bucket_id = ''proofs'' and name in (''proofs/B-ent.png'', ''proofs/B-suelta.png'')'] loop
    perform tests.sin_efecto(q, foto, h0, 'C3b · ataque · evidencia: ' || left(q, 70));
  end loop;
  -- chofer con SOLO una entrega cerrada: no reabre, no recupera contacto ni permiso de subida
  perform tests.act_as(drvC);
  perform tests.sin_efecto(format('update public.shipments set status = %L, proof_image_url = %L where id = %L', 'in_transit', 'proofs/B-ent.png', sC), foto, h0, 'C3b · ataque · chofer con solo entregas cerradas no reabre');
  perform tests.sin_efecto('insert into storage.objects (bucket_id, name, owner, owner_id) values (''proofs'', ''proofs/c-nueva.png'', auth.uid(), auth.uid()::text)', foto, h0, 'C3b · ataque · ni recupera el permiso de subir');
  perform tests.ok((select meta ->> 'phone' is null from public.doctor_directory where id = dC) and not exists (select 1 from storage.objects where name = 'proofs/B-ent.png'), 'C3b · ni el contacto del doctor, ni la foto de otro');

  -- ══ ATAQUES POR LA FUNCIÓN DE ENTREGA ════════════════════════════════════════════════════════
  perform tests.act_as(drvA);
  foreach t in array array['proofs/B-suelta.png', 'proofs/B-ent.png', 'proofs/A-ent.png', 'proofs/no-existe.png', ine, 'transfers/' || oB || '/1.jpg', 'proofs/sub/anidada.png',
                           'proofs/../' || ine, 'proofs/admin.png', 'proofs/A-media.png', 'A-nueva.png', 'data:image/png;base64,AAAA', 'https://x.test/a.png', 'proofs/A-NUEVA.png'] loop
    perform tests.sin_efecto(format('select public.confirmar_entrega(%L, %L, %L)', sRuta, t, 'Recepción'), foto, h0, 'C3b · ataque · cierre con evidencia inválida (' || left(t, 34) || '): sin efecto');
  end loop;
  begin perform public.confirmar_entrega(sRuta, 'proofs/B-suelta.png', 'R'); exception when others then t := sqlerrm; end;
  begin perform public.confirmar_entrega(sRuta, 'proofs/no-existe.png', 'R'); exception when others then t2 := sqlerrm; end;
  perform tests.ok(t like 'EVIDENCIA_INVALIDA%' and t = t2, 'C3b · foto ajena e inexistente responden IGUAL (no se revela que el archivo de otro existe)');
  perform tests.throws(format('select public.confirmar_entrega(%L, %L, %L)', sRuta, 'proofs/A-ent.png', 'R'), 'EVIDENCIA_INVALIDA', 'C3b · reutilizar la prueba de otra entrega propia: rechazado');
  foreach q in array array[
      format('select public.confirmar_entrega(%L, %L, %L)', sB, 'proofs/A-nueva.png', 'R'),            -- envío de otro chofer
      format('select public.confirmar_entrega(%L, %L, %L)', sPaq, null, 'R'),                          -- envío sin chofer (la función ya lo rechaza por sí misma)
      format('select public.confirmar_entrega(%L, %L, %L)', sDesp, 'proofs/A-nueva.png', 'R'),         -- sin confirmar la carga
      format('select public.confirmar_entrega(%L, %L, %L)', sPor, 'proofs/A-nueva.png', 'R'),
      format('select public.confirmar_entrega(%L, %L, %L)', sCan, 'proofs/A-nueva.png', 'R'),          -- cancelado
      format('select public.confirmar_entrega(%L, %L, %L)', sRuta, 'proofs/A-nueva.png', '   '),       -- sin receptor
      format('select public.confirmar_entrega(%L, %L, %L)', sEnt, 'proofs/A-nueva.png', 'Otro'),       -- ya entregado: no cambia evidencia ni receptor
      format('select public.confirmar_entrega(%L, %L, %L)', gen_random_uuid(), null, 'R')] loop
    perform tests.sin_efecto(q, foto, h0, 'C3b · ataque · ' || left(replace(q, 'select public.', ''), 80));
  end loop;
  perform tests.throws(format('select public.confirmar_entrega(%L, null, %L)', sB, 'R'), 'No tienes permiso', 'C3b · cerrar el envío de otro chofer: rechazado');
  perform tests.throws(format('select public.confirmar_entrega(%L, %L, %L)', sDesp, 'proofs/A-nueva.png', 'R'), 'ESTADO_INVALIDO', 'C3b · entregar sin haber confirmado la carga: rechazado');
  perform tests.throws(format('select public.confirmar_entrega(%L, %L, %L)', sCan, 'proofs/A-nueva.png', 'R'), 'ENVIO_CANCELADO', 'C3b · entregar un envío cancelado: rechazado');
  perform tests.lives(format('select public.confirmar_entrega(%L, %L, %L)', sEnt, 'proofs/A-nueva.png', 'Otro'), 'C3b · repetir sobre un envío ya entregado responde bien (idempotente)…');
  perform tests.act_as_owner(); execute foto into h1; perform tests.ok(h1 = h0, 'C3b · …y no cambió evidencia, receptor ni fecha');
  -- El envío SIN chofer: nadie fuera de Dirección/Almacén/Empaque lo cierra, y lo rechaza la propia función (NULL-safe)
  foreach d in array array[dR, v_nadie, v_pos, drvB] loop
    perform tests.act_as(d);
    perform tests.sin_efecto(format('select public.confirmar_entrega(%L, null, %L)', sPaq, 'R'), foto, h0, 'C3b · ataque · envío sin chofer cerrado por ' || case d when dR then 'un doctor' when v_nadie then 'una cuenta sin perfil' when v_pos then 'Ventas' else 'un chofer ajeno' end || ': sin efecto');
  end loop;
  perform tests.act_as(v_nadie); perform tests.throws(format('select public.confirmar_entrega(%L, null, %L)', sPaq, 'R'), 'No tienes permiso', 'C3b · cuenta sin perfil: rechazo explícito');
  perform tests.act_as_service(); perform tests.sin_efecto(format('select public.confirmar_entrega(%L, null, %L)', sPaq, 'R'), foto, h0, 'C3b · service_role no cierra entregas por esta función (efecto documentado)');
  perform tests.act_as_anon(); perform tests.throws(format('select public.confirmar_entrega(%L, null, %L)', sPaq, 'R'), 'permission denied', 'C3b · anon no ejecuta confirmar_entrega');
  perform tests.act_as(drvS); perform tests.throws(format('select public.confirmar_entrega(%L, null, %L)', sS, 'R'), 'CUENTA_SUSPENDIDA', 'C3b · chofer suspendido: no cierra ni su propio envío');
  perform tests.sin_efecto(format('update public.shipments set status = %L, incident = %L where id = %L', 'incident', '{"type":"x"}', sS), foto, h0, 'C3b · chofer suspendido: tampoco escribe su envío');
  -- chofer degradado: sigue asignado pero ya no tiene el rol
  perform tests.act_as_owner(); perform set_config('app.trusted', 'on', true); update public.profiles set role_id = 'doctor' where id = drvC; perform set_config('app.trusted', 'off', true);
  execute foto into h0;

  -- ══ FLUJOS LEGÍTIMOS ═════════════════════════════════════════════════════════════════════════
  perform tests.act_as(drvA);
  perform tests.ok((select count(*) from public.shipments) = 7, 'C3b · positivo · el chofer consulta sus envíos (y solo los suyos)');
  ts := now();
  update public.shipments set status = 'out_for_delivery', load_confirmed_at = ts where id = sDesp; get diagnostics n = row_count;
  perform tests.ok(n = 1 and (select status = 'out_for_delivery' and load_confirmed_at = ts from public.shipments where id = sDesp), 'C3b · positivo · confirma su carga (despachado → en reparto)');
  update public.shipments set status = 'out_for_delivery', load_confirmed_at = ts + interval '1 hour' where id = sDesp;
  perform tests.ok((select load_confirmed_at = ts from public.shipments where id = sDesp), 'C3b · positivo · reintentar "confirmar carga" no falla ni cambia la hora original');
  update public.shipments set status = 'incident', incident = '{"type":"Faltan piezas","resolved":false}' where id = sDesp2;
  perform tests.ok((select status = 'incident' and incident ->> 'type' = 'Faltan piezas' from public.shipments where id = sDesp2), 'C3b · positivo · reporta un problema con la carga (despachado → incidencia)');
  update public.shipments set status = 'incident', incident = '{"type":"No estaba","note":"1er intento","resolved":false}' where id = sRuta;
  update public.shipments set status = 'incident', incident = '{"type":"No estaba","note":"2do intento","resolved":false}' where id = sRuta;
  perform tests.ok((select status = 'incident' and incident ->> 'note' = '2do intento' from public.shipments where id = sRuta), 'C3b · positivo · reporta y actualiza una incidencia en reparto');
  perform tests.ok((select meta ->> 'phone' is not null and meta ->> 'address' is not null from public.doctor_directory where id = dR), 'C3b · positivo · durante la incidencia conserva el contacto del doctor (143 ajustada)');
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('proofs', 'proofs/A-inc.png', drvA, drvA::text);
  perform tests.ok(exists (select 1 from storage.objects where name = 'proofs/A-inc.png'), 'C3b · positivo · durante la incidencia puede subir evidencia (143 ajustada)');
  -- Almacén resuelve la incidencia; Dirección y Almacén conservan sus escrituras
  perform tests.act_as(v_wh);
  update public.shipments set status = 'out_for_delivery', incident = '{"type":"No estaba","resolved":true}' where id = sRuta; get diagnostics n = row_count;
  perform tests.ok(n = 1 and (select status = 'out_for_delivery' from public.shipments where id = sRuta), 'C3b · positivo · Almacén resuelve la incidencia (incidencia → en reparto)');
  update public.shipments set status = 'despachado', dispatched_by = 'Alberto', dispatched_at = now() where id = sPor; get diagnostics n = row_count;
  perform tests.ok(n = 1 and (select status = 'despachado' from public.shipments where id = sPor), 'C3b · positivo · Almacén despacha la carga al chofer');
  -- cierre legítimo con foto propia
  perform tests.act_as(drvA);
  perform public.confirmar_entrega(sRuta, 'proofs/A-nueva.png', 'Dra. Pérez');
  perform tests.act_as_owner();
  perform tests.ok((select status = 'delivered' and proof_image_url = 'proofs/A-nueva.png' and received_by = 'Dra. Pérez' and delivered_at is not null and driver_id = drvA and order_id = oRuta from public.shipments where id = sRuta)
               and (select status = 'delivered' from public.orders where id = oRuta), 'C3b · positivo · el chofer cierra su entrega por la función: envío y pedido entregados, evidencia registrada');
  perform tests.ok(coalesce(current_setting('app.sec_c3b_entrega', true), '') = '' and coalesce(current_setting('app.trusted', true), 'off') = 'off', 'C3b · la función retira sus marcas al terminar');
  perform tests.act_as(drvA);
  perform tests.lives(format('select public.confirmar_entrega(%L, %L, %L)', sRuta, 'proofs/A-nueva.png', 'Dra. Pérez'), 'C3b · positivo · reintento idéntico del cierre: responde bien');
  perform tests.lives(format('select public.confirmar_entrega(%L, %L, %L)', sRuta, 'proofs/A-inc.png', 'Otra persona'), 'C3b · reintento con OTRA evidencia y receptor: responde bien…');
  perform tests.ok((select proof_image_url = 'proofs/A-nueva.png' and received_by = 'Dra. Pérez' from public.shipments where id = sRuta), 'C3b · …y conserva la evidencia y el receptor originales');
  perform tests.ok(exists (select 1 from storage.objects where name = 'proofs/A-nueva.png'), 'C3b · positivo · el chofer sigue viendo la prueba de su entrega');
  delete from storage.objects where bucket_id = 'proofs' and name = 'proofs/A-nueva.png'; get diagnostics n = row_count;
  perform tests.ok(n = 0 and exists (select 1 from storage.objects where name = 'proofs/A-nueva.png'), 'C3b · …pero ya no puede borrarla');
  perform tests.throws(format('update public.shipments set proof_image_url = null where id = %L', sRuta), 'ENVIO_CERRADO', 'C3b · ni quitarle la referencia para borrarla después');
  -- la misma foto no sirve para otra entrega; entregar con incidencia abierta y sin foto sí
  perform tests.throws(format('select public.confirmar_entrega(%L, %L, %L)', sDesp, 'proofs/A-nueva.png', 'R'), 'EVIDENCIA_INVALIDA', 'C3b · la evidencia ya usada no cierra otra entrega');
  perform public.confirmar_entrega(sInc, null, 'Recepción (sin foto: cámara dañada)');
  perform tests.ok((select status = 'delivered' and proof_image_url is null from public.shipments where id = sInc), 'C3b · positivo · entrega con incidencia abierta y sin foto (flujo "sin foto" de la app)');
  perform tests.ok((select count(*) = 0 from public.doctor_directory where id = dR and meta ->> 'phone' is null), 'C3b · positivo · con otros envíos en curso al mismo doctor, conserva el contacto');
  perform public.confirmar_entrega(sDesp, 'proofs/A-inc.png', 'Recepción');
  perform tests.act_as(v_admin); update public.shipments set status = 'cancelado' where id in (sDesp2, sPor);
  perform tests.act_as(drvA);
  perform tests.ok((select meta ->> 'phone' is null and meta ->> 'address' is null from public.doctor_directory where id = dR), 'C3b · positivo · sin envíos en curso (entregados o cancelados), el chofer deja de recibir el contacto');
  perform tests.throws('insert into storage.objects (bucket_id, name, owner, owner_id) values (''proofs'', ''proofs/tarde.png'', auth.uid(), auth.uid()::text)', 'row-level security', 'C3b · y deja de poder subir');
  -- roles de oficina sobre la evidencia y las entregas
  perform tests.act_as(v_wh);
  perform tests.ok((select count(*) = 2 from storage.objects where name in ('proofs/A-nueva.png', 'proofs/A-inc.png')), 'C3b · positivo · Almacén ve las pruebas de las entregas (Seguimiento)');
  perform public.confirmar_entrega(sPaq, null, 'Recibió paquetería');
  perform tests.ok((select status = 'delivered' from public.shipments where id = sPaq), 'C3b · positivo · Almacén cierra un envío de paquetería (sin chofer, sin foto)');
  perform tests.act_as(v_pk);
  perform public.confirmar_entrega(sB, 'proofs/B-suelta.png', 'Recepción');
  perform tests.ok((select status = 'delivered' and proof_image_url = 'proofs/B-suelta.png' from public.shipments where id = sB), 'C3b · positivo · Empaque cierra el envío de un chofer con la foto que subió ESE chofer');
  perform tests.throws(format('select public.confirmar_entrega(%L, %L, %L)', sAdm, 'proofs/A-otra.png', 'R'), 'EVIDENCIA_INVALIDA', 'C3b · pero no con la foto de un chofer que no es el del envío');
  perform tests.act_as(v_admin);
  perform public.confirmar_entrega(sAdm, 'proofs/admin.png', 'Recepción');
  perform tests.ok((select proof_image_url = 'proofs/admin.png' from public.shipments where id = sAdm), 'C3b · positivo · Dirección cierra con una foto subida por Dirección');
  update public.shipments set received_by = 'Corrección de Dirección' where id = sEnt; get diagnostics n = row_count;
  perform tests.ok(n = 1 and (select received_by = 'Corrección de Dirección' from public.shipments where id = sEnt), 'C3b · positivo · Dirección conserva la corrección administrativa de una entrega cerrada');
  perform tests.throws(format('update public.shipments set proof_image_url = %L where id = %L', 'proofs/A-nueva.png', sEnt), 'shipments_proof_unica', 'C3b · ni Dirección asigna la misma evidencia a dos envíos (índice único)');
  -- chofer degradado (drvC ya es doctor): asignado, pero sin rol vigente
  perform tests.act_as_owner(); insert into public.shipments (order_id, driver_id, status) values (tests.order(dB, 'shipped', it), drvC, 'out_for_delivery') returning id into sPaq2; execute foto into h0;
  perform tests.act_as(drvC);
  perform tests.sin_efecto(format('select public.confirmar_entrega(%L, null, %L)', sPaq2, 'R'), foto, h0, 'C3b · ataque · asignado pero ya sin rol de chofer: no cierra');
  perform tests.sin_efecto(format('update public.shipments set status = %L, incident = %L where id = %L', 'incident', '{"type":"x"}', sPaq2), foto, h0, 'C3b · ataque · ni escribe el envío');
  -- el protector de evidencia: service_role y Dirección sí; una actualización que no toca nada material, también
  -- Se simula lo que una carrera le haría a las políticas (dejar pasar la fila): con políticas abiertas SOLO dentro de esta
  -- transacción, el disparador debe sostener la regla por sí mismo.
  perform tests.act_as_owner();
  create policy _c3b_tmp_del on storage.objects for delete to authenticated using (bucket_id = 'proofs');
  create policy _c3b_tmp_upd on storage.objects for update to authenticated using (bucket_id = 'proofs') with check (true);
  execute foto into h0;
  perform tests.act_as(drvB);
  perform tests.throws('delete from storage.objects where bucket_id = ''proofs'' and name = ''proofs/B-suelta.png''', 'EVIDENCIA_PROTEGIDA', 'C3b · protector: aunque la política dejara pasar la fila, el autor no borra una prueba registrada');
  perform tests.throws('update storage.objects set name = ''proofs/B-x.png'' where bucket_id = ''proofs'' and name = ''proofs/B-suelta.png''', 'EVIDENCIA_PROTEGIDA', 'C3b · protector: ni la renombra');
  perform tests.throws('update storage.objects set metadata = ''{"size":2}'', owner = null where bucket_id = ''proofs'' and name = ''proofs/B-suelta.png''', 'EVIDENCIA_PROTEGIDA', 'C3b · protector: ni reemplaza su contenido o su autoría');
  perform tests.act_as(v_wh);
  perform tests.throws('delete from storage.objects where bucket_id = ''proofs'' and name = ''proofs/A-nueva.png''', 'EVIDENCIA_PROTEGIDA', 'C3b · protector: tampoco Almacén');
  update storage.objects set last_accessed_at = now(), updated_at = now() where bucket_id = 'proofs' and name = 'proofs/A-nueva.png'; get diagnostics n = row_count;
  perform tests.ok(n = 1, 'C3b · protector: una actualización que solo toca marcas de acceso no se bloquea (no estorba a Storage)');
  perform tests.act_as(drvB);
  delete from storage.objects where bucket_id = 'proofs' and name = 'proofs/B-dos.png'; get diagnostics n = row_count;
  perform tests.ok(n = 1, 'C3b · protector: un archivo que NO es prueba de ningún envío no se ve afectado');
  delete from storage.objects where bucket_id = 'media' and name = 'proofs/A-media.png';
  perform tests.act_as_owner(); insert into storage.objects (bucket_id, name, owner, owner_id) values ('proofs', 'proofs/B-dos.png', drvB, drvB::text);
  perform tests.sin_efecto('select 1', foto, h0, 'C3b · protector: tras los intentos, envíos y evidencias registradas intactos');
  perform tests.act_as_service();
  update storage.objects set metadata = '{"size":3}' where bucket_id = 'proofs' and name = 'proofs/A-inc.png'; get diagnostics n = row_count;
  perform tests.ok(n = 1, 'C3b · protector: service_role (procesos de servidor) no se ve afectado');
  perform tests.act_as(v_admin);
  delete from storage.objects where bucket_id = 'proofs' and name = 'proofs/admin.png'; get diagnostics n = row_count;
  perform tests.ok(n = 1, 'C3b · protector: Dirección conserva la facultad de retirar una evidencia (flujo administrativo, queda en bitácora de Storage)');
  perform tests.act_as_owner();
  drop policy _c3b_tmp_del on storage.objects; drop policy _c3b_tmp_upd on storage.objects;
  -- Cada cambio de envío queda en la bitácora
  perform tests.ok((select count(*) > 0 from public.audit_logs where resource_type = 'shipments' and resource_id = sRuta::text and action like 'UPDATE%' and payload ->> 'status' = 'delivered'),
    'C3b · el cierre queda en la bitácora de auditoría');
end $t$;
rollback;
