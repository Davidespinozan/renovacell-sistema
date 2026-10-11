-- SEC-C3 (143) · directorios y bucket proofs autorizan por LISTA EXPLÍCITA y por vínculo real en la base.
-- doctor_directory: filas para roles internos (el chofer, solo los doctores de sus envíos); contacto solo Dirección,
--   Ventas con cartera VALIDADA de ese doctor, o chofer con un envío suyo EN CURSO a ese doctor.
-- staff_directory: solo roles internos. Sin perfil, doctor (verificado o no), anon: nada. Suspendido: CUENTA_SUSPENDIDA.
-- proofs: identity/ y transfers/ solo oficina (sin cambio); proofs/ solo si es la prueba de un envío que el usuario ve, o
--   si el chofer la subió; subir solo a proofs/<archivo> (Dirección o chofer con envío en curso); una prueba ya registrada
--   no la modifica ni la borra su autor. El prefijo del path no autoriza por sí solo.
begin;
create temp table r (quien text, k text, v text) on commit drop;
create temp table esp (quien text, k text, v text) on commit drop;
grant all on r to public;
do $t$
#variable_conflict use_column
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_comm uuid := tests.user('comm'); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing');
  posV uuid := tests.user('pos', 'c3-posv@t.local'); posW uuid := tests.user('pos', 'c3-posw@t.local'); posX uuid := tests.user('pos', 'c3-posx@t.local'); posS uuid := tests.user('pos', 'c3-poss@t.local');
  drvA uuid := tests.user('driver', 'c3-drva@t.local'); drvB uuid := tests.user('driver', 'c3-drvb@t.local'); drvC uuid := tests.user('driver', 'c3-drvc@t.local');
  dCart uuid := tests.user('doctor', 'c3-dcart@t.local'); dShip uuid := tests.user('doctor', 'c3-dship@t.local'); dDel uuid := tests.user('doctor', 'c3-ddel@t.local');
  dOtro uuid := tests.user('doctor', 'c3-dotro@t.local'); dU uuid := tests.user('doctor', 'c3-du@t.local'); dCanc uuid := tests.user('doctor', 'c3-dcanc@t.local'); v_nadie uuid := gen_random_uuid();
  docs uuid[]; p uuid := tests.product(100); oShip uuid; oDel uuid; oB uuid; oCanc uuid; d uuid; n_staff int; n_obj int; n_ship int; n_prof int;
  quienes text[]; uids uuid[]; i int; q text; v text; v2 text; x text;
  todo text := 'INE,entrega-A,entrega-B,huerfana,soloid-A,suelta-A,transferencia';
begin
  -- ══ ESCENARIO ════════════════════════════════════════════════════════════════════════════════
  docs := array[dCart, dShip, dDel, dOtro, dU, dCanc];
  perform tests.act_as_service(); perform set_config('app.trusted', 'on', true);
  foreach d in array docs loop
    update public.profiles set organization = 'Clínica ' || left(d::text, 4),
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('phone', '667-' || left(d::text, 4), 'address', 'Calle ' || left(d::text, 4), 'city', 'Culiacán',
                                                             'specialty', 'Dermatología', 'cedula', 'CED-' || left(d::text, 4), 'rfc', 'RFC-SECRETO') where id = d;
  end loop;
  update public.profiles set verified = false where id = dU;                                   -- alta pública sin verificar
  perform set_config('app.trusted', 'off', true);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dCart, posV), (dOtro, posW);   -- carteras VALIDADAS
  -- posX "es" el vendedor de dOtro según Odoo y comparte su correo en el directorio de clientes: nada de eso autoriza.
  insert into public.customers (full_name, email, phone, source, seller_name, profile_id)
    values ('Homónimo Odoo', (select email from public.profiles where id = posX), '667-0000', 'odoo', 'c3-posx', dOtro);
  perform tests.act_as_owner();
  oShip := tests.order(dShip, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  oDel  := tests.order(dDel,  'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  oB    := tests.order(dOtro, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  oCanc := tests.order(dCanc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  -- drvA: un envío EN CURSO (dShip) cuyo campo de prueba apunta —maliciosamente— a una INE; uno entregado (dDel); uno cancelado (dCanc).
  insert into public.shipments (order_id, driver_id, status, proof_image_url) values (oShip, drvA, 'despachado', 'identity/' || dCart || '/ine-front.jpg');
  insert into public.shipments (order_id, driver_id, status, delivered_at, proof_image_url, received_by) values (oDel, drvA, 'delivered', now(), 'proofs/entrega-A.png', 'Recepción');
  insert into public.shipments (order_id, driver_id, status) values (oCanc, drvA, 'cancelado');
  -- drvB: solo un envío ya entregado (dOtro). drvC: ninguno.
  insert into public.shipments (order_id, driver_id, status, delivered_at, proof_image_url, received_by) values (oB, drvB, 'delivered', now(), 'proofs/entrega-B.png', 'Recepción');
  insert into storage.objects (bucket_id, name, owner, owner_id) values
    ('proofs', 'identity/' || dCart || '/ine-front.jpg', null, null), ('proofs', 'transfers/' || oShip || '/1.jpg', null, null),
    ('proofs', 'proofs/entrega-A.png', drvA, drvA::text), ('proofs', 'proofs/entrega-B.png', drvB, drvB::text),
    ('proofs', 'proofs/suelta-A.png', drvA, drvA::text),          -- subida por drvA, aún sin registrar en un envío
    ('proofs', 'proofs/soloid-A.png', null, drvA::text),          -- autoría solo en owner_id (Storage nuevo)
    ('proofs', 'proofs/huerfana.png', null, null);                -- sin autor y sin envío: nadie operativo la ve
  perform tests.suspender(posS);
  select count(*) into n_staff from public.profiles where role_id <> 'doctor';
  select count(*) into n_obj from storage.objects; select count(*) into n_ship from public.shipments; select count(*) into n_prof from public.profiles;

  -- ══ ESTRUCTURA ═══════════════════════════════════════════════════════════════════════════════
  perform set_config('search_path', 'public', true);
  perform tests.ok(md5(pg_get_viewdef('public.doctor_directory'::regclass)) = '54ee2e9db656f55e56670ee7478086ea' and md5(pg_get_viewdef('public.staff_directory'::regclass)) = '79409365cc8049f6db6daf37abd18e02',
    'C3 · las dos vistas son la versión SEC-C3 (md5)');
  perform tests.ok((select count(*) = 2 and bool_and(relowner = 'postgres'::regrole and reloptions = array['security_barrier=true'] and has_table_privilege('authenticated', oid, 'select')
                      and not has_table_privilege('anon', oid, 'select') and not has_table_privilege('authenticated', oid, 'insert,update,delete'))
                    from pg_class where oid in ('public.doctor_directory'::regclass, 'public.staff_directory'::regclass)),
    'C3 · mismas vistas: dueño postgres, security_barrier, authenticated solo lee, anon nada');
  perform tests.ok((select string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' order by attnum) from pg_attribute where attrelid = 'public.doctor_directory'::regclass and attnum > 0 and not attisdropped) = 'id:uuid,name:text,organization:text,verified:boolean,meta:jsonb'
               and (select string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' order by attnum) from pg_attribute where attrelid = 'public.staff_directory'::regclass and attnum > 0 and not attisdropped) = 'id:uuid,name:text,avatar_url:text,role_id:text',
    'C3 · mismas columnas y tipos (el frontend no cambia)');
  perform tests.ok((select string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by policyname) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'proofs%')
                   = 'proofs_insert:INSERT:{authenticated}:d44f6a17bd492a78d2ab9f5c6e5304aa,proofs_owner_delete:DELETE:{authenticated}:6f712015ffc47aa269fddd6b45f7a1a8,proofs_owner_write:UPDATE:{authenticated}:6f712015ffc47aa269fddd6b45f7a1a8,proofs_read:SELECT:{authenticated}:63f31185a559c5b0277167ea346ba4c0',
    'C3 · las cuatro políticas de proofs son la versión SEC-C3 (mismos nombres, comandos y rol)');
  perform tests.ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname not like 'proofs%'
                                and ((coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%bucket_id = %' or (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%proofs%')),
    'C3 · ninguna otra política de storage.objects abre el bucket proofs');
  perform tests.ok((select not public from storage.buckets where id = 'proofs'), 'C3 · el bucket proofs sigue privado');
  perform tests.ok((select count(*) = 1 and bool_and(oid = 'public._sec_c3_alcance_doctor(uuid)'::regprocedure and proowner = 'postgres'::regrole and prosecdef and provolatile = 's' and proconfig = array['search_path=public']
                      and md5(pg_get_functiondef(oid)) = 'a02824e5ebbc6d46a57504c1c9824431' and not has_function_privilege('anon', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute'))
                    from pg_proc where pronamespace = 'public'::regnamespace and proname = '_sec_c3_alcance_doctor'),
    'C3 · función auxiliar: una firma, SECURITY DEFINER, search_path fijo, sin anon');
  perform tests.ok(not exists (select 1 from pg_depend dp join pg_rewrite rw on rw.oid = dp.objid where rw.ev_class in ('public.doctor_directory'::regclass, 'public.staff_directory'::regclass)
                                and dp.refclassid = 'pg_class'::regclass and dp.refobjid in ('public.cc_cartera'::regclass, 'public.shipments'::regclass, 'public.orders'::regclass)),
    'C3 · las vistas no quedan atadas a cc_cartera, shipments ni orders (los rollbacks de otros bloques siguen corriendo)');
  perform tests.ok((select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'shipments' and policyname = 'shipments_select_scoped') = '5726c48548f6e0d9e6d69f5205bdc64b'
               and md5(pg_get_functiondef('public.auth_role()'::regprocedure)) = '663618f6d4eedf568db532bca55cddc5', 'C3 · shipments_select_scoped y auth_role() no se tocan');
  perform set_config('search_path', '"$user", public, extensions', true);

  -- ══ SONDEO POR IDENTIDAD (cada escritura de prueba se revierte dentro de su bloque) ══════════════════════════════
  quienes := array['Dirección','Facturación','Comm','Ventas con cartera de dCart','Ventas con cartera de dOtro','Ventas sin cartera (homónimo Odoo de dOtro)','Almacén','Empaque',
                   'Chofer A (en curso dShip · entregó dDel · cancelado dCanc)','Chofer B (solo entregó dOtro)','Chofer C (sin envíos)',
                   'Doctor verificado','Doctor NO verificado','Usuario suspendido','Usuario sin perfil','anon','service_role'];
  uids := array[v_admin, v_bill, v_comm, posV, posW, posX, v_wh, v_pk, drvA, drvB, drvC, dCart, dU, posS, v_nadie, null, null];
  for i in 1 .. array_length(quienes, 1) loop
    q := quienes[i];
    if q = 'anon' then perform tests.act_as_anon(); elsif q = 'service_role' then perform tests.act_as_service(); else perform tests.act_as(uids[i]); end if;
    -- doctor_directory: cuántos doctores del escenario ve, de cuáles recibe contacto, y que la forma del JSON no cambie ni filtre de más
    begin
      select count(*)::text, coalesce(string_agg(case id when dCart then 'cartera' when dShip then 'en-curso' when dDel then 'entregado' when dOtro then 'otro' when dU then 'sin-verificar' when dCanc then 'cancelado' end, ',' order by array_position(docs, id))
                                        filter (where coalesce(meta ->> 'phone', meta ->> 'address', meta ->> 'city', meta ->> 'specialty') is not null), '—'),
             case when count(*) = 0 then 'n/a'
                  when bool_and((select array_agg(k order by k) from jsonb_object_keys(meta) k) = array['address', 'city', 'phone', 'specialty']) and bool_and(to_jsonb(dd)::text !~ 'CED-|RFC-SECRETO|@t\.local') then 'ok' else 'FUGA' end
        into v, v2, x from public.doctor_directory dd where id = any (docs);
    exception when others then v := case when sqlerrm like 'permission denied%' then 'permiso denegado' else split_part(sqlerrm, ':', 1) end; v2 := v; x := v; end;
    insert into r values (q, 'médicos', v), (q, 'contacto', v2), (q, 'forma', x);
    -- un contacto parcial tampoco: o las cuatro llaves, o ninguna
    begin select count(*)::text into v from public.doctor_directory where id = any (docs) and (meta ->> 'phone' is null) <> (meta ->> 'address' is null);
    exception when others then v := 'error'; end;
    insert into r values (q, 'contacto parcial', v);
    begin select count(*)::text into v from public.staff_directory;
    exception when others then v := case when sqlerrm like 'permission denied%' then 'permiso denegado' else split_part(sqlerrm, ':', 1) end; end;
    insert into r values (q, 'personal', v);
    begin select coalesce(string_agg(case when name like 'identity/%' then 'INE' when name like 'transfers/%' then 'transferencia' else replace(replace(name, 'proofs/', ''), '.png', '') end, ',' order by name), '—') into v
            from storage.objects where bucket_id = 'proofs';
    exception when others then v := case when sqlerrm like 'permission denied%' then 'permiso denegado' else split_part(sqlerrm, ':', 1) end; end;
    insert into r values (q, 've', v);
    -- subidas
    v := 'no'; begin insert into storage.objects (bucket_id, name, owner, owner_id) values ('proofs', 'proofs/nueva-' || i || '.png', auth.uid(), auth.uid()::text); raise exception 'ZZ'; exception when others then if sqlerrm = 'ZZ' then v := 'SUBE'; end if; end;
    insert into r values (q, 'sube proofs/', v);
    v := 'no'; begin insert into storage.objects (bucket_id, name, owner, owner_id) values ('proofs', 'identity/' || dOtro || '/ine-front.jpg', auth.uid(), auth.uid()::text); raise exception 'ZZ'; exception when others then if sqlerrm = 'ZZ' then v := 'SUBE'; end if; end;
    insert into r values (q, 'sube identity/', v);
    v := 'no'; begin insert into storage.objects (bucket_id, name, owner, owner_id) values ('proofs', 'transfers/' || oB || '/falso.jpg', auth.uid(), auth.uid()::text); raise exception 'ZZ'; exception when others then if sqlerrm = 'ZZ' then v := 'SUBE'; end if; end;
    insert into r values (q, 'sube transfers/', v);
    v := 'no'; begin insert into storage.objects (bucket_id, name, owner, owner_id) values ('proofs', 'proofs/../identity/' || dOtro || '/selfie.jpg', auth.uid(), auth.uid()::text); raise exception 'ZZ'; exception when others then if sqlerrm = 'ZZ' then v := 'SUBE'; end if; end;
    insert into r values (q, 'sube anidado', v);
    v := 'no'; begin insert into storage.objects (bucket_id, name, owner, owner_id) values ('proofs', 'suelto-' || i || '.png', auth.uid(), auth.uid()::text); raise exception 'ZZ'; exception when others then if sqlerrm = 'ZZ' then v := 'SUBE'; end if; end;
    insert into r values (q, 'sube a la raíz', v);
    -- modificar / borrar
    begin with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'proofs' and name = 'proofs/entrega-B.png' returning 1) select case when count(*) > 0 then 'SÍ' else 'no' end into v from u; raise exception 'ZZ%', v; exception when others then v := case when sqlerrm like 'ZZ%' then substr(sqlerrm, 3) else 'no' end; end;
    insert into r values (q, 'modifica entrega-B', v);
    begin with u as (delete from storage.objects where bucket_id = 'proofs' and name = 'proofs/entrega-A.png' returning 1) select case when count(*) > 0 then 'SÍ' else 'no' end into v from u; raise exception 'ZZ%', v; exception when others then v := case when sqlerrm like 'ZZ%' then substr(sqlerrm, 3) else 'no' end; end;
    insert into r values (q, 'borra entrega-A', v);
    begin with u as (delete from storage.objects where bucket_id = 'proofs' and name = 'proofs/suelta-A.png' returning 1) select case when count(*) > 0 then 'SÍ' else 'no' end into v from u; raise exception 'ZZ%', v; exception when others then v := case when sqlerrm like 'ZZ%' then substr(sqlerrm, 3) else 'no' end; end;
    insert into r values (q, 'borra suelta-A', v);
    begin with u as (delete from storage.objects where bucket_id = 'proofs' and name in ('proofs/huerfana.png', 'transfers/' || oShip || '/1.jpg') returning 1) select case when count(*) > 0 then 'SÍ' else 'no' end into v from u; raise exception 'ZZ%', v; exception when others then v := case when sqlerrm like 'ZZ%' then substr(sqlerrm, 3) else 'no' end; end;
    insert into r values (q, 'borra huérfana/transferencia', v);
    begin with u as (update storage.objects set name = 'proofs/robada.png' where bucket_id = 'proofs' and name like 'identity/%' returning 1) select case when count(*) > 0 then 'SÍ' else 'no' end into v from u; raise exception 'ZZ%', v; exception when others then v := case when sqlerrm like 'ZZ%' then substr(sqlerrm, 3) else 'no' end; end;
    insert into r values (q, 'mueve INE a proofs/', v);
    perform tests.act_as_owner();
  end loop;

  -- ══ ESPERADO ═════════════════════════════════════════════════════════════════════════════════
  -- Por defecto TODO cerrado; después se abre solo lo autorizado.
  insert into esp select q2, k, case k when 'médicos' then '0' when 'contacto' then '—' when 'forma' then 'n/a' when 'contacto parcial' then '0' when 'personal' then '0' when 've' then '—' else 'no' end
    from unnest(quienes) q2, unnest(array['médicos','contacto','forma','contacto parcial','personal','ve','sube proofs/','sube identity/','sube transfers/','sube anidado','sube a la raíz',
                                         'modifica entrega-B','borra entrega-A','borra suelta-A','borra huérfana/transferencia','mueve INE a proofs/']) k;
  -- roles internos: ven a los 6 doctores (el chofer no) y todo el personal
  update esp set v = '6' where k = 'médicos' and quien in ('Dirección','Facturación','Comm','Ventas con cartera de dCart','Ventas con cartera de dOtro','Ventas sin cartera (homónimo Odoo de dOtro)','Almacén','Empaque');
  update esp set v = n_staff::text where k = 'personal' and (quien in ('Dirección','Facturación','Comm','Almacén','Empaque') or quien like 'Ventas%' or quien like 'Chofer%');
  update esp set v = '3' where k = 'médicos' and quien like 'Chofer A%';
  update esp set v = '1' where k = 'médicos' and quien like 'Chofer B%';
  update esp set v = 'ok' where k = 'forma' and v = 'n/a' and quien in (select quien from esp where k = 'médicos' and v <> '0');
  -- contacto
  update esp set v = 'cartera,en-curso,entregado,otro,sin-verificar,cancelado' where k = 'contacto' and quien = 'Dirección';
  update esp set v = 'cartera' where k = 'contacto' and quien = 'Ventas con cartera de dCart';
  update esp set v = 'otro' where k = 'contacto' and quien = 'Ventas con cartera de dOtro';
  update esp set v = 'en-curso' where k = 'contacto' and quien like 'Chofer A%';
  -- Storage
  update esp set v = todo where k = 've' and quien in ('Dirección','Facturación','Comm','service_role');
  update esp set v = 'entrega-A,entrega-B' where k = 've' and quien in ('Almacén','Empaque');
  update esp set v = 'entrega-A,soloid-A,suelta-A' where k = 've' and quien like 'Chofer A%';
  update esp set v = 'entrega-B' where k = 've' and quien like 'Chofer B%';
  update esp set v = 'SUBE' where k = 'sube proofs/' and (quien = 'Dirección' or quien like 'Chofer A%' or quien = 'service_role');
  update esp set v = 'SUBE' where k like 'sube %' and quien = 'service_role';
  update esp set v = 'SÍ' where k in ('modifica entrega-B','borra entrega-A','borra suelta-A','borra huérfana/transferencia','mueve INE a proofs/') and quien in ('Dirección','service_role');
  update esp set v = 'SÍ' where k = 'borra suelta-A' and quien like 'Chofer A%';
  -- suspendido: auth_role() lanza; anon: sin permiso sobre las vistas (y sin política en Storage → nada)
  update esp set v = 'CUENTA_SUSPENDIDA' where quien = 'Usuario suspendido' and k in ('médicos','contacto','forma','personal','ve');
  update esp set v = 'error' where quien in ('Usuario suspendido','anon') and k = 'contacto parcial';
  update esp set v = 'permiso denegado' where quien = 'anon' and k in ('médicos','contacto','forma','personal');

  for q, x, v, v2 in select e.quien, e.k, e.v, r.v from esp e left join r on r.quien = e.quien and r.k = e.k order by array_position(quienes, e.quien), e.k loop
    perform tests.eq(coalesce(v2, '<sin sondeo>'), v, 'C3 · ' || q || ' · ' || x);
  end loop;
  perform tests.ok((select count(*) from r) = (select count(*) from esp), 'C3 · cada sondeo tiene su resultado esperado (ninguno sin revisar)');

  -- ══ CASOS DIRIGIDOS ══════════════════════════════════════════════════════════════════════════
  perform tests.act_as(posV);
  perform tests.ok((select meta ->> 'phone' is not null from public.doctor_directory where id = dCart) and (select meta ->> 'phone' is null and meta ->> 'address' is null from public.doctor_directory where id = dOtro),
    'C3 · Ventas: contacto de SU cartera sí; del doctor en la cartera de OTRO vendedor no');
  perform tests.act_as(posX);
  perform tests.ok((select meta = jsonb_build_object('phone', null, 'address', null, 'city', null, 'specialty', null) from public.doctor_directory where id = dOtro),
    'C3 · ser el vendedor según Odoo o compartir correo en customers NO da contacto (solo cc_cartera)');
  perform tests.act_as(drvA);
  perform tests.ok((select meta ->> 'address' is not null from public.doctor_directory where id = dShip)
               and (select count(*) = 2 from public.doctor_directory where id in (dDel, dCanc) and meta ->> 'phone' is null and meta ->> 'address' is null)
               and not exists (select 1 from public.doctor_directory where id in (dCart, dOtro, dU)),
    'C3 · chofer: contacto solo del envío EN CURSO; entregado y cancelado, solo el nombre; doctores sin envío suyo, ni la fila');
  -- El envío en curso de drvA "declara" una INE como prueba: ni el chofer ni Almacén la ven por eso.
  perform tests.ok(not exists (select 1 from storage.objects where bucket_id = 'proofs' and name like 'identity/%'), 'C3 · una INE referenciada como "prueba" de un envío NO se vuelve legible para el chofer');
  perform tests.act_as(v_wh);
  perform tests.ok(not exists (select 1 from storage.objects where bucket_id = 'proofs' and (name like 'identity/%' or name like 'transfers/%')), 'C3 · ni para Almacén: la referencia no cruza de prefijo');
  -- Al entregarse el envío en curso, el chofer pierde el contacto y, sin otro envío en curso, deja de poder subir.
  perform tests.act_as(v_admin); update public.shipments set status = 'delivered', delivered_at = now(), proof_image_url = 'proofs/suelta-A.png' where order_id = oShip;
  perform tests.act_as(drvA);
  perform tests.ok((select meta ->> 'phone' is null from public.doctor_directory where id = dShip), 'C3 · al entregar, el chofer deja de recibir el contacto de ese doctor');
  perform tests.throws($q$insert into storage.objects (bucket_id, name, owner) values ('proofs', 'proofs/tarde.png', auth.uid())$q$, 'row-level security', 'C3 · sin envío en curso, el chofer ya no sube');
  delete from storage.objects where bucket_id = 'proofs' and name = 'proofs/suelta-A.png'; get diagnostics i = row_count;
  perform tests.ok(i = 0 and exists (select 1 from storage.objects where bucket_id = 'proofs' and name = 'proofs/suelta-A.png'),
    'C3 · una vez registrada como prueba de un envío, su autor ya no puede borrarla (y la sigue viendo)');
  perform tests.act_as(v_wh);
  perform tests.ok(exists (select 1 from storage.objects where bucket_id = 'proofs' and name = 'proofs/suelta-A.png'), 'C3 · y Almacén la ve desde que es la prueba de un envío (Seguimiento)');
  -- Una cuenta que pierde el perfil o cambia a doctor pierde todo en la siguiente consulta (no hay caché de autorización).
  perform tests.act_as_owner(); perform set_config('app.trusted', 'on', true); update public.profiles set role_id = 'doctor' where id = v_pk; perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_pk);
  perform tests.ok(not exists (select 1 from public.doctor_directory) and not exists (select 1 from public.staff_directory) and not exists (select 1 from storage.objects where bucket_id = 'proofs'),
    'C3 · un rol interno degradado a doctor pierde directorios y comprobantes de inmediato');

  -- La función llamada directamente solo informa del vínculo del PROPIO llamador, y a quien no está en la lista le dice 0.
  perform tests.act_as(v_nadie); perform tests.ok(public._sec_c3_alcance_doctor(dCart) = 0, 'C3 · alcance por llamada directa: cuenta sin perfil = 0');
  perform tests.act_as(dCart);   perform tests.ok(public._sec_c3_alcance_doctor(dCart) = 0 and public._sec_c3_alcance_doctor(dOtro) = 0, 'C3 · alcance: un doctor = 0, incluso sobre sí mismo');
  perform tests.act_as(posV);    perform tests.ok(public._sec_c3_alcance_doctor(dCart) = 2 and public._sec_c3_alcance_doctor(dOtro) = 1 and public._sec_c3_alcance_doctor(null) = 0, 'C3 · alcance: Ventas 2 en su cartera, 1 fuera; NULL = 0');
  perform tests.act_as(drvB);    perform tests.ok(public._sec_c3_alcance_doctor(dOtro) = 1 and public._sec_c3_alcance_doctor(dCart) = 0, 'C3 · alcance: chofer 1 con envío ya entregado, 0 sin envío');
  perform tests.act_as(posS);    perform tests.throws('select public._sec_c3_alcance_doctor(gen_random_uuid())', 'CUENTA_SUSPENDIDA', 'C3 · alcance: cuenta suspendida, rechazada');
  perform tests.act_as_anon();   perform tests.throws('select public._sec_c3_alcance_doctor(gen_random_uuid())', 'permission denied', 'C3 · alcance: anon no ejecuta la función');
  perform tests.act_as(v_wh);    perform tests.throws('update public.doctor_directory set organization = ''X''', 'permission denied', 'C3 · el directorio rechaza escrituras igual que antes (permiso denegado)');

  -- ══ NADA MÁS CAMBIÓ ══════════════════════════════════════════════════════════════════════════
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from storage.objects) = n_obj and (select count(*) from public.shipments) = n_ship and (select count(*) from public.profiles) = n_prof,
    'C3 · los sondeos no dejaron objetos, envíos ni perfiles de más o de menos');
end $t$;
rollback;
