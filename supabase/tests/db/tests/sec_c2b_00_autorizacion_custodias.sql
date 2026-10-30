-- SEC-C2b (142) · estado_custodia y vender_pos autorizan con comparación NULL-safe.
-- (huellas de crear_pedido / vender_pos / precio re-ancladas por MAYOREO-REGLAS 20270222: precio con el pedido completo)
-- Lee una custodia: Dirección, Facturación, Almacén, Empaque o su titular-usuario (holder_user_id = auth.uid()).
-- Vende de una custodia: Dirección o su titular-usuario. Un titular "tercero" (holder_customer_id) NO tiene vía propia.
-- Correo, teléfono, vendedor de Odoo, capturista, cartera o customers.profile_id NO autorizan. Una venta rechazada no deja NADA.
begin;
-- Huella de TODO lo que podría cambiar: filas de cada tabla de public + existencias por lote + saldo por custodia.
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
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing'); v_drv uuid := tests.user('driver');
  posA uuid := tests.user('pos', 'c2b-posa@t.local'); posX uuid := tests.user('pos', 'c2b-posx@t.local'); posV uuid := tests.user('pos', 'c2b-posv@t.local');
  posC uuid := tests.user('pos', 'c2b-posc@t.local'); posS uuid := tests.user('pos', 'c2b-poss@t.local'); posD uuid := tests.user('pos', 'c2b-posd@t.local');
  dH uuid := tests.user('doctor'); dN uuid := tests.user('doctor'); dT uuid := tests.user('doctor'); dU uuid := tests.user('doctor'); v_nadie uuid := gen_random_uuid();
  p uuid := tests.product(150); lot uuid; cT uuid; cDup uuid; cT2 uuid; cusCerr uuid; cusCerrT uuid := gen_random_uuid(); oid_a uuid; oid_t uuid := gen_random_uuid(); lines2 jsonb; allocs2 jsonb; res boolean; seller0 text;
  cusA uuid; cusD uuid := gen_random_uuid(); cusT uuid := gen_random_uuid(); cusDup uuid := gen_random_uuid(); cusS uuid; cusNo uuid := gen_random_uuid();
  lines jsonb; allocs jsonb; venta text; h0 text; h1 text; ref jsonb; u uuid; c uuid; rol text; oid_v uuid; msg_ajena text; msg_inex text; n int; q0 int;
  todas uuid[]; terceros uuid[]; nombre text; quien text; quienes text[]; uids uuid[]; i int;
begin
  -- ══ ESCENARIO ════════════════════════════════════════════════════════════════════════════════
  perform tests.act_as_service();
  perform set_config('app.trusted', 'on', true); update public.profiles set verified = false where id = dU; perform set_config('app.trusted', 'off', true);   -- alta pública
  insert into public.customers (full_name, email, phone, source, profile_id) values ('Clínica Tercero', 't@clinica.test', '5550001', 'portal', dT) returning id into cT;   -- cliente tercero CON cuenta (dT)
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dT, posV);                                          -- posV: cartera VALIDADA de ese mismo doctor
  insert into public.customers (full_name, email, phone, source, seller_name)                                                -- cliente tercero SIN cuenta: correo de posX, teléfono de cT, vendedor Odoo "c2b-posx"
    values ('Homónimo Odoo', (select email from public.profiles where id = posX), '5550001', 'odoo', 'c2b-posx') returning id into cDup;
  insert into public.customers (full_name, email, source) values ('Tercero con custodia cerrada', 't2@clinica.test', 'portal') returning id into cT2;
  perform tests.act_as_owner();
  lot := tests.stock(p, 'C2B', 500);
  cusA := tests.custodia('vendedor', posA); cusS := tests.custodia('vendedor', posS); cusCerr := tests.custodia('vendedor', posD);
  perform tests.act_as(v_admin);
  perform public.abrir_custodia(cusD,   'vendedor', 'doctor',  dH,   null, null, null, null);
  perform public.abrir_custodia(cusT,   'vendedor', 'tercero', null, cT,   null, null, null);
  perform public.abrir_custodia(cusDup, 'vendedor', 'tercero', null, cDup, null, null, null);
  perform public.abrir_custodia(cusCerrT, 'vendedor', 'tercero', null, cT2, null, null, null);
  perform public.cerrar_custodia(gen_random_uuid(), cusCerr, 'cierre de prueba'); perform public.cerrar_custodia(gen_random_uuid(), cusCerrT, 'cierre de prueba');   -- vacías: se cierran sin saldo
  perform tests.act_as_owner();
  -- posC = "capturista" de las custodias de tercero (el candado de custodias solo cede a una escritura de confianza)
  perform set_config('app.trusted', 'on', true); update public.custodies set opened_by = posC where id in (cusT, cusDup); perform set_config('app.trusted', 'off', true);
  perform tests.entregar(cusA, lot, 10); perform tests.entregar(cusD, lot, 5); perform tests.entregar(cusT, lot, 7); perform tests.entregar(cusDup, lot, 3); perform tests.entregar(cusS, lot, 4);
  perform tests.suspender(posS);
  lines  := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1));
  allocs := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 1));
  lines2  := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2, 'unit_price', 1)); allocs2 := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 2));
  -- vender_pos(order, folio, total, método, doctor, envío, renglones, asignaciones, factura?, datos factura, cliente, efectivo, custodia)
  venta  := 'select public.vender_pos(%L::uuid, %L, 1, ''efectivo'', null, ''{}'', ' || quote_literal(lines) || '::jsonb, ' || quote_literal(allocs) || '::jsonb, false, null, null, 300, %L::uuid)';
  todas := array[cusA, cusD, cusT, cusDup, cusS]; terceros := array[cusT, cusDup];

  -- ══ FORMA ════════════════════════════════════════════════════════════════════════════════════
  perform tests.ok(md5(pg_get_functiondef('public.estado_custodia(uuid)'::regprocedure)) = '79e390a5879eb28c1ef28c2645a0169b'
               and md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) = '5bc6ea55dd22b90e04648833d7263831',
    'G1 · estado_custodia con la definición SEC-C2b y vender_pos con la vigente (SEC-C2b + SEC-C4-FISCAL-2, 146: solo cambió el receptor fiscal)');
  perform tests.ok((select count(*) = 2 and bool_and(proowner = 'postgres'::regrole and prosecdef and proconfig = array['search_path=public'])
                    from pg_proc where pronamespace = 'public'::regnamespace and proname in ('estado_custodia', 'vender_pos'))
               and (select provolatile::text || prorettype::regtype::text from pg_proc where oid = 'public.estado_custodia(uuid)'::regprocedure) = 'sjsonb'
               and (select provolatile::text || prorettype::regtype::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'vender_pos') = 'vboolean',
    'G2 · una sola firma de cada una; dueño, SECURITY DEFINER, search_path, volatilidad y retorno sin cambio');
  perform tests.ok((select bool_and((select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text) from aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) a)
                                    = array['authenticated', 'postgres', 'service_role'])
                    from pg_proc pr where pr.pronamespace = 'public'::regnamespace and pr.proname in ('estado_custodia', 'vender_pos')),
    'G3 · permisos sin cambio: authenticated y service_role ejecutan; PUBLIC y anon no');
  perform tests.ok((select string_agg(proname || '=' || md5(pg_get_functiondef(oid)), ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace
                    and proname in ('cerrar_custodia', 'conciliar_custodia', 'custody_held'))
    = 'cerrar_custodia=ec54d65fabb7eb7d8d65ed49fc705c86,conciliar_custodia=2a7d04528ecc57685f3aad09660adfb3,custody_held=0054fb41003ba6b936a38c2836434886',
    'G4 · las demás funciones de custodia no cambian');
  perform tests.ok((select count(*) = 2 from pg_class where oid in ('public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass) and reloptions = array['security_invoker=true'])
               and (select md5(qual) from pg_policies where tablename = 'custodies' and policyname = 'custodies_select_ops') = '75bc0009832a1daac1a00b2de519f1b5'
               and (select md5(qual) from pg_policies where tablename = 'custody_lines' and policyname = 'custody_lines_select_ops') = '986084c8d75a2ed1788d8a28a6204dee'
               and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('custodies', 'custody_lines')) = 2,
    'G5 · SEC-C2 (141) intacta: vistas invoker y políticas RLS de custodia sin cambio');
  perform tests.ok((select count(*) = 7 and count(*) filter (where holder_user_id is null and holder_customer_id is not null) = 3 and count(*) filter (where status = 'cerrada') = 2 from public.custodies)
               and (select sum(held_delta) = 29 from public.custody_lines), 'G6 · fixture: 7 custodias (3 de titular tercero; 2 cerradas, una de cada tipo), 29 unidades en poder');

  -- ══ LECTURA · roles globales: todas, con el mismo contenido ══════════════════════════════════
  foreach c in array todas loop
    perform tests.act_as(v_admin); ref := public.estado_custodia(c);
    perform tests.ok(ref ->> 'status' = 'abierta' and jsonb_array_length(ref -> 'saldos') = 1 and jsonb_array_length(ref -> 'movimientos') = 1, 'L1 · Dirección lee el estado completo de ' || left(c::text, 8));
    foreach rol in array array['billing', 'warehouse', 'packing'] loop
      perform tests.act_as(case rol when 'billing' then v_bill when 'warehouse' then v_wh else v_pk end);
      perform tests.ok(public.estado_custodia(c) = ref, 'L1 · ' || rol || ' lee lo mismo que Dirección de ' || left(c::text, 8));
    end loop;
  end loop;
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.estado_custodia(%L)', cusNo), 'CUSTODIA_INEXISTENTE', 'L2 · rol global: una custodia que no existe se dice inexistente');

  -- ══ LECTURA · titulares legítimos: solo la suya, contenido idéntico ══════════════════════════
  perform tests.act_as(v_admin); ref := public.estado_custodia(cusA);
  perform tests.act_as(posA); perform tests.ok(public.estado_custodia(cusA) = ref, 'L3 · POS titular lee SU custodia (igual que Dirección)');
  perform tests.act_as(v_admin); ref := public.estado_custodia(cusD);
  perform tests.act_as(dH);   perform tests.ok(public.estado_custodia(cusD) = ref, 'L3 · Doctor titular lee SU custodia (igual que Dirección)');
  perform tests.act_as(posA); perform tests.throws(format('select public.estado_custodia(%L)', cusD), 'NO_AUTORIZADO', 'L3 · POS titular NO lee la custodia de otro titular');
  perform tests.act_as(dH);   perform tests.throws(format('select public.estado_custodia(%L)', cusA), 'NO_AUTORIZADO', 'L3 · Doctor titular NO lee la custodia de otro titular');

  -- ══ LECTURA · sin autorización: ninguna, y ajena = inexistente ════════════════════════════════
  quienes := array['POS titular de otra', 'POS ajeno (Odoo y correo coinciden)', 'POS con cartera coincidente', 'POS capturista', 'Doctor titular de otra', 'Doctor ajeno',
                   'Cuenta tercero (customers.profile_id)', 'Chofer', 'Usuario sin perfil', 'Alta pública sin verificar'];
  uids := array[posA, posX, posV, posC, dH, dN, dT, v_drv, v_nadie, dU];
  for i in 1 .. array_length(quienes, 1) loop
    perform tests.act_as(uids[i]);
    foreach c in array terceros loop
      perform tests.throws(format('select public.estado_custodia(%L)', c), 'NO_AUTORIZADO', 'L4 · ' || quienes[i] || ': NO lee la custodia de tercero ' || left(c::text, 8));
    end loop;
    begin perform public.estado_custodia(cusT);  msg_ajena := '<leyó>'; exception when others then msg_ajena := sqlerrm; end;
    begin perform public.estado_custodia(cusNo); msg_inex  := '<leyó>'; exception when others then msg_inex  := sqlerrm; end;
    perform tests.ok(msg_ajena = msg_inex and msg_ajena = 'NO_AUTORIZADO', 'L5 · ' || quienes[i] || ': custodia ajena e inexistente responden lo MISMO (no se revela existencia)');
  end loop;
  foreach u in array array[posX, posV, posC, dN, dT, v_drv, v_nadie, dU] loop
    perform tests.act_as(u);
    foreach c in array array[cusA, cusD, cusS] loop
      perform tests.throws(format('select public.estado_custodia(%L)', c), 'NO_AUTORIZADO', 'L6 · sin relación: tampoco lee custodias de titular-usuario (' || left(u::text, 4) || '→' || left(c::text, 4) || ')');
    end loop;
  end loop;
  perform tests.act_as(posS);
  foreach c in array array[cusS, cusT, cusNo] loop
    perform tests.throws(format('select public.estado_custodia(%L)', c), 'CUENTA_SUSPENDIDA', 'L7 · cuenta suspendida: rechazada antes de tocar datos (' || left(c::text, 4) || '), incluida la suya y una inexistente');
  end loop;
  perform tests.act_as_anon();
  perform tests.throws(format('select public.estado_custodia(%L)', cusT), 'permission denied', 'L8 · anon no ejecuta estado_custodia');
  perform tests.act_as_service();
  foreach c in array array[cusA, cusT, cusNo] loop
    perform tests.throws(format('select public.estado_custodia(%L)', c), 'NO_AUTORIZADO', 'L9 · service_role ya no lee estado_custodia (lo hacía por el mismo accidente; lee las tablas directo) ' || left(c::text, 4));
  end loop;
  perform tests.ok((select count(*) = 7 from public.custodies) and (select count(*) = 7 from public.v_custody_liquidacion), 'L9 · service_role conserva la lectura directa de tablas y vistas');
  perform tests.act_as_owner();

  -- ══ VENTA · rechazadas: sin autorización positiva no se vende, y no queda NADA ════════════════
  h0 := pg_temp.huella(); q0 := tests.qty(lot);
  quienes := array['POS titular de otra', 'POS ajeno (Odoo y correo coinciden)', 'POS con cartera coincidente', 'POS capturista'];
  uids := array[posA, posX, posV, posC];
  for i in 1 .. array_length(quienes, 1) loop
    foreach c in array terceros loop
      perform tests.act_as(uids[i]);
      perform tests.throws(format(venta, gen_random_uuid(), 'C2B-X', c), 'NO_AUTORIZADO', 'V1 · ' || quienes[i] || ': NO vende de la custodia de tercero ' || left(c::text, 8));
      perform tests.sin_efecto(format(venta, gen_random_uuid(), 'C2B-X', c), 'select pg_temp.huella()', h0, 'V1 · ' || quienes[i] || ': la venta rechazada no cambia inventario, pedidos, cobros, movimientos ni operaciones (' || left(c::text, 4) || ')');
    end loop;
  end loop;
  foreach u in array array[posX, posV, posC] loop
    foreach c in array array[cusA, cusD] loop
      perform tests.act_as(u);
      perform tests.sin_efecto(format(venta, gen_random_uuid(), 'C2B-X', c), 'select pg_temp.huella()', h0, 'V2 · POS sin relación tampoco vende de custodias de titular-usuario (' || left(u::text, 4) || '→' || left(c::text, 4) || ')');
    end loop;
  end loop;
  -- Reintento con el MISMO id de pedido (idempotencia): sigue rechazado y no deja operación a medias.
  oid_v := gen_random_uuid();
  perform tests.act_as(posX);
  perform tests.throws(format(venta, oid_v, 'C2B-R', cusT), 'NO_AUTORIZADO', 'V3 · primer intento rechazado');
  perform tests.throws(format(venta, oid_v, 'C2B-R', cusT), 'NO_AUTORIZADO', 'V3 · el reintento con el mismo id de pedido se rechaza igual (la idempotencia no abre la puerta)');
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from public.orders where id = oid_v) and pg_temp.huella() = h0, 'V3 · ni pedido ni operación registrada tras los dos intentos');
  -- Roles que no venden: el rechazo es el de rol, antes de mirar la custodia.
  quienes := array['Facturación', 'Almacén', 'Empaque', 'Doctor titular', 'Doctor ajeno', 'Cuenta tercero', 'Chofer', 'Usuario sin perfil', 'Alta pública', 'service_role'];
  uids := array[v_bill, v_wh, v_pk, dH, dN, dT, v_drv, v_nadie, dU, null];
  for i in 1 .. array_length(quienes, 1) loop
    if uids[i] is null then perform tests.act_as_service(); else perform tests.act_as(uids[i]); end if;
    perform tests.throws(format(venta, gen_random_uuid(), 'C2B-N', cusT), 'No autorizado', 'V4 · ' || quienes[i] || ': no vende (rol)');
    perform tests.sin_efecto(format(venta, gen_random_uuid(), 'C2B-N', case when quienes[i] = 'Doctor titular' then cusD else cusT end), 'select pg_temp.huella()', h0, 'V4 · ' || quienes[i] || ': sin efectos');
  end loop;
  perform tests.act_as(posS);
  perform tests.throws(format(venta, gen_random_uuid(), 'C2B-S', cusS), 'CUENTA_SUSPENDIDA', 'V5 · titular suspendido: no vende ni de su propia custodia');
  perform tests.act_as_anon();
  perform tests.throws(format(venta, gen_random_uuid(), 'C2B-A', cusT), 'permission denied', 'V5 · anon no ejecuta vender_pos');
  perform tests.act_as_owner();
  perform tests.ok(pg_temp.huella() = h0 and tests.qty(lot) = q0, 'V6 · tras TODOS los rechazos: huella global y existencia del lote idénticas al inicio');

  -- ══ VENTA · legítimas: se conservan, con todos sus efectos ════════════════════════════════════
  oid_v := gen_random_uuid();
  oid_a := oid_v;
  perform tests.act_as(posA); perform tests.ok(public.vender_pos(oid_v, 'C2B-A', 1, 'efectivo', null, '{}', lines, allocs, false, null, null, 300, cusA), 'V7 · el POS titular vende de SU custodia');
  perform tests.act_as_owner();
  perform tests.ok(tests.qty(lot) = q0 - 1 and tests.en_poder(cusA, lot) = 9
               and (select status = 'delivered' and payment_status = 'paid' and total = 150 from public.orders where id = oid_v)
               and (select count(*) = 1 from public.custody_lines where order_id = oid_v and kind = 'venta' and held_delta = -1)
               and (select count(*) = 1 from public.inventory_movements where order_id = oid_v and change = -1)
               and (select count(*) = 1 from public.payment_entries where order_id = oid_v),
    'V7 · efectos completos: lote −1, saldo de custodia −1, pedido pagado, movimiento y cobro registrados');
  -- Reintento idempotente del titular: éxito sin duplicar.
  h1 := pg_temp.huella();
  perform tests.act_as(posA); perform tests.ok(public.vender_pos(oid_v, 'C2B-A', 1, 'efectivo', null, '{}', lines, allocs, false, null, null, 300, cusA), 'V8 · reintento del titular: éxito idempotente');
  perform tests.act_as_owner(); perform tests.ok(pg_temp.huella() = h1, 'V8 · el reintento no duplica nada');
  -- Dirección vende de cualquier custodia, incluida la de tercero (única vía para un titular tercero).
  perform tests.act_as(v_admin);
  perform tests.ok(public.vender_pos(oid_t, 'C2B-T', 1, 'tarjeta', null, '{}', lines, allocs, false, null, null, null, cusT), 'V9 · Dirección vende de la custodia de tercero');
  perform tests.ok(public.vender_pos(gen_random_uuid(), 'C2B-D', 1, 'tarjeta', null, '{}', lines, allocs, false, null, null, null, cusD), 'V9 · Dirección vende de la custodia de un doctor');
  perform tests.act_as_owner();
  perform tests.ok(tests.en_poder(cusT, lot) = 6 and tests.en_poder(cusD, lot) = 4 and tests.qty(lot) = q0 - 3, 'V9 · saldos y existencia cuadran tras las ventas de Dirección');
  -- La venta de mostrador (sin custodia) no cambia para ningún pos.
  perform tests.act_as(posX);
  perform tests.ok(public.vender_pos(gen_random_uuid(), 'C2B-M', 1, 'efectivo', null, '{}', lines, allocs, false, null, null, 300, null), 'V10 · venta de mostrador (sin custodia) intacta para cualquier POS');
  perform tests.act_as_owner();
  perform tests.ok(tests.qty(lot) = q0 - 4 and tests.custodia_errores() = 0, 'V10 · existencia cuadra y la conciliación de custodia no reporta errores');

  -- ══ REPETICIÓN · la idempotencia NO abre la puerta ni deja efectos ════════════════════════════
  -- Semántica vigente y sin cambio en la 142 (riesgo residual P3 documentado): _w1_op_begin corre ANTES de la compuerta
  -- de custodia. Repetir una venta YA aplicada con la solicitud idéntica devuelve true a cualquier admin/pos, sin
  -- escribir nada; con otra solicitud, OP_ID_REUTILIZADO. Estas pruebas fijan que NUNCA produce efectos.
  h1 := pg_temp.huella(); q0 := tests.qty(lot);
  select shipping_meta::text into seller0 from public.orders where id = oid_a;
  perform tests.act_as(posX);
  res := public.vender_pos(oid_a, 'C2B-A', 1, 'efectivo', null, '{}', lines, allocs, false, null, null, 300, cusA);
  perform tests.ok(res, 'R1 · otro POS repite la venta del titular (mismo id, solicitud idéntica): responde éxito idempotente [P3 documentado]');
  res := public.vender_pos(oid_t, 'C2B-T', 1, 'tarjeta', null, '{}', lines, allocs, false, null, null, null, cusT);
  perform tests.ok(res, 'R2 · otro POS repite la venta de Dirección sobre la custodia de TERCERO (idéntica): éxito idempotente [P3 documentado]');
  perform tests.act_as_owner();
  perform tests.ok(pg_temp.huella() = h1 and tests.qty(lot) = q0 and tests.en_poder(cusA, lot) = 9 and tests.en_poder(cusT, lot) = 6,
    'R3 · esas repeticiones NO venden otra vez: huella global, existencia y saldos de ambas custodias idénticos');
  perform tests.ok((select shipping_meta::text = seller0 from public.orders where id = oid_a)
               and (select actor = posA from public.inventory_operations where op_id = oid_a) and (select actor = v_admin from public.inventory_operations where op_id = oid_t)
               and (select count(*) = 1 from public.inventory_operations where op_id = oid_a) and (select count(*) = 1 from public.payment_entries where order_id = oid_t),
    'R4 · la atribución no cambia: mismo vendedor en el pedido, mismo actor en la operación, un solo cobro');
  perform tests.act_as(posX);
  perform tests.throws(format('select public.vender_pos(%L::uuid, ''C2B-T'', 1, ''tarjeta'', null, ''{}'', %L::jsonb, %L::jsonb, false, null, null, null, %L::uuid)', oid_t, lines2, allocs2, cusT),
    'OP_ID_REUTILIZADO', 'R5 · mismo id con OTRA cantidad: rechazado');
  perform tests.throws(format('select public.vender_pos(%L::uuid, ''C2B-T'', 1, ''tarjeta'', null, ''{}'', %L::jsonb, %L::jsonb, false, null, null, null, %L::uuid)', oid_t, lines, allocs, cusA),
    'OP_ID_REUTILIZADO', 'R5 · mismo id apuntando a OTRA custodia: rechazado');
  perform tests.throws(format('select public.vender_pos(%L::uuid, ''C2B-T'', 1, ''tarjeta'', null, ''{}'', %L::jsonb, %L::jsonb, false, null, null, null, null)', oid_t, lines, allocs),
    'OP_ID_REUTILIZADO', 'R5 · mismo id SIN custodia (mostrador): rechazado');
  perform tests.throws(format('select public.vender_pos(%L::uuid, ''OTRO-FOLIO'', 1, ''tarjeta'', null, ''{}'', %L::jsonb, %L::jsonb, false, null, null, null, %L::uuid)', oid_t, lines, allocs, cusT),
    'OP_ID_REUTILIZADO', 'R5 · mismo id con otro folio: rechazado');
  perform tests.act_as(posA);
  perform tests.throws(format('select public.vender_pos(%L::uuid, ''C2B-A'', 1, ''efectivo'', null, ''{}'', %L::jsonb, %L::jsonb, false, null, null, 300, %L::uuid)', oid_a, lines2, allocs2, cusA),
    'OP_ID_REUTILIZADO', 'R6 · ni el propio titular cambia una venta repitiendo su id con otra solicitud');
  perform tests.act_as(dN);
  perform tests.throws(format(venta, oid_t, 'C2B-T', cusT), 'No autorizado', 'R7 · un rol que no vende no obtiene ni el éxito idempotente (la compuerta de rol va antes)');
  perform tests.act_as(posS);
  perform tests.throws(format(venta, oid_t, 'C2B-T', cusT), 'CUENTA_SUSPENDIDA', 'R7 · una cuenta suspendida tampoco');
  perform tests.act_as_owner();
  perform tests.ok(pg_temp.huella() = h1 and tests.qty(lot) = q0, 'R8 · tras TODAS las repeticiones: nada cambió');

  -- ══ CUSTODIA CERRADA · no se vende de ella, la pida quien la pida ══════════════════════════════
  h1 := pg_temp.huella();
  perform tests.act_as(posD);
  perform tests.throws(format(venta, gen_random_uuid(), 'C2B-C', cusCerr), 'CUSTODIA_CERRADA', 'X1 · el titular no vende de SU custodia ya cerrada');
  perform tests.act_as(v_admin);
  perform tests.throws(format(venta, gen_random_uuid(), 'C2B-C', cusCerr), 'CUSTODIA_CERRADA', 'X1 · Dirección no vende de una custodia cerrada');
  perform tests.throws(format(venta, gen_random_uuid(), 'C2B-C', cusCerrT), 'CUSTODIA_CERRADA', 'X1 · Dirección no vende de una custodia de tercero cerrada');
  perform tests.act_as(posX);
  -- Riesgo residual P3 documentado: vender_pos revisa existencia y estado ANTES de autorizar, así que un pos sin relación
  -- distingue inexistente / cerrada / ajena. No aprende titular, tipo, saldo ni cliente, y nunca vende.
  perform tests.throws(format(venta, gen_random_uuid(), 'C2B-C', cusCerr),  'CUSTODIA_CERRADA', 'X2 · POS sin relación sobre custodia cerrada de otro: rechazado [revela "cerrada": P3 documentado]');
  perform tests.throws(format(venta, gen_random_uuid(), 'C2B-C', cusCerrT), 'CUSTODIA_CERRADA', 'X2 · POS sin relación sobre custodia cerrada de tercero: rechazado [P3 documentado]');
  perform tests.throws(format(venta, gen_random_uuid(), 'C2B-C', cusNo),    'CUSTODIA_INEXISTENTE', 'X2 · POS sin relación sobre custodia inexistente: rechazado [revela "no existe": P3 documentado]');
  perform tests.throws(format('select public.vender_pos(%L::uuid, ''C2B-C'', 1, ''efectivo'', null, ''{}'', %L::jsonb, %L::jsonb, false, null, null, 300, %L::uuid)', gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 50, 'unit_price', 1)), jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 50)), cusT),
    'NO_AUTORIZADO', 'X3 · pidiendo MÁS de lo que tiene la custodia de tercero, el rechazo es de autorización: el saldo no se revela');
  perform tests.act_as_owner();
  perform tests.ok(pg_temp.huella() = h1, 'X4 · ningún intento sobre custodias cerradas o inexistentes cambió nada');
  -- Lectura de una custodia cerrada: mismas reglas que una abierta.
  perform tests.act_as(v_admin); perform tests.ok(public.estado_custodia(cusCerrT) ->> 'status' = 'cerrada', 'X5 · Dirección lee una custodia de tercero cerrada');
  perform tests.act_as(posD);    perform tests.ok(public.estado_custodia(cusCerr) ->> 'status' = 'cerrada', 'X5 · el titular sigue leyendo SU custodia cerrada');
  perform tests.act_as(posX);
  perform tests.throws(format('select public.estado_custodia(%L)', cusCerr),  'NO_AUTORIZADO', 'X6 · sin relación: no lee una custodia cerrada de otro');
  perform tests.throws(format('select public.estado_custodia(%L)', cusCerrT), 'NO_AUTORIZADO', 'X6 · sin relación: no lee una custodia cerrada de tercero (igual que una inexistente)');
  perform tests.act_as_owner();

  -- ══ CONSUMIDORES · cerrar y conciliar siguen funcionando ══════════════════════════════════════
  perform tests.act_as(v_admin);
  perform tests.ok((public.estado_custodia(cusT) ->> 'unidades_en_poder')::int = 6, 'C1 · estado_custodia refleja la venta de Dirección sobre la custodia de tercero');
  perform tests.act_as_owner();
end $t$;
rollback;
