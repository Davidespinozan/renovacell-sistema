-- SEC-C4-A (145) · buscar_clientes_pos(q, limite): búsqueda mínima de clientes para Dirección y Ventas.
-- Devuelve SOLO customer_id, nombre y ••••últimos 4. Por nombre (≥3 caracteres con alguna letra) o EXACTAMENTE 4 dígitos.
-- Máx. 10 por búsqueda. Ventas: 20 búsquedas en cualquier tramo de 60 s y 300 filas por día comercial (America/Mazatlan).
-- Un rechazo por entrada inválida (400) o por cuota (429) NO lanza excepción: responde vacío y la transacción se confirma,
-- así el consumo y la anotación del exceso no se pierden. Encontrar una cuenta NO autoriza su expediente. ADITIVA.
begin;
do $t$
#variable_conflict use_variable
declare
  v_admin uuid := tests.fixture_admin(); posA uuid := tests.user('pos', 'c4a-posa@t.local'); posX uuid := tests.user('pos', 'c4a-posx@t.local'); posR uuid := tests.user('pos', 'c4a-posr@t.local'); posS uuid := tests.user('pos', 'c4a-poss@t.local');
  v_bill uuid := tests.user('billing'); v_comm uuid := tests.user('comm'); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing'); v_drv uuid := tests.user('driver');
  dA uuid := tests.user('doctor', 'c4a-da@t.local'); dU uuid := tests.user('doctor', 'c4a-du@t.local'); v_nadie uuid := gen_random_uuid();
  cA uuid; cC uuid; cD uuid; cO uuid; cN uuid; cS uuid; cI uuid; cE uuid; cP uuid; cX uuid; cM uuid; i int; t text; t2 text; n int; n0 int; pol0 text; q text; quien text; u uuid; hoy date;
  -- lo que una respuesta jamás puede contener: 5+ dígitos seguidos, correos, RFC, ciudad, vendedor histórico, id externo, metadatos, domicilios
  prohibido constant text := '[0-9]{5,}|@|AAA010101|Culiac|Mazatl|vendedor-odoo|ODOO-|fiscal|import|x\.test|Calle|Col\.|#';
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
  insert into public.customers (full_name, phone, source) values ('Manual Oculta SA', '6670008888', 'odoo') returning id into cM;           -- la excluirá Dirección a mano
  insert into public.customers (full_name, phone, source) values ('100% Piel', '6670000101', 'odoo'), ('Under_score SA', '6670000102', 'odoo'), ('Back\slash SA', '6670000103', 'odoo'),
    ('Dermatología del Valle', '6670000201', 'odoo'), ('Dermatología del Valle', '6670000202', 'odoo'),            -- mismo nombre, distinto teléfono
    ('Gemelas SA', '6671234567', 'odoo'), ('Gemelas SA', '5551234567', 'odoo'),                                    -- mismo nombre Y mismos últimos 4: indistinguibles
    ('Zona Serie Enum', '6670000300', 'odoo'),
    -- nombres legítimos con números: deben seguir saliendo
    ('Farmacia Domicilio 2000', '6670000501', 'odoo'), ('Spa Domicilio 5 Sentidos', '6670000502', 'odoo'), ('Clínica Domicilio 24 Horas', '6670000503', 'odoo'), ('Colonia Domicilio Estética', '6670000504', 'odoo'),
    -- "nombres" que son un domicilio: NO deben salir por ninguna vía (los dígitos finales 06xx los identifican en la prueba)
    ('Domicilio Av. Siempre Viva 742', '6670000601', 'odoo'), ('Domicilio Calle 5 de Mayo', '6670000602', 'odoo'), ('Domicilio Centro, Col. Centro, 80000', '6670000603', 'odoo'),
    ('Domicilio Consultorio #12', '6670000604', 'odoo'), ('Domicilio Blvd Zapata 1500 Int 4', '6670000605', 'odoo'), ('Domicilio Torre Médica CP 80200', '6670000606', 'odoo'), ('Domicilio Hospital km 5', '6670000607', 'odoo');
  insert into public.customers (full_name, phone, source) select 'Serie Enum ' || lpad(g::text, 2, '0'), '66700004' || lpad(g::text, 2, '0'), 'odoo' from generate_series(1, 25) g;
  insert into public.customers (full_name, source) select 'Bloque Presupuesto ' || lpad(g::text, 3, '0'), 'odoo' from generate_series(1, 400) g;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, posA);
  perform tests.suspender(posS);
  perform tests.act_as_owner();
  insert into public.c4a_exclusiones (customer_id, motivo, creado_por) values (cM, 'prueba: exclusión manual de Dirección', v_admin);   -- la mantiene Dirección con el dueño de la base: ni service_role escribe aquí
  select count(*) into n0 from public.customers;
  select string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname) into pol0 from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations');
  hoy := public._c4a_dia_local(clock_timestamp());

  -- ══ ESTRUCTURA ═══════════════════════════════════════════════════════════════════════════════
  perform tests.ok(md5(pg_get_functiondef('public.buscar_clientes_pos(text,integer)'::regprocedure)) = '34c32c8b4dcb4bd0db32dc31afaa3b09' and md5(pg_get_functiondef('public._c4a_nombre_visible(text)'::regprocedure)) = 'e50ea1b36459165de2981bc31b2cd53e'
               and md5(pg_get_functiondef('public._c4a_dia_local(timestamptz)'::regprocedure)) = 'b75573ebe4e6c1df20af0a87e8a23aa3' and md5(pg_get_functiondef('public._c4a_exceso(uuid,date,text)'::regprocedure)) = '12956d39d6b4e2b976966a24a2ce20ea',
    'C4-A · función y auxiliares en su versión (md5)');
  perform tests.ok((select count(*) = 1 and bool_and(proowner = 'postgres'::regrole and prosecdef and proconfig = array['search_path=public'] and proretset
                      and pg_get_function_result(oid) = 'TABLE(customer_id uuid, nombre text, telefono_mascara text)' and pg_get_function_arguments(oid) = 'q text, limite integer DEFAULT 10')
                    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'buscar_clientes_pos'), 'C4-A · una sola firma (q text, limite integer = 10) → exactamente tres columnas; SECURITY DEFINER con search_path fijo');
  perform tests.ok(has_function_privilege('authenticated', 'public.buscar_clientes_pos(text,integer)', 'execute') and not has_function_privilege('anon', 'public.buscar_clientes_pos(text,integer)', 'execute')
               and not has_function_privilege('service_role', 'public.buscar_clientes_pos(text,integer)', 'execute')
               and not exists (select 1 from pg_proc p where p.proname in ('_c4a_nombre_visible', '_c4a_dia_local', '_c4a_exceso') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))
               and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.proname in ('buscar_clientes_pos', '_c4a_nombre_visible', '_c4a_dia_local', '_c4a_exceso') and a.grantee = 0),
    'C4-A · permisos mínimos: solo authenticated ejecuta la búsqueda; PUBLIC, anon y service_role no; las auxiliares no son invocables');
  perform tests.ok((select count(*) = 3 and bool_and(relrowsecurity and relowner = 'postgres'::regrole and has_table_privilege('authenticated', oid, 'select') and not has_table_privilege('authenticated', oid, 'insert,update,delete,truncate')
                      and not has_table_privilege('anon', oid, 'select') and not has_table_privilege('service_role', oid, 'select')) from pg_class where oid in ('public.c4a_cuota'::regclass, 'public.c4a_excesos'::regclass, 'public.c4a_exclusiones'::regclass))
               and (select count(*) = 3 and bool_and(cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename like 'c4a\_%'),
    'C4-A · tres tablas propias con RLS: authenticated solo lee (por política, solo Dirección); nadie escribe por la API');

  -- ══ DÍA COMERCIAL (America/Mazatlan, UTC-7 todo el año) ══════════════════════════════════════
  perform tests.ok(public._c4a_dia_local('2026-10-13 06:59:59+00') = date '2026-10-12' and public._c4a_dia_local('2026-10-13 07:00:00+00') = date '2026-10-13', 'C4-A · el día cambia a las 07:00 UTC (medianoche de Mazatlán), no antes');
  perform tests.ok(public._c4a_dia_local('2026-10-12 23:59:59+00') = date '2026-10-12' and public._c4a_dia_local('2026-10-13 00:00:00+00') = date '2026-10-12', 'C4-A · la medianoche UTC (17:00 en Mazatlán) NO cambia el día comercial');
  perform tests.ok(public._c4a_dia_local('2026-07-15 06:59:59+00') = date '2026-07-14' and public._c4a_dia_local('2026-01-15 07:00:00+00') = date '2026-01-15' and public._c4a_dia_local('2026-12-31 23:00:00-07') = date '2026-12-31',
    'C4-A · mismo corte en verano e invierno (sin horario de verano) y con cualquier zona de entrada');

  -- ══ NOMBRE VISIBLE ═══════════════════════════════════════════════════════════════════════════
  perform tests.ok(public._c4a_nombre_visible('  Clínica   Ñandú  ') = 'Clínica Ñandú' and public._c4a_nombre_visible('María José Pérez') = 'María José Pérez' and public._c4a_nombre_visible('O''Brien & Hijos (Derma) S.A. de C.V.') = 'O''Brien & Hijos (Derma) S.A. de C.V.',
    'C4-A · nombre comercial, personal y con caracteres especiales: se muestran tal cual (espacios normalizados)');
  perform tests.ok(public._c4a_nombre_visible('Farmacia 2000') = 'Farmacia 2000' and public._c4a_nombre_visible('Spa 5 Sentidos') = 'Spa 5 Sentidos' and public._c4a_nombre_visible('Clínica 24 Horas') = 'Clínica 24 Horas'
               and public._c4a_nombre_visible('Colonia del Valle Estética') is not null and public._c4a_nombre_visible('Dr. No Sé') is not null and public._c4a_nombre_visible('Local Derma') is not null,
    'C4-A · números legítimos y palabras de domicilio SIN número no excluyen la cuenta');
  perform tests.ok(public._c4a_nombre_visible('ana.lopez@x.test') = 'Cliente sin nombre' and public._c4a_nombre_visible('Ana <ana@x.test>') = 'Cliente sin nombre' and public._c4a_nombre_visible(null) = 'Cliente sin nombre' and public._c4a_nombre_visible('   ') = 'Cliente sin nombre',
    'C4-A · un correo usado como nombre no se muestra ni en parte; vacío → «Cliente sin nombre»');
  perform tests.ok(public._c4a_nombre_visible('Dra. Ruiz 667 888 9999') = 'Dra. Ruiz •••' and public._c4a_nombre_visible('Tel (667) 123-4567 Derma') = 'Tel (••• Derma' and public._c4a_nombre_visible('Derma +52 1 667 123 4567') = 'Derma +•••'
               and public._c4a_nombre_visible('Tel (667) 123-4567 Derma') !~ '[0-9]' and public._c4a_nombre_visible('Derma 667.123.45.67') !~ '[0-9]',
    'C4-A · un teléfono escrito dentro del nombre se sustituye por •••');
  foreach t in array array['Av. Siempre Viva 742', 'Avenida Obregón 1200 Sur', 'Calle 5 de Mayo', 'Centro, Col. Centro, 80000', 'Consultorio #12', 'Blvd Zapata 1500 Int 4', 'Torre Médica CP 80200', 'Hospital km 5', 'Fracc. Las Quintas 33',
                           'Plaza Fiesta Local 14', 'Edificio Azul Piso 3', 'Priv. Lirios 8', 'Clínica 80000', 'Zapata 1500, Centro, Culiacán', 'Mz 4 Lt 12', 'Insurgentes s/n esq. 16 de Septiembre'] loop
    perform tests.ok(public._c4a_nombre_visible(t) is null, 'C4-A · «' || t || '» parece un domicilio: la cuenta no se muestra');
  end loop;
  perform tests.ok(public._c4a_nombre_visible('Insurgentes Sur esquina Reforma') is not null and public._c4a_nombre_visible('Paseo de los Álamos doce') is not null,
    'C4-A · (límite documentado) un domicilio sin dígitos ni código postal NO se detecta: para eso está la exclusión manual');

  -- ══ CONTRATO (como Dirección, que no tiene cuotas) ═══════════════════════════════════════════
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
    'C4-A · sin teléfono, o con uno de menos de 8 dígitos: la máscara va vacía');
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('2345')), 'C4-A · y ese teléfono corto tampoco se encuentra por sus 4 dígitos');
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('inactiva')) and not exists (select 1 from public.buscar_clientes_pos('9999') where customer_id = cX), 'C4-A · las cuentas inactivas no aparecen');
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('manual oculta')) and not exists (select 1 from public.buscar_clientes_pos('8888')), 'C4-A · una cuenta excluida a mano por Dirección no aparece ni por nombre ni por dígitos');
  perform tests.ok((select count(*) = 1 and bool_and(customer_id = cE and nombre = 'Cliente sin nombre') from public.buscar_clientes_pos('0007')), 'C4-A · la cuenta cuyo nombre es un correo solo se halla por dígitos, y sale como «Cliente sin nombre»');
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('ana')) and not exists (select 1 from public.buscar_clientes_pos('lopez')) and not exists (select 1 from public.buscar_clientes_pos('x.test')) and not exists (select 1 from public.buscar_clientes_pos('cliente sin nombre')),
    'C4-A · …y no se puede encontrar escribiendo partes del correo (ni por la etiqueta genérica)');
  perform tests.ok((select count(*) = 1 and bool_and(nombre = 'Dra. Ruiz •••') from public.buscar_clientes_pos('ruiz')), 'C4-A · un teléfono escrito dentro del nombre se oculta');
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('ruiz 667')) and not exists (select 1 from public.buscar_clientes_pos('dra. ruiz 667 888')), 'C4-A · …y no se confirma buscándolo junto al nombre');
  -- domicilios: fuera por nombre y por dígitos; los legítimos con números, dentro
  perform tests.ok((select count(*) = 4 and string_agg(nombre, '|' order by nombre) = 'Clínica Domicilio 24 Horas|Colonia Domicilio Estética|Farmacia Domicilio 2000|Spa Domicilio 5 Sentidos' from public.buscar_clientes_pos('domicilio')),
    'C4-A · de 11 cuentas con «domicilio» en el nombre salen solo las 4 legítimas; las 7 que son una dirección no aparecen');
  for i in 1 .. 7 loop
    perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('060' || i)), 'C4-A · cuenta-domicilio ' || i || ': tampoco aparece buscando sus últimos 4 dígitos');
  end loop;
  perform tests.ok(not exists (select 1 from public.buscar_clientes_pos('siempre viva')) and not exists (select 1 from public.buscar_clientes_pos('zapata')) and not exists (select 1 from public.buscar_clientes_pos('col. centro')),
    'C4-A · ni buscando por partes del domicilio');
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
  perform tests.ok((select count(*) from public.buscar_clientes_pos('serie enum')) = 10 and (select count(*) from public.buscar_clientes_pos('serie enum', 1000)) = 10 and (select count(*) from public.buscar_clientes_pos('serie enum', 20)) = 10
               and (select count(*) from public.buscar_clientes_pos('serie enum', null)) = 10 and (select count(*) from public.buscar_clientes_pos('serie enum', 5)) = 5
               and (select count(*) from public.buscar_clientes_pos('serie enum', 0)) = 1 and (select count(*) from public.buscar_clientes_pos('serie enum', -7)) = 1,
    'C4-A · máximo 10 resultados pida lo que pida (1000 → 10, 20 → 10, nulo → 10, 5 → 5, 0 o negativo → 1)');
  select string_agg(nombre, '|') into t from public.buscar_clientes_pos('serie enum'); select string_agg(nombre, '|') into t2 from public.buscar_clientes_pos('SERIE  ENUM');
  perform tests.ok(t = t2 and t like 'Serie Enum 01|Serie Enum 02|%' and t not like '%Zona%', 'C4-A · orden determinista: primero los que EMPIEZAN por lo buscado, por nombre; repetir da lo mismo');
  perform tests.ok((select string_agg(nombre, '|') from public.buscar_clientes_pos('serie enum', 2)) = 'Serie Enum 01|Serie Enum 02', 'C4-A · sin paginación: un límite menor es el mismo arranque, no "la siguiente página"');
  -- ninguna respuesta contiene datos restringidos
  foreach q in array array['cuenta', 'clinica', 'historico', 'serie enum', '0001', '0005', '0004', 'derm', 'ruiz', '0007', 'miami', 'sin telefono', 'gemelas', '4567', 'domicilio', 'centro'] loop
    select coalesce(string_agg(to_jsonb(x)::text, ' '), '') into t from public.buscar_clientes_pos(q) x;
    perform tests.ok(regexp_replace(t, '"customer_id": "[0-9a-f-]{36}"', '', 'g') !~ prohibido, 'C4-A · «' || q || '»: sin teléfono completo, correo, RFC, ciudad, vendedor histórico, id externo, metadatos ni domicilio');
  end loop;
  -- entradas inválidas: sin excepción, sin filas, estado 400 uniforme
  foreach q in array array['', '   ', 'ab', 'a b', 'a  ', '1', '12', '123', '12345', '6671110001', '667 111', '00 01', '+52667', '(667) 111-0001', '%%%', '___', '100%', 'a@x.test', '@', repeat('a', 61), repeat('a', 5000)] loop
    perform set_config('response.status', '', true); perform set_config('response.headers', '', true);
    select count(*) into n from public.buscar_clientes_pos(q);
    perform tests.ok(n = 0 and current_setting('response.status', true) = '400' and current_setting('response.headers', true) = '[{"X-Busqueda-Estado": "BUSQUEDA_INVALIDA"}]', 'C4-A · entrada inválida «' || left(q, 14) || '»: vacío y estado 400, sin distinguir el motivo');
  end loop;
  perform set_config('response.status', '', true); select count(*) into n from public.buscar_clientes_pos(null);
  perform tests.ok(n = 0 and current_setting('response.status', true) = '400', 'C4-A · entrada nula: vacío y estado 400');
  perform set_config('response.status', '', true); perform set_config('response.headers', '', true);
  perform tests.ok((select count(*) from public.buscar_clientes_pos(repeat('a', 60))) = 0 and coalesce(current_setting('response.status', true), '') = '', 'C4-A · 60 caracteres sí son una búsqueda válida (estado normal aunque no haya resultados)');
  perform tests.ok((select count(*) from public.buscar_clientes_pos('ñan')) = 1 and (select count(*) from public.buscar_clientes_pos('ser')) = 10, 'C4-A · tres letras bastan (también con ñ)');
  perform tests.ok(not exists (select 1 from public.c4a_cuota where user_id = v_admin) and not exists (select 1 from public.c4a_excesos where user_id = v_admin), 'C4-A · Dirección no tiene cuota ni genera excesos');

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
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from public.c4a_cuota where user_id in (v_bill, v_comm, v_wh, v_pk, v_drv, dA, dU, v_nadie, posS)) and not exists (select 1 from public.c4a_excesos where user_id in (v_bill, v_wh, dA, v_nadie, posS)),
    'C4-A · un rechazo de autorización no crea cuota ni se anota como exceso (no es un exceso de cuota: es un acceso denegado)');

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

  -- ══ FRECUENCIA: 20 en CUALQUIER tramo de 60 s (ventana deslizante) ═══════════════════════════
  perform tests.act_as_owner(); delete from public.c4a_cuota where user_id = posR; delete from public.c4a_excesos where user_id = posR;
  perform tests.act_as(posR);
  for i in 1 .. 20 loop perform public.buscar_clientes_pos('zzz sin resultados'); end loop;
  perform tests.act_as_owner();
  perform tests.ok((select cardinality(marcas) = 20 and filas = 0 and dia = hoy from public.c4a_cuota where user_id = posR), 'C4-A · 20 búsquedas sin resultados: 20 marcas de frecuencia y 0 filas consumidas');
  perform tests.act_as(posR); perform set_config('response.status', '', true);
  select count(*) into n from public.buscar_clientes_pos('serie enum');
  perform tests.ok(n = 0 and current_setting('response.status', true) = '429' and current_setting('response.headers', true) like '%LIMITE_FRECUENCIA%', 'C4-A · la búsqueda 21 dentro de 60 s: vacío y estado 429, sin excepción');
  perform tests.act_as_owner();
  perform tests.ok((select intentos = 1 and tipo = 'frecuencia' and dia = hoy from public.c4a_excesos where user_id = posR) and (select cardinality(marcas) = 20 and filas = 0 from public.c4a_cuota where user_id = posR),
    'C4-A · el exceso QUEDA anotado (vendedor, día, tipo, intentos) y el rechazo no consume ni frecuencia ni filas');
  -- la ventana se desliza: a los 59 s de las 20 marcas sigue cerrada; al cumplir 60 s se libera una a una
  update public.c4a_cuota set marcas = (select array_agg(clock_timestamp() - interval '59 seconds' + (g * interval '1 millisecond')) from generate_series(1, 20) g) where user_id = posR;
  perform tests.act_as(posR); perform set_config('response.status', '', true); select count(*) into n from public.buscar_clientes_pos('serie enum');
  perform tests.ok(n = 0 and current_setting('response.status', true) = '429', 'C4-A · 20 búsquedas hace 59 s: la 21 sigue rechazada (no hay "minuto nuevo" de reloj)');
  perform tests.act_as_owner();
  update public.c4a_cuota set marcas = (select array_agg(clock_timestamp() - interval '61 seconds' + (g * interval '300 millisecond')) from generate_series(1, 20) g) where user_id = posR;   -- 3 ya cumplieron 60 s; 17 aún no
  perform tests.act_as(posR); n := 0;
  for i in 1 .. 6 loop perform set_config('response.status', '', true); perform public.buscar_clientes_pos('zzz'); if coalesce(current_setting('response.status', true), '') = '' then n := n + 1; end if; end loop;
  perform tests.ok(n = 3, 'C4-A · solo se liberan las que YA cumplieron 60 s: de 6 intentos pasan exactamente 3 (obtenido ' || n || ')');
  perform tests.act_as(posX); perform set_config('response.status', '', true);
  perform tests.ok((select count(*) from public.buscar_clientes_pos('serie enum')) = 10 and coalesce(current_setting('response.status', true), '') = '', 'C4-A · la frecuencia es por usuario: otro vendedor no se ve afectado');
  perform tests.act_as(v_admin); for i in 1 .. 30 loop perform public.buscar_clientes_pos('serie enum'); end loop;
  perform tests.ok(true, 'C4-A · Dirección no tiene límite de frecuencia');

  -- ══ PRESUPUESTO: 300 filas por día comercial; nunca más de lo que queda ══════════════════════
  perform tests.act_as_owner(); delete from public.c4a_cuota where user_id = posR; delete from public.c4a_excesos where user_id = posR;
  perform tests.act_as(posR);
  perform tests.ok((select count(*) from public.buscar_clientes_pos('bloque presupuesto')) = 10, 'C4-A · una búsqueda de 10 filas…');
  perform tests.ok((select count(*) from public.buscar_clientes_pos('bloque presupuesto', 3)) = 3 and (select count(*) from public.buscar_clientes_pos('zzz nada')) = 0, 'C4-A · …otra de 3 y otra sin resultados…');
  perform tests.act_as_owner();
  perform tests.ok((select filas = 13 and cardinality(marcas) = 3 from public.c4a_cuota where user_id = posR), 'C4-A · …consumen EXACTAMENTE 13 filas (10 + 3 + 0) y 3 de frecuencia');
  update public.c4a_cuota set filas = 296, marcas = '{}' where user_id = posR;
  perform tests.act_as(posR); perform set_config('response.headers', '', true);
  select string_agg(nombre, '|') into t from public.buscar_clientes_pos('bloque presupuesto');
  perform tests.ok(t = 'Bloque Presupuesto 001|Bloque Presupuesto 002|Bloque Presupuesto 003|Bloque Presupuesto 004' and current_setting('response.headers', true) like '%PRESUPUESTO_AGOTADO%',
    'C4-A · con 4 filas disponibles y una búsqueda de 10: devuelve las 4 primeras, deterministas, y avisa que se agotó');
  perform tests.act_as_owner(); perform tests.ok((select filas = 300 from public.c4a_cuota where user_id = posR), 'C4-A · …y descuenta exactamente 4 (queda en 300, no en 306)');
  perform tests.act_as(posR); perform set_config('response.status', '', true); select count(*) into n from public.buscar_clientes_pos('serie enum');
  perform tests.ok(n = 0 and current_setting('response.status', true) = '429' and current_setting('response.headers', true) like '%LIMITE_FILAS%', 'C4-A · presupuesto agotado: vacío y estado 429');
  perform set_config('response.status', '', true); select count(*) into n from public.buscar_clientes_pos('0001');
  perform tests.ok(n = 0 and current_setting('response.status', true) = '429', 'C4-A · …también por dígitos');
  perform tests.act_as_owner();
  perform tests.ok((select intentos = 2 from public.c4a_excesos where user_id = posR and tipo = 'filas' and dia = hoy) and (select filas = 300 from public.c4a_cuota where user_id = posR), 'C4-A · los dos intentos quedan anotados como exceso de filas; el presupuesto no pasa de 300');
  update public.c4a_cuota set filas = 299, marcas = '{}' where user_id = posR;
  perform tests.act_as(posR); perform tests.ok((select count(*) from public.buscar_clientes_pos('bloque presupuesto')) = 1, 'C4-A · con 1 fila disponible devuelve 1');
  perform tests.act_as(posX); perform tests.ok((select count(*) from public.buscar_clientes_pos('bloque presupuesto')) = 10, 'C4-A · el presupuesto es por usuario: otro vendedor conserva el suyo');
  -- cambio de día comercial: el estado de "ayer" no cuenta hoy
  perform tests.act_as_owner(); update public.c4a_cuota set dia = hoy - 1, filas = 300, invalidas = 99, marcas = '{}' where user_id = posR;
  perform tests.act_as(posR); perform set_config('response.status', '', true);
  perform tests.ok((select count(*) from public.buscar_clientes_pos('bloque presupuesto')) = 10 and coalesce(current_setting('response.status', true), '') = '', 'C4-A · al cambiar el día comercial el presupuesto se renueva');
  perform tests.act_as_owner(); perform tests.ok((select dia = hoy and filas = 10 and invalidas = 0 from public.c4a_cuota where user_id = posR), 'C4-A · …y el contador arranca en el día nuevo (10 filas, 0 inválidas)');

  -- ══ ENTRADAS INVÁLIDAS: consumen frecuencia, no filas; el abuso se corta ═════════════════════
  delete from public.c4a_cuota where user_id = posR; delete from public.c4a_excesos where user_id = posR;
  perform tests.act_as(posR);
  for i in 1 .. 20 loop perform public.buscar_clientes_pos('ab'); end loop;
  perform set_config('response.status', '', true); perform public.buscar_clientes_pos('serie enum');
  perform tests.ok(current_setting('response.status', true) = '429' and current_setting('response.headers', true) like '%LIMITE_FRECUENCIA%', 'C4-A · 20 entradas inválidas en 60 s agotan la frecuencia: la siguiente (aunque sea válida) da 429');
  perform tests.act_as_owner();
  perform tests.ok((select filas = 0 and invalidas = 20 from public.c4a_cuota where user_id = posR), 'C4-A · …sin gastar una sola fila del presupuesto diario');
  update public.c4a_cuota set invalidas = 60, marcas = '{}' where user_id = posR;
  perform tests.act_as(posR); perform set_config('response.status', '', true); perform public.buscar_clientes_pos('ab');
  perform tests.ok(current_setting('response.status', true) = '429' and current_setting('response.headers', true) like '%LIMITE_INVALIDAS%', 'C4-A · más de 60 inválidas en el día: se tratan como abuso (429)');
  perform set_config('response.status', '', true);
  perform tests.ok((select count(*) from public.buscar_clientes_pos('serie enum')) = 10 and coalesce(current_setting('response.status', true), '') = '', 'C4-A · …pero una búsqueda válida sigue funcionando (el corte es solo para las inválidas)');
  perform tests.act_as_owner();
  perform tests.ok((select intentos = 1 from public.c4a_excesos where user_id = posR and tipo = 'invalidas') and (select intentos = 1 from public.c4a_excesos where user_id = posR and tipo = 'frecuencia'), 'C4-A · ambos excesos quedan anotados, cada uno con su tipo');

  -- ══ OBSERVABILIDAD Y PROTECCIÓN DEL REGISTRO ═════════════════════════════════════════════════
  perform tests.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('c4a_excesos', 'c4a_cuota') and column_name ~* '(q|busqueda|texto|query|nombre|telefono|phone|email|resultado)'),
    'C4-A · ni el registro de excesos ni la cuota tienen columna para el texto buscado ni para lo devuelto');
  insert into public.c4a_excesos (user_id, dia, tipo) values (posX, hoy - 200, 'filas'), (posX, hoy - 91, 'frecuencia'), (posX, hoy - 90, 'filas');
  perform public._c4a_exceso(posX, hoy, 'frecuencia');
  perform tests.ok((select count(*) = 2 and min(dia) = hoy - 90 from public.c4a_excesos where user_id = posX), 'C4-A · retención: al anotar un día nuevo se retiran los excesos de más de 90 días (crecimiento acotado, sin tarea programada)');
  perform public._c4a_exceso(posX, hoy, 'frecuencia'); perform public._c4a_exceso(posX, hoy, 'frecuencia');
  perform tests.ok((select count(*) = 1 and max(intentos) = 3 from public.c4a_excesos where user_id = posX and dia = hoy), 'C4-A · mil rechazos en un día son UNA fila con su contador, no mil filas');
  perform tests.act_as(v_admin);
  perform tests.ok((select count(*) >= 3 from public.c4a_excesos) and (select count(*) >= 2 from public.c4a_cuota) and (select count(*) = 1 from public.c4a_exclusiones), 'C4-A · Dirección consulta excesos, uso por vendedor y exclusiones');
  perform tests.throws('insert into public.c4a_exclusiones (customer_id, motivo) values (gen_random_uuid(), ''x'')', 'permission denied', 'C4-A · …pero ni Dirección escribe estas tablas por la API (solo lectura)');
  foreach u in array array[posR, posX, v_bill, dA, v_nadie] loop
    perform tests.act_as(u);
    perform tests.ok((select count(*) from public.c4a_excesos) = 0 and (select count(*) from public.c4a_cuota) = 0 and (select count(*) from public.c4a_exclusiones) = 0,
      'C4-A · ' || case u when posR then 'Ventas (con excesos propios)' when posX then 'otro vendedor' when v_bill then 'Facturación' when dA then 'un doctor' else 'una cuenta sin perfil' end || ': no ve excesos, cuotas ni exclusiones (ni los suyos)');
  end loop;
  perform tests.act_as(posR);
  foreach q in array array['update public.c4a_cuota set filas = 0, marcas = ''{}''', 'delete from public.c4a_cuota', 'insert into public.c4a_cuota (user_id) values (gen_random_uuid())', 'update public.c4a_excesos set intentos = 1', 'delete from public.c4a_excesos',
                           'delete from public.c4a_exclusiones', 'truncate public.c4a_cuota', format('select public._c4a_exceso(%L, current_date, ''filas'')', posX), 'select public._c4a_dia_local(now())', 'select public._c4a_nombre_visible(''x'')'] loop
    perform tests.throws(q, 'permission denied', 'C4-A · Ventas no puede: ' || left(q, 60));
  end loop;
  perform tests.act_as_anon(); perform tests.throws('select count(*) from public.c4a_excesos', 'permission denied', 'C4-A · anon: sin acceso a los excesos');

  -- ══ ADITIVA: NADA MÁS CAMBIÓ ═════════════════════════════════════════════════════════════════
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.customers) = n0, 'C4-A · la búsqueda no escribe en customers');
  perform tests.ok((select string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname) from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations')) = pol0
               and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations')) = 8, 'C4-A · políticas de customers y doctor_locations sin cambio (8)');
  perform tests.act_as(posX);
  perform tests.ok((select count(*) from public.customers where id = cA and phone is not null) = 1, 'C4-A · (documentado) Ventas AÚN lee la tabla completa: la restricción es C4-C, después de adaptar el frontend');
end $t$;
rollback;
