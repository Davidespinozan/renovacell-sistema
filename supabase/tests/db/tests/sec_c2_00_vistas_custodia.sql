-- SEC-C2 · v_custody_stock y v_custody_liquidacion con security_invoker: se aplica el RLS de custodies / custody_lines.
-- Ve una custodia quien la ve en las tablas: Dirección, Facturación, Almacén, Empaque o su titular-usuario. Correo, teléfono,
-- vendedor de Odoo, cartera o customers.profile_id NO autorizan. Las funciones definer que leen las vistas no cambian.
-- (Fuera de este bloque: estado_custodia / vender_pos comparan holder_user_id sin tratar NULL — titular "tercero"; ver reporte.)
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing'); v_drv uuid := tests.user('driver');
  posA uuid := tests.user('pos', 'c2-posa@t.local'); posB uuid := tests.user('pos', 'c2-posb@t.local'); posV uuid := tests.user('pos', 'c2-posv@t.local'); posS uuid := tests.user('pos', 'c2-poss@t.local');
  dH uuid := tests.user('doctor'); dN uuid := tests.user('doctor'); dT uuid := tests.user('doctor'); dU uuid := tests.user('doctor'); v_nadie uuid := gen_random_uuid();
  p uuid := tests.product(150); lot uuid; cT uuid; cDup uuid;
  cusA uuid; cusB uuid; cusD uuid := gen_random_uuid(); cusT uuid := gen_random_uuid(); cusDup uuid := gen_random_uuid(); cusE uuid; cusS uuid;
  lines jsonb; allocs jsonb; rol text; u uuid; v_stock uuid[]; v_liq uuid[]; esperado_s uuid[]; esperado_l uuid[]; ref_estado text; ref_liq text; v_err text; n int;
  todas_s uuid[]; todas_l uuid[];
begin
  -- ══ ESCENARIO ════════════════════════════════════════════════════════════════════════════════
  perform tests.act_as_service();
  perform set_config('app.trusted', 'on', true); update public.profiles set verified = false where id = dU; perform set_config('app.trusted', 'off', true);   -- alta pública
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dN, posV);                                         -- posV: cartera validada, SIN custodia
  insert into public.customers (full_name, email, phone, source, profile_id) values ('Clínica Tercero', 't@clinica.test', '5550001', 'portal', dT) returning id into cT;
  insert into public.customers (full_name, email, phone, source, seller_name)                                               -- mismo correo que dH, mismo teléfono que cT, vendedor Odoo "c2-posv"
    values ('Homónimo Odoo', (select email from public.profiles where id = dH), '5550001', 'odoo', 'c2-posv') returning id into cDup;
  perform tests.act_as_owner();
  lot := tests.stock(p, 'C2', 500);
  cusA := tests.custodia('vendedor', posA); cusB := tests.custodia('vendedor', posB); cusE := tests.custodia('evento', posA); cusS := tests.custodia('vendedor', posS);
  perform tests.act_as(v_admin);
  perform public.abrir_custodia(cusD,   'vendedor', 'doctor',  dH,   null, null, null, null);
  perform public.abrir_custodia(cusT,   'vendedor', 'tercero', null, cT,   null, null, null);
  perform public.abrir_custodia(cusDup, 'vendedor', 'tercero', null, cDup, null, null, null);
  perform tests.act_as_owner();
  perform tests.entregar(cusA, lot, 10); perform tests.entregar(cusB, lot, 20); perform tests.entregar(cusD, lot, 5);
  perform tests.entregar(cusT, lot, 7);  perform tests.entregar(cusDup, lot, 3); perform tests.entregar(cusS, lot, 4);    -- cusE queda VACÍA
  lines := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2, 'unit_price', 1));
  allocs := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', lot, 'qty', 2));
  perform tests.act_as(posA);    perform public.vender_pos(gen_random_uuid(), 'C2-A', 1, 'efectivo', null, '{}', lines, allocs, false, null, null, 300, cusA);   -- el titular vende de SU custodia
  perform tests.act_as(v_admin); perform public.vender_pos(gen_random_uuid(), 'C2-B', 1, 'tarjeta',  null, '{}', lines, allocs, false, null, null, null, cusB);  -- Dirección vende de la custodia de posB
  perform tests.act_as_owner();
  perform tests.suspender(posS);
  todas_s := array[cusA, cusB, cusD, cusT, cusDup, cusS]; todas_l := todas_s || cusE;

  -- ══ FORMA ════════════════════════════════════════════════════════════════════════════════════
  perform tests.ok((select bool_and(reloptions = array['security_invoker=true'] and relowner = 'postgres'::regrole and relkind = 'v')
                    from pg_class where oid in ('public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass)), 'G1 · ambas vistas con security_invoker=true (y solo esa opción), dueño postgres');
  perform tests.ok(md5(pg_get_viewdef('public.v_custody_stock'::regclass)) = '894b9ed23d36bba674c20c4d0d818551'
               and md5(pg_get_viewdef('public.v_custody_liquidacion'::regclass)) = '794c370463acb6d8080883743e587a20', 'G2 · definiciones idénticas a producción');
  perform tests.ok((select md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)) from pg_attribute a where a.attrelid = 'public.v_custody_stock'::regclass and a.attnum > 0) = '8271cba80313cabcb2b0dc559eb02da8'
               and (select md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)) from pg_attribute a where a.attrelid = 'public.v_custody_liquidacion'::regclass and a.attnum > 0) = 'c714e05cc0cbfbc0bbac9a86d2dfcf22',
    'G3 · columnas y tipos idénticos a producción');
  perform tests.ok((select bool_and(has_table_privilege('authenticated', oid, 'SELECT') and has_table_privilege('service_role', oid, 'SELECT') and not has_table_privilege('anon', oid, 'SELECT')
                                    and not has_table_privilege('authenticated', oid, 'INSERT') and not has_table_privilege('authenticated', oid, 'UPDATE') and not has_table_privilege('authenticated', oid, 'DELETE'))
                    from pg_class where oid in ('public.v_custody_stock'::regclass, 'public.v_custody_liquidacion'::regclass)), 'G4 · permisos de las vistas sin cambio');
  perform tests.ok((select md5(qual) from pg_policies where tablename = 'custodies' and policyname = 'custodies_select_ops') = '75bc0009832a1daac1a00b2de519f1b5'
               and (select md5(qual) from pg_policies where tablename = 'custody_lines' and policyname = 'custody_lines_select_ops') = '986084c8d75a2ed1788d8a28a6204dee'
               and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('custodies', 'custody_lines')) = 2, 'G5 · políticas RLS de custodia intactas (el aislamiento descansa en ellas)');
  perform tests.ok((select string_agg(proname || '=' || md5(pg_get_functiondef(oid)), ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace
                    and proname in ('estado_custodia', 'cerrar_custodia', 'conciliar_custodia', 'custody_held'))
    = 'cerrar_custodia=ec54d65fabb7eb7d8d65ed49fc705c86,conciliar_custodia=2a7d04528ecc57685f3aad09660adfb3,custody_held=0054fb41003ba6b936a38c2836434886,estado_custodia=6f9172476ed18bbec738e7b545c49f5d'
               and md5(pg_get_viewdef('public.v_order_money'::regclass)) = '8de543e01ea16278d149d7af9bc98e55', 'G6 · funciones definer y v_order_money sin cambios');
  -- los datos EXISTEN (un cero más abajo no es por falta de datos)
  perform tests.ok((select count(distinct custody_id) = 6 and sum(held_delta) = 45 from public.custody_lines) and (select count(*) = 7 from public.custodies),
    'G7 · fixture: 7 custodias, 6 con existencias, 45 unidades en poder');

  -- ══ ROLES GLOBALES: todo, con cantidades e importes correctos ════════════════════════════════
  foreach rol in array array['admin', 'billing', 'warehouse', 'packing', 'service_role'] loop
    if rol = 'service_role' then perform tests.act_as_service();
    else perform tests.act_as(case rol when 'admin' then v_admin when 'billing' then v_bill when 'warehouse' then v_wh else v_pk end); end if;
    perform tests.ok((select count(distinct custody_id) = 6 and sum(en_poder) = 45 and sum(vendido) = 4 and sum(entregado) = 49 from public.v_custody_stock),
      'P1 · ' || rol || ': existencias de las 6 custodias (49 entregadas, 4 vendidas, 45 en poder)');
    perform tests.ok((select count(*) = 7 and sum(importe_vendido) = 600 and sum(cobrado) = 600 and sum(saldo) = 0 and sum(unidades_en_poder) = 45 from public.v_custody_liquidacion),
      'P1 · ' || rol || ': liquidación de las 7 custodias (vendido 600, cobrado 600, saldo 0)');
  end loop;

  -- ══ TITULARES: solo lo suyo ══════════════════════════════════════════════════════════════════
  foreach rol in array array['posA', 'posB', 'doctor_titular'] loop
    u := case rol when 'posA' then posA when 'posB' then posB else dH end;
    esperado_s := case rol when 'posA' then array[cusA] when 'posB' then array[cusB] else array[cusD] end;
    esperado_l := case rol when 'posA' then array[cusA, cusE] when 'posB' then array[cusB] else array[cusD] end;
    perform tests.act_as(u);
    select coalesce(array_agg(distinct custody_id order by custody_id), '{}') into v_stock from public.v_custody_stock;
    select coalesce(array_agg(custody_id order by custody_id), '{}') into v_liq from public.v_custody_liquidacion;
    perform tests.ok(v_stock = (select array_agg(x order by x) from unnest(esperado_s) x), 'P2 · ' || rol || ': existencias SOLO de su custodia');
    perform tests.ok(v_liq = (select array_agg(x order by x) from unnest(esperado_l) x), 'P2 · ' || rol || ': liquidación SOLO de sus custodias');
  end loop;
  perform tests.act_as(posA);
  perform tests.ok((select en_poder = 8 and vendido = 2 from public.v_custody_stock where custody_id = cusA)
               and (select importe_vendido = 300 and cobrado = 300 and saldo = 0 from public.v_custody_liquidacion where custody_id = cusA)
               and (select unidades_entregadas = 0 and importe_vendido = 0 from public.v_custody_liquidacion where custody_id = cusE),
    'P3 · posA: su custodia parcialmente liquidada (8 en poder, 300/300) y su custodia vacía en ceros');
  perform tests.act_as(posB);
  perform tests.ok((select en_poder = 18 and vendido = 2 from public.v_custody_stock where custody_id = cusB)
               and (select importe_vendido = 300 from public.v_custody_liquidacion where custody_id = cusB),
    'P4 · posB ve la venta que Dirección hizo de SU custodia (el capturista no cambia la titularidad)');
  perform tests.act_as(dH);
  perform tests.ok((select en_poder = 5 from public.v_custody_stock where custody_id = cusD), 'P5 · doctor titular: sus 5 unidades');

  -- ══ SIN AUTORIZACIÓN: nada (los datos existen, G7) ═══════════════════════════════════════════
  foreach rol in array array['pos_con_cartera_sin_custodia', 'doctor_sin_custodia', 'doctor_de_cuenta_tercero', 'chofer', 'alta_publica', 'sin_perfil'] loop
    u := case rol when 'pos_con_cartera_sin_custodia' then posV when 'doctor_sin_custodia' then dN when 'doctor_de_cuenta_tercero' then dT when 'chofer' then v_drv when 'alta_publica' then dU else v_nadie end;
    perform tests.act_as(u);
    perform tests.ok((select count(*) from public.v_custody_stock) = 0 and (select count(*) from public.v_custody_liquidacion) = 0, 'N1 · ' || rol || ': sin existencias ni liquidaciones');
  end loop;
  -- invariantes comerciales, explícitos
  perform tests.act_as(dH);
  perform tests.eq((select count(*)::int from public.v_custody_stock where custody_id = cusDup), 0, 'N2 · correo compartido con una cuenta tercero ≠ autorización');
  perform tests.act_as(dT);
  perform tests.eq((select count(*)::int from public.v_custody_liquidacion where custody_id in (cusT, cusDup)), 0, 'N3 · customers.profile_id (y teléfono compartido) ≠ titular: holder_customer_id no es holder_user_id');
  perform tests.act_as(posV);
  perform tests.eq((select count(*)::int from public.v_custody_stock where custody_id = cusDup), 0, 'N4 · vendedor de Odoo ≠ titular autorizado');
  perform tests.act_as(posA);
  perform tests.eq((select count(*)::int from public.v_custody_stock where custody_id = cusB), 0, 'N5 · un POS titular no ve la custodia de otro POS');
  perform tests.eq((select count(*)::int from public.v_custody_liquidacion where custody_id = cusB), 0, 'N5b · ni su liquidación');
  -- cuenta suspendida: rechazada por el RLS (antes leía las existencias)
  perform tests.act_as(posS);
  perform tests.throws('select count(*) from public.v_custody_stock', 'CUENTA_SUSPENDIDA', 'N6 · cuenta suspendida: existencias rechazadas');
  perform tests.throws('select count(*) from public.v_custody_liquidacion', 'CUENTA_SUSPENDIDA', 'N6 · cuenta suspendida: liquidación rechazada');
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.v_custody_stock', 'permission denied', 'N7 · anon sin acceso a existencias');
  perform tests.throws('select count(*) from public.v_custody_liquidacion', 'permission denied', 'N7 · anon sin acceso a liquidación');

  -- ══ FUNCIONES DEFINER QUE LEEN LAS VISTAS: mismo contrato y mismas cifras ════════════════════
  perform tests.act_as(v_admin);
  ref_estado := md5((public.estado_custodia(cusB) - 'movimientos')::text);
  perform tests.ok((public.estado_custodia(cusB) ->> 'unidades_en_poder')::int = 18 and (public.estado_custodia(cusB) ->> 'importe_vendido')::numeric = 300
               and (public.estado_custodia(cusB) ->> 'cobrado')::numeric = 300 and jsonb_array_length(public.estado_custodia(cusB) -> 'saldos') = 1,
    'F1 · estado_custodia (Dirección): cantidades e importes completos');
  perform tests.eq((select count(*)::int from public.conciliar_custodia() where severidad = 'error'), 0, 'F2 · conciliar_custodia: sin errores');
  perform tests.act_as(posB);
  perform tests.ok(md5((public.estado_custodia(cusB) - 'movimientos')::text) = ref_estado, 'F3 · estado_custodia (titular): MISMAS cifras que Dirección (incluye el cobro de la venta hecha por Dirección)');
  perform tests.act_as(v_wh);
  perform tests.ok(md5((public.estado_custodia(cusB) - 'movimientos')::text) = ref_estado, 'F3b · estado_custodia (Almacén): mismas cifras');
  perform tests.throws('select public.conciliar_custodia()', 'NO_AUTORIZADO', 'F4 · conciliar_custodia sigue siendo solo de Dirección');
  perform tests.act_as(posA);
  perform tests.throws(format('select public.estado_custodia(%L)', cusB), 'NO_AUTORIZADO', 'F5 · estado_custodia: otro POS sigue rechazado');
  perform tests.throws(format('select public.cerrar_custodia(gen_random_uuid(), %L, ''x'')', cusE), 'NO_AUTORIZADO', 'F6 · cerrar_custodia sigue siendo solo de Dirección');
  perform tests.act_as(dN);
  perform tests.throws(format('select public.estado_custodia(%L)', cusB), 'NO_AUTORIZADO', 'F5b · estado_custodia: doctor ajeno sigue rechazado');
  perform tests.act_as(v_admin);
  perform tests.eq(public.cerrar_custodia(gen_random_uuid(), cusE, 'cierre de prueba') ->> 'status', 'applied', 'F7 · cerrar_custodia (lee la liquidación) sigue aplicando');
  perform tests.act_as_owner();
end $t$;
rollback;
