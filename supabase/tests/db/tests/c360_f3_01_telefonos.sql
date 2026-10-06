-- C360-F3 · Regla ÚNICA de validez de teléfono (dueño): valor COMPLETO solo con caracteres de teléfono y
-- 10–15 dígitos en la cadena COMPLETA. La misma regla gobierna migración 121, trigger heredado y comando
-- canónico. Últimos-10 SOLO para duplicados y SOLO después de validar. Lo ambiguo no se interpreta ni repara:
-- queda intacto en customers.phone. (Números = matriz del dueño, 1–17.)
begin;
do $t$
declare
  dA uuid := tests.user('doctor'); cA uuid; cL uuid; t1 uuid; n int;
  rechazados text[] := array[
    'robert.12345678@gmail.com',      -- 4 · correo con dígitos
    '6671234567 6677654321',          -- 5 · dos números de 10 (20 dígitos)
    '6671234567 / 6677654321',        -- 5 · dos números con separador
    '1234567 y 7654321',              -- 6 · dos locales unidos por "y"
    '667 123 4567 esposa',            -- 7 · número + nota
    '1234567',                        -- 8 · 7 dígitos
    '12345678',                       -- 9 · 8 dígitos
    '1234567890123456',               -- 10 · más de 15 dígitos
    '667123456',                      -- 11 · menos de 10 dígitos
    '667#123#4567', '667_123_4567', 'tel 6671234567'];   -- 12 · caracteres no admitidos
  v text;
begin
  -- ══ 1–3 · aceptados (la regla misma) ══
  perform tests.ok(public._c360_tel_valido('6671234567'), '1 · número de 10 dígitos válido');
  perform tests.ok(public._c360_tel_valido('(667) 123-4567') and public._c360_tel_valido('667.123.4567') and public._c360_tel_valido(' 667 123 4567 '), '2 · formato (espacios, paréntesis, guion, punto) válido');
  perform tests.ok(public._c360_tel_valido('+52 667 123 4567') and public._c360_tel_valido('+123456789012345'), '3 · con lada de país hasta 15 dígitos válido');
  -- ══ 4–12 · rechazados por la regla ══
  foreach v in array rechazados loop
    perform tests.ok(not public._c360_tel_valido(v), format('4–12 · regla rechaza %L', v));
  end loop;
  perform tests.ok(not public._c360_tel_valido(null) and not public._c360_tel_valido('') and not public._c360_tel_valido('+52 (667) 123 - 4567 - - - - - - -'), '12 · vacío/nulo y más de 30 caracteres rechazados');

  -- ══ comando canónico: mismos rechazos (no se afloja) ══
  perform tests.act_as_service();
  cA := tests.cliente(dA);
  perform tests.act_as(dA);
  foreach v in array rechazados loop
    perform tests.throws(format('select public.cliente_telefono_guardar(null, null, %L, ''celular'')', v), 'TELEFONO_INVALIDO', format('4–12 · comando rechaza %L', v));
  end loop;
  t1 := (public.cliente_telefono_guardar(null, null, '+52 (667) 222-3344', 'celular', true) ->> 'id')::uuid;
  perform tests.act_as_service();
  perform tests.ok((select numero = '+52 (667) 222-3344' and numero_norm = '6672223344' from public.customer_phones where id = t1), '2/3 · comando acepta formato y lada; guarda el original y normaliza');

  -- ══ 16 · duplicado SOLO después de validar ══
  perform tests.act_as(dA);
  perform tests.throws(format('select public.cliente_telefono_guardar(null, null, %L, ''otro'')', '667 222 3344'), 'TELEFONO_DUPLICADO', '16 · válido y mismo número normalizado → duplicado');
  perform tests.throws(format('select public.cliente_telefono_guardar(null, null, %L, ''otro'')', '1234567 6672223344'), 'TELEFONO_INVALIDO', '16 · inválido cuyos últimos 10 coinciden → INVALIDO, nunca duplicado');
  perform tests.throws(format('select public.cliente_telefono_guardar(null, null, %L, ''otro'')', 'x 6672223344'), 'TELEFONO_INVALIDO', '16 · texto + número existente → INVALIDO');

  -- ══ 14/15 · trigger heredado con la MISMA regla ══
  perform tests.act_as_service();
  insert into public.customers (full_name, phone) values ('Legado ambiguo', '6671234567 / 6677654321') returning id into cL;
  perform tests.ok((select phone = '6671234567 / 6677654321' from public.customers where id = cL) and not exists (select 1 from public.customer_phones where customer_id = cL), '14 · alta heredada ambigua: no crea teléfono canónico y conserva el original');
  update public.customers set phone = 'robert.12345678@gmail.com' where id = cL;
  perform tests.ok(not exists (select 1 from public.customer_phones where customer_id = cL), '14 · escritura heredada de correo no crea teléfono');
  update public.customers set phone = '667 555 6677' where id = cL;
  perform tests.ok((select count(*) = 1 and bool_and(es_principal and origen = 'legado' and numero = '667 555 6677' and numero_norm = '6675556677') from public.customer_phones where customer_id = cL), '15 · escritura heredada válida crea el principal');
  update public.customers set phone = '(667) 555-6677' where id = cL;
  perform tests.eq((select count(*)::int from public.customer_phones where customer_id = cL), 1, '15 · mismo número con otro formato: idempotente');
  update public.customers set phone = '+52 667 888 9900' where id = cL;
  perform tests.ok((select count(*) = 2 from public.customer_phones where customer_id = cL and activo) and (select numero_norm = '6678889900' from public.customer_phones where customer_id = cL and es_principal and activo), '15 · otro número válido pasa a principal; el anterior se conserva');
  update public.customers set phone = '667 888 9900 esposa' where id = cL;
  perform tests.ok((select count(*) = 2 from public.customer_phones where customer_id = cL) and (select phone = '667 888 9900 esposa' from public.customers where id = cL), '14 · número + nota heredado: no toca los canónicos y se conserva tal cual');

  -- ══ 17 · invariantes de principal y defensa en la tabla ══
  perform tests.ok(not exists (select customer_id from public.customer_phones where activo group by customer_id having count(*) filter (where es_principal) <> 1), '17 · exactamente un principal activo por cliente con teléfonos');
  perform tests.throws(format('insert into public.customer_phones (customer_id, numero, numero_norm) values (%L, %L, %L)', cL, '1234567 y 7654321', '4567654321'), 'ck_cph_numero', '17 · la tabla rechaza un número inválido aunque alguien lo intente directo');
  perform tests.throws(format('insert into public.customer_phones (customer_id, numero, numero_norm) values (%L, %L, %L)', cL, '6671112233', '1112233'), 'ck_cph_norm', '17 · normalizado siempre de 10 dígitos');
end $t$;

-- ══ 13 · la migración 121 REAL sobre legado: valida el valor completo y no toca customers.phone ══
reset role;
select set_config('request.jwt.claims', '', true);
\ir ../../../rollback/c360_f3/99_down.sql
create temp table tel_legado (k text primary key, phone text, debe_migrar boolean);
insert into tel_legado values
  ('ok10', '6671234567', true), ('okfmt', '(667) 123-4568', true), ('okpais', '+52 667 123 4569', true),
  ('correo', 'robert.12345678@gmail.com', false), ('dos10', '6671230000 6671230001', false), ('dos10s', '6671230002 / 6671230003', false),
  ('dos7y', '1234567 y 7654321', false), ('nota', '667 123 4570 esposa', false), ('siete', '1234567', false), ('ocho', '12345678', false),
  ('mas15', '1234567890123456', false), ('raro', '667#123#4571', false);
insert into public.customers (full_name, phone) select 'Legado ' || k, phone from tel_legado;
\ir ../../../migrations/20261104120000_c360_f3_cliente_360.sql
do $m$
begin
  perform tests.ok((select bool_and(exists (select 1 from public.customer_phones t where t.customer_id = c.id and t.activo and t.es_principal and t.origen = 'migracion' and t.numero = btrim(l.phone)))
                      from tel_legado l join public.customers c on c.full_name = 'Legado ' || l.k where l.debe_migrar), '13 · válidos migrados como principal con el valor original');
  perform tests.ok((select bool_and(not exists (select 1 from public.customer_phones t where t.customer_id = c.id))
                      from tel_legado l join public.customers c on c.full_name = 'Legado ' || l.k where not l.debe_migrar), '13 · inválidos/ambiguos: ningún teléfono canónico');
  perform tests.ok((select bool_and(c.phone = l.phone) from tel_legado l join public.customers c on c.full_name = 'Legado ' || l.k), '13 · customers.phone intacto en TODOS (válidos e inválidos)');
  perform tests.eq((select count(*)::int from tel_legado l join public.customers c on c.full_name = 'Legado ' || l.k
                     where nullif(btrim(coalesce(c.phone, '')), '') is not null and not exists (select 1 from public.customer_phones t where t.customer_id = c.id and t.activo)), 9,
                   '13 · los legados quedan identificables (phone no vacío y sin teléfono canónico activo)');
end $m$;
rollback;
