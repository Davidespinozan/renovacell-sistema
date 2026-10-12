-- SEC-C4-A (145) · buscar_clientes_pos(q, limite): búsqueda mínima de clientes para Dirección y Ventas.
-- Devuelve SOLO customer_id, nombre y ••••últimos 4. Por nombre (≥3 letras) o por EXACTAMENTE 4 dígitos finales.
-- Sin correo, prefijos ni números completos. Máx. 20, orden fijo. Encontrar una cuenta NO autoriza su expediente.
-- ADITIVA: no cambia políticas ni permisos existentes (eso es C4-C).
begin;
create temp table r (k text primary key, v text) on commit drop;
grant all on r to public;
do $t$
#variable_conflict use_variable
declare
  v_admin uuid := tests.fixture_admin(); posA uuid := tests.user('pos', 'c4a-posa@t.local'); posX uuid := tests.user('pos', 'c4a-posx@t.local'); posR uuid := tests.user('pos', 'c4a-posr@t.local'); posS uuid := tests.user('pos', 'c4a-poss@t.local');
  v_bill uuid := tests.user('billing'); v_comm uuid := tests.user('comm'); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing'); v_drv uuid := tests.user('driver');
  dA uuid := tests.user('doctor', 'c4a-da@t.local'); dU uuid := tests.user('doctor', 'c4a-du@t.local'); v_nadie uuid := gen_random_uuid();
  cA uuid; cC uuid; cD uuid; cO uuid; cN uuid; cS uuid; cI uuid; cE uuid; cP uuid; cX uuid; i int; t text; t2 text; n int; n0 int; pol0 text; q text; quien text; u uuid; msg0 text;
  -- lo que una respuesta jamás puede contener: 5+ dígitos seguidos, correos, RFC, ciudad, vendedor histórico, id externo, metadatos
  prohibido constant text := '[0-9]{5,}|@|AAA010101|Culiac|Mazatl|vendedor-odoo|ODOO-|fiscal|import|x\.test';
begin
  -- ══ ESCENARIO ════════════════════════════════════════════════════════════════════════════════
  perform tests.act_as_service(); perform set_config('app.trusted', 'on', true); update public.profiles set verified = false where id = dU; perform set_config('app.trusted', 'off', true);
  insert into public.customers (full_name, email, phone, city, source, profile_id, meta) values ('Clínica Ñandú Ángeles', 'a@x.test', '+52 667 111 0001', 'Culiacán', 'portal', dA, '{"fiscal":{"rfc":"AAA010101AAA"}}') returning id into cA;
  insert into public.customers (full_name, email, phone, city, source) values ('Cuenta C mismo teléfono', 'c@x.test', '6671110001', 'Mazatlán', 'odoo') returning id into cC;
  insert into public.customers (full_name, email, phone, source) values ('Cuenta D mismo correo', 'a@x.test', '6674440004', 'odoo') returning id into cD;
  insert into public.customers (full_name, email, phone, source, seller_name, external_id, meta) values ('Histórico Odoo SA', 'o@x.test', '6675550005', 'odoo', 'vendedor-odoo', 'ODOO-9', '{"import":{"row":7}}') returning id into cO;
  insert into public.customers (full_name, source) values ('Sin Teléfono SC', 'portal') returning id into cN;
  insert into public.customers (full_name, phone, source) values ('Tel Corto SC', '12345', 'odoo') returning id into cS;
  insert into public.customers (full_name, phone, source) values ('Miami Derm LLC', '+1 (305) 555-0199', 'odoo') returning id into cI;
  insert into public.customers (full_name, phone, source) values ('ana.lopez@x.test', '6677770007', 'odoo') returning id into cE;          -- la importación dejó un correo como nombre
  insert into public.customers (full_name, phone, source) values ('Dra. Ruiz 667 888 9999', '6678889999', 'odoo') returning id into cP;   -- y un teléfono dentro del nombre
  insert into public.customers (full_name, phone, source, active) values ('Inactiva Oculta SA', '6670009999', 'odoo', false) returning id into cX;
  insert into public.customers (full_name, phone, source) values ('100% Piel', '6670000101', 'odoo'), ('Under_score SA', '6670000102', 'odoo'), ('Back\slash SA', '6670000103', 'odoo'),
    ('Dermatología del Valle', '6670000201', 'odoo'), ('Dermatología del Valle', '6670000202', 'odoo'),            -- mismo nombre, distinto teléfono
    ('Gemelas SA', '6671234567', 'odoo'), ('Gemelas SA', '5551234567', 'odoo'),                                    -- mismo nombre Y mismos últimos 4: indistinguibles
    ('Zona Serie Enum', '6670000300', 'odoo');
  insert into public.customers (full_name, phone, source) select 'Serie Enum ' || lpad(g::text, 2, '0'), '66700004' || lpad(g::text, 2, '0'), 'odoo' from generate_series(1, 25) g;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, posA);
  perform tests.suspender(posS);
  perform tests.act_as_owner();
  select count(*) into n0 from public.customers;
  select string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname) into pol0 from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations');

  -- ══ ESTRUCTURA ═══════════════════════════════════════════════════════════════════════════════
  perform tests.ok(md5(pg_get_functiondef('public.buscar_clientes_pos(text,integer)'::regprocedure)) = '5f428aaf8e8c03147c0d07203ed4a9b4' and md5(pg_get_functiondef('public._c4a_nombre_visible(text)'::regprocedure)) = '2996a5666d351dd2c19a4a505d847c3c',
    'C4-A · función y auxiliar en su versión (md5)');
  perform tests.ok((select count(*) = 1 and bool_and(proowner = 'postgres'::regrole and prosecdef and proconfig = array['search_path=public'] and proretset
                      and pg_get_function_result(oid) = 'TABLE(customer_id uuid, nombre text, telefono_mascara text)' and pg_get_function_identity_arguments(oid) = 'q text, limite integer')
                    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'buscar_clientes_pos'), 'C4-A · una sola firma (q text, limite integer) → exactamente tres columnas; SECURITY DEFINER con search_path fijo');
  perform tests.ok(has_function_privilege('authenticated', 'public.buscar_clientes_pos(text,integer)', 'execute') and not has_function_privilege('anon', 'public.buscar_clientes_pos(text,integer)', 'execute')
               and not has_function_privilege('service_role', 'public.buscar_clientes_pos(text,integer)', 'execute') and not has_function_privilege('authenticated', 'public._c4a_nombre_visible(text)', 'execute')
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.proname in ('buscar_clientes_pos', '_c4a_nombre_visible') and a.grantee = 0),
    'C4-A · permisos mínimos: solo authenticated ejecuta la búsqueda; PUBLIC, anon y service_role no; la auxiliar no es invocable');

  -- ══ CONTRATO (como Dirección, que no tiene freno) ════════════════════════════════════════════
  perform tests.act_as(v_admin);
  perform tests.ok((select bool_and((select array_agg(k order by k) from jsonb_object_keys(to_jsonb(x)) k) = array['customer_id', 'nombre', 'telefono_mascara']) from public.buscar_clientes_pos('cuenta') x),
    'C4-A · cada fila trae exactamente customer_id, nombre y telefono_mascara');
  perform tests.ok((select count(*) = 1 and bool_and(customer_id = cA and nombre = 'Clínica Ñandú Ángeles' and telefono_mascara = '••••0001') from public.buscar_clientes_pos('nandu ang')),
    'C4-A · por nombre, sin acentos ni mayúsculas: encuentra la cuenta y enmascara el teléfono (••••0001)');
  perform tests.ok((select count(*) = 1 from public.buscar_clientes_pos('  ÑANDÚ   ÁNGELES  ') where customer_id = cA), 'C4-A · mayúsculas, acentos y espacios de más no cambian el resultado');
  perform tests.ok((select string_agg(nombre, '|' order by nombre) = 'Clínica Ñandú Ángeles|Cuenta C mismo teléfono' and bool_and(telefono_mascara = '••••0001') from public.buscar_clientes_pos('0001')),
    'C4-A · por los últimos 4 dígitos: salen las DOS cuentas que comparten teléfono, cada una con su id (ninguna hereda de la otra)');
  perform tests.ok((select count(*) = 1 and bool_and(customer_id = cI and telefono_mascara = '••••0199') from public.buscar_clientes_pos('0199')), 'C4-A · teléfono internacional con formato: últimos 4 correctos');
  perform tests.ok((select telefono_mascara is null from public.buscar_clientes_pos('sin telefono') where customer_id = cN) and (select telefono_mascara is null from public.buscar_clientes_pos('tel corto') where customer_id = cS),
    'C4-A · sin teléfono, o con uno de menos de 8 dígitos: la máscara va vacía (no se revela un número corto casi entero)');
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('2345')), 'C4-A · y ese teléfono corto tampoco se encuentra por sus 4 dígitos');
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('inactiva')) and not exists (select 1 from public.buscar_clientes_pos('9999') where customer_id = cX), 'C4-A · las cuentas inactivas no aparecen');
  -- el nombre visible no arrastra contacto
  perform tests.ok((select count(*) = 1 and bool_and(customer_id = cE and nombre = 'an•••') from public.buscar_clientes_pos('0007')), 'C4-A · un correo usado como nombre sale recortado (an•••)');
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('ana')) and not exists (select 1 from public.buscar_clientes_pos('lopez')) and not exists (select 1 from public.buscar_clientes_pos('x.test')),
    'C4-A · …y no se puede encontrar escribiendo partes del correo');
  perform tests.ok((select count(*) = 1 and bool_and(nombre = 'Dra. Ruiz •••') from public.buscar_clientes_pos('ruiz')), 'C4-A · un teléfono escrito dentro del nombre se oculta');
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('ruiz 667')) and not exists (select 1 from public.buscar_clientes_pos('dra. ruiz 667 888')), 'C4-A · …y no se confirma buscándolo junto al nombre');
  -- comodines como texto
  perform tests.ok((select count(*) = 1 and bool_and(nombre = '100% Piel') from public.buscar_clientes_pos('100% p')) and not exists (select 1 from public.buscar_clientes_pos('%p%l%')) and not exists (select 1 from public.buscar_clientes_pos('p_e_'))
               and (select count(*) = 1 and bool_and(nombre = 'Under_score SA') from public.buscar_clientes_pos('r_s')) and (select count(*) = 1 from public.buscar_clientes_pos('k\s')) and not exists (select 1 from public.buscar_clientes_pos('a%a')),
    'C4-A · %, _ y \ se tratan como texto: no amplían la consulta');
  -- homónimos
  perform tests.ok((select count(*) = 2 and count(distinct customer_id) = 2 and string_agg(telefono_mascara, ',' order by telefono_mascara) = '••••0201,••••0202' from public.buscar_clientes_pos('dermatologia del valle')),
    'C4-A · dos cuentas con el mismo nombre: dos filas, distinguibles por sus últimos 4');
  perform tests.ok((select count(*) = 2 and count(distinct customer_id) = 2 and count(distinct nombre || telefono_mascara) = 1 from public.buscar_clientes_pos('gemelas')),
    'C4-A · mismo nombre y mismos últimos 4: salen las dos, idénticas a la vista, y NO se agrega ningún dato para distinguirlas');
  -- límite y orden
  perform tests.ok((select count(*) from public.buscar_clientes_pos('serie enum')) = 20 and (select count(*) from public.buscar_clientes_pos('serie enum', 1000)) = 20 and (select count(*) from public.buscar_clientes_pos('serie enum', null)) = 20
               and (select count(*) from public.buscar_clientes_pos('serie enum', 5)) = 5 and (select count(*) from public.buscar_clientes_pos('serie enum', 0)) = 1 and (select count(*) from public.buscar_clientes_pos('serie enum', -7)) = 1,
    'C4-A · máximo 20 resultados pida lo que pida (1000 → 20, nulo → 20, 5 → 5, 0 o negativo → 1)');
  select string_agg(nombre, '|') into t from public.buscar_clientes_pos('serie enum'); select string_agg(nombre, '|') into t2 from public.buscar_clientes_pos('SERIE  ENUM');
  perform tests.ok(t = t2 and t like 'Serie Enum 01|Serie Enum 02|%' and t not like '%Zona%', 'C4-A · orden determinista: primero los que EMPIEZAN por lo buscado, por nombre; repetir da lo mismo');
  perform tests.ok((select string_agg(nombre, '|') from public.buscar_clientes_pos('serie enum', 2)) = 'Serie Enum 01|Serie Enum 02', 'C4-A · sin paginación: un límite menor es el mismo arranque, no "la siguiente página"');
  -- ninguna respuesta contiene datos restringidos
  foreach q in array array['cuenta', 'clinica', 'historico', 'serie enum', '0001', '0005', '0004', 'derm', 'ruiz', '0007', 'miami', 'sin telefono', 'gemelas', '4567'] loop
    select coalesce(string_agg(to_jsonb(x)::text, ' '), '') into t from public.buscar_clientes_pos(q) x;
    perform tests.ok(regexp_replace(t, '"customer_id": "[0-9a-f-]{36}"', '', 'g') !~ prohibido, 'C4-A · «' || q || '»: sin teléfono completo, correo, RFC, ciudad, vendedor histórico, id externo ni metadatos');
  end loop;
  -- entradas inválidas: todas el MISMO error
  begin perform public.buscar_clientes_pos(''); exception when others then msg0 := sqlerrm; end;
  foreach q in array array['   ', 'ab', 'a b', 'a  ', '1', '12', '123', '12345', '6671110001', '667 111', '00 01', '+52667', '(667) 111-0001', '%%%', '___', '100%', 'a@x.test', '@', repeat('a', 61)] loop
    begin perform public.buscar_clientes_pos(q); t := 'NO FALLÓ'; exception when others then t := sqlerrm; end;
    perform tests.ok(t = msg0 and t like 'BUSQUEDA_INVALIDA%', 'C4-A · entrada inválida «' || left(q, 14) || '»: rechazada con el mismo mensaje');
  end loop;
  perform tests.throws('select * from public.buscar_clientes_pos(null)', 'BUSQUEDA_INVALIDA', 'C4-A · entrada nula: rechazada');
  perform tests.ok(msg0 !~ '[0-9]{5,}' and msg0 !~* 'customers|select|column', 'C4-A · el mensaje de error no trae datos ni detalles internos');
  perform tests.lives('select * from public.buscar_clientes_pos(repeat(''a'', 60))', 'C4-A · 60 caracteres sí se aceptan');
  perform tests.ok((select count(*) from public.buscar_clientes_pos('ñan')) = 1 and (select count(*) from public.buscar_clientes_pos('ser')) = 20, 'C4-A · tres letras bastan (también con ñ)');

  -- ══ ROLES ════════════════════════════════════════════════════════════════════════════════════
  select coalesce(string_agg(to_jsonb(x)::text, ' ' order by x.nombre, x.customer_id), '') into t from public.buscar_clientes_pos('0001') x;
  foreach u in array array[posA, posX] loop
    perform tests.act_as(u);
    select coalesce(string_agg(to_jsonb(x)::text, ' ' order by x.nombre, x.customer_id), '') into t2 from public.buscar_clientes_pos('0001') x;
    perform tests.ok(t2 = t, 'C4-A · Ventas ' || case when u = posA then 'CON esa cuenta en su cartera' else 'SIN cartera' end || ': misma respuesta que cualquiera (la búsqueda no revela quién tiene a quién)');
  end loop;
  foreach quien in array array['Facturación', 'Comm', 'Almacén', 'Empaque', 'Chofer', 'Doctor verificado', 'Doctor no verificado', 'Usuario sin perfil'] loop
    u := case quien when 'Facturación' then v_bill when 'Comm' then v_comm when 'Almacén' then v_wh when 'Empaque' then v_pk when 'Chofer' then v_drv when 'Doctor verificado' then dA when 'Doctor no verificado' then dU else v_nadie end;
    perform tests.act_as(u);
    perform tests.throws('select * from public.buscar_clientes_pos(''cuenta'')', 'NO_AUTORIZADO', 'C4-A · ' || quien || ': rechazado');
  end loop;
  begin perform public.buscar_clientes_pos('cuenta'); exception when others then t := sqlerrm; end;
  begin perform public.buscar_clientes_pos(''); exception when others then t2 := sqlerrm; end;
  perform tests.ok(t = 'NO_AUTORIZADO' and t2 = 'NO_AUTORIZADO', 'C4-A · a quien no está autorizado se le rechaza ANTES de mirar la búsqueda (mismo error con entrada válida o inválida)');
  perform tests.act_as(posS); perform tests.throws('select * from public.buscar_clientes_pos(''cuenta'')', 'CUENTA_SUSPENDIDA', 'C4-A · Ventas suspendido: rechazado');
  perform tests.act_as_anon(); perform tests.throws('select * from public.buscar_clientes_pos(''cuenta'')', 'permission denied', 'C4-A · anon: sin permiso de ejecución');
  perform tests.act_as_service(); perform tests.throws('select * from public.buscar_clientes_pos(''cuenta'')', 'permission denied', 'C4-A · service_role: sin permiso de ejecución (nadie la consume desde servidor)');

  -- ══ DESCUBRIR NO AUTORIZA ════════════════════════════════════════════════════════════════════
  perform tests.act_as(posX);
  select customer_id into u from public.buscar_clientes_pos('nandu');
  perform tests.ok(u = cA, 'C4-A · Ventas sin cartera obtiene el id de la cuenta por la búsqueda…');
  perform tests.throws(format('select public.cliente_360(%L)', u), 'NO_AUTORIZADO', 'C4-A · …y con ese id el expediente 360 lo sigue rechazando');
  perform tests.throws(format('select public.cliente_perfiles_fiscales(%L)', u), 'NO_AUTORIZADO', 'C4-A · …los perfiles fiscales también');
  perform tests.throws(format('select public.upsert_customer_contact(%L, %L)', u, '{"phone":"000"}'), 'NO_AUTORIZADO', 'C4-A · …y no puede editar su contacto');
  perform tests.act_as(posA);
  perform tests.lives(format('select public.cliente_360(%L)', cA), 'C4-A · el vendedor con la cuenta en su cartera sí abre el expediente (vía autorizada y separada)');
  perform tests.throws(format('select public.cliente_360(%L)', cC), 'NO_AUTORIZADO', 'C4-A · …pero no el de la otra cuenta que comparte teléfono con la suya');
  perform tests.throws(format('select public.cliente_360(%L)', cD), 'NO_AUTORIZADO', 'C4-A · …ni el de la que comparte correo');

  -- ══ FRENO DE EXTRACCIÓN ══════════════════════════════════════════════════════════════════════
  perform tests.act_as_owner(); delete from public.rate_limit_buckets where scope like 'c4a_buscar_clientes%';
  perform tests.act_as(posR);
  for i in 1 .. 5 loop begin perform public.buscar_clientes_pos('ab'); exception when others then null; end; end loop;     -- inválidas: no consumen
  for i in 1 .. 20 loop perform public.buscar_clientes_pos('serie enum'); end loop;
  perform tests.ok(true, 'C4-A · Ventas: 20 búsquedas válidas en el minuto pasan (las 5 inválidas previas no consumieron)');
  perform tests.throws('select * from public.buscar_clientes_pos(''serie enum'')', 'LIMITE_DE_BUSQUEDAS', 'C4-A · la búsqueda 21 del minuto se rechaza');
  perform tests.throws('select * from public.buscar_clientes_pos(''0001'')', 'LIMITE_DE_BUSQUEDAS', 'C4-A · …también por dígitos, y sigue rechazada');
  perform tests.act_as(posX); perform tests.lives('select * from public.buscar_clientes_pos(''serie enum'')', 'C4-A · el freno es por usuario: otro vendedor no se ve afectado');
  perform tests.act_as(v_admin); for i in 1 .. 30 loop perform public.buscar_clientes_pos('serie enum'); end loop;
  perform tests.ok(true, 'C4-A · Dirección no tiene freno (ya puede leer la tabla)');
  perform tests.act_as_owner();
  perform tests.ok((select count = 20 from public.rate_limit_buckets where scope = 'c4a_buscar_clientes_min' and subject = posR::text order by window_start desc limit 1)
               and (select count = 20 from public.rate_limit_buckets where scope = 'c4a_buscar_clientes_dia' and subject = posR::text), 'C4-A · el conteo por usuario queda a la vista de Dirección (20 en el minuto y 20 en el día)');
  delete from public.rate_limit_buckets where scope = 'c4a_buscar_clientes_min';
  update public.rate_limit_buckets set count = 200 where scope = 'c4a_buscar_clientes_dia' and subject = posR::text;
  perform tests.act_as(posR); perform tests.throws('select * from public.buscar_clientes_pos(''serie enum'')', 'LIMITE_DE_BUSQUEDAS', 'C4-A · tope diario: tras 200 búsquedas, la 201 se rechaza aunque el minuto esté libre');

  -- ══ ADITIVA: NADA MÁS CAMBIÓ ═════════════════════════════════════════════════════════════════
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.customers) = n0, 'C4-A · la búsqueda no escribe en customers');
  perform tests.ok((select string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname) from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations')) = pol0
               and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations')) = 8, 'C4-A · políticas de customers y doctor_locations sin cambio (8)');
  perform tests.act_as(posX);
  perform tests.ok((select count(*) from public.customers where id = cA and phone is not null) = 1, 'C4-A · (documentado) Ventas AÚN lee la tabla completa: la restricción es C4-C, después de adaptar el frontend');
end $t$;
rollback;
