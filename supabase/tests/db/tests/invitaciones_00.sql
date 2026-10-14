-- INVITACIONES (153) · el cliente existente crea su cuenta por invitación y nace ligada a su expediente y VERIFICADA.
-- Solo Dirección o su vendedor invitan; el enlace se usa una vez, vence y la nueva revoca a la anterior.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); dOtro uuid := tests.user('doctor');
  cu uuid; cuCon uuid; cuBaja uuid; r jsonb; tok text; tok2 text; h text; h2 text; nuevo uuid; nuevo2 uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);
  insert into public.customers (full_name, email, phone, active, source) values ('Dra. Odoo Existente', 'odoo@test.local', '6698880001', true, 'odoo') returning id into cu;
  insert into public.customers (full_name, active) values ('Baja', false) returning id into cuBaja;
  cuCon := tests.cliente(dOtro);
  perform tests.act_as(v_admin); perform public.cliente_vendedor_asignar(cu, s1, null);

  -- ══ 1 · quién invita ══
  perform tests.act_as(s2);
  perform tests.throws(format('select public.cliente_invitacion_crear(%L)', cu), 'NO_AUTORIZADO', '1 · otro vendedor no invita a un cliente ajeno');
  perform tests.act_as(dOtro);
  perform tests.throws(format('select public.cliente_invitacion_crear(%L)', cu), 'NO_AUTORIZADO', '1 · un doctor no invita');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cliente_invitacion_crear(%L)', cu), 'permission denied', '1 · anónimo no invita');
  perform tests.act_as(s1);
  r := public.cliente_invitacion_crear(cu); tok := r ->> 'token';
  perform tests.ok(tok ~ '^[A-Za-z0-9_-]{43}$' and r ->> 'nombre' = 'Dra. Odoo Existente' and r ->> 'email' = 'odoo@test.local' and r ->> 'telefono' is not null, '1 · su vendedor invita: secreto de 43 caracteres, nombre, correo y teléfono');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cliente_invitacion_crear(%L)', cuCon), 'YA_TIENE_CUENTA', '1 · quien ya tiene cuenta no se invita');
  perform tests.throws(format('select public.cliente_invitacion_crear(%L)', cuBaja), 'CLIENTE_INACTIVO', '1 · un cliente dado de baja no se invita');
  perform tests.throws('select count(*) from public.cliente_invitaciones', 'permission denied', '1 · la tabla no se lee directo');

  -- ══ 2 · el secreto no se guarda; la nueva revoca la anterior ══
  perform tests.act_as_service();
  h := encode(extensions.digest(tok, 'sha256'), 'hex');
  perform tests.ok((select token_hash = h and creada_por = s1 and expira_at > now() + interval '13 days' from public.cliente_invitaciones where customer_id = cu), '2 · solo la huella, con quién invitó y vencimiento de 14 días');
  perform tests.ok(not exists (select 1 from public.cliente_invitaciones where token_hash = tok), '2 · el secreto en claro no está en la base');
  perform tests.eq(public.cliente_invitacion_ver(h) - 'email', '{"estado": "valida", "nombre": "Dra. Odoo Existente"}'::jsonb, '2 · el enlace sirve');
  perform tests.act_as(v_admin);
  tok2 := public.cliente_invitacion_crear(cu) ->> 'token';
  perform tests.act_as_service();
  h2 := encode(extensions.digest(tok2, 'sha256'), 'hex');
  perform tests.eq(public.cliente_invitacion_ver(h) ->> 'estado', 'revocada', '2 · una invitación nueva revoca la anterior');
  perform tests.eq(public.cliente_invitacion_ver(repeat('0', 64)) ->> 'estado', 'inexistente', '2 · huella desconocida');
  perform tests.eq(public.cliente_invitacion_ver('basura') ->> 'estado', 'inexistente', '2 · entrada mal formada');

  -- ══ 3 · aceptar: la cuenta nace ligada y verificada, con su vendedor ══
  nuevo := tests.user('doctor', 'nueva.cuenta@test.local'); update public.profiles set verified = false, full_name = '' where id = nuevo;
  perform tests.throws(format('select public.cliente_invitacion_aceptar(%L, %L)', h, nuevo), 'INVITACION_REVOCADA', '3 · la invitación revocada no sirve');
  r := public.cliente_invitacion_aceptar(h2, nuevo);
  perform tests.eq((r ->> 'verificado')::boolean, true, '3 · aceptada');
  perform tests.ok((select profile_id = nuevo from public.customers where id = cu), '3 · la cuenta queda ligada al expediente');
  perform tests.ok((select verified and full_name = 'Dra. Odoo Existente' and meta -> 'verification' ->> 'via' = 'cliente_existente' and meta -> 'verification' ->> 'reviewed_by' = v_admin::text from public.profiles where id = nuevo), '3 · verificada, con su nombre y constancia de quién la invitó (la última invitación la mandó Dirección)');
  perform tests.ok((select seller_profile_id = s1 from public.cc_cartera where profile_id = nuevo) and not exists (select 1 from public.cc_cartera_clientes where customer_id = cu), '3 · conserva su vendedor (pasa a la cartera de la cuenta)');
  perform tests.ok(exists (select 1 from public.customer_events where customer_id = cu and tipo = 'cuenta_creada') and exists (select 1 from public.customer_events where customer_id = cu and tipo = 'invitacion_creada'), '3 · queda en la actividad del cliente');
  perform tests.eq(public.cliente_invitacion_ver(h2) ->> 'estado', 'usada', '3 · el enlace ya no sirve');
  nuevo2 := tests.user('doctor');
  perform tests.throws(format('select public.cliente_invitacion_aceptar(%L, %L)', h2, nuevo2), 'INVITACION_USADA', '3 · no se usa dos veces');

end $t$;
do $t$
declare v_admin uuid := tests.fixture_admin(); cu uuid; d uuid := tests.user('doctor'); dLigado uuid := tests.user('doctor'); tok text; h text; s uuid := tests.user('pos');
begin
  perform tests.act_as_service();
  insert into public.customers (full_name, active) values ('Vence', true) returning id into cu;
  perform tests.cliente(dLigado);
  perform tests.act_as(v_admin); tok := public.cliente_invitacion_crear(cu) ->> 'token'; perform tests.act_as_service();
  h := encode(extensions.digest(tok, 'sha256'), 'hex');
  perform tests.throws(format('select public.cliente_invitacion_aceptar(%L, %L)', h, dLigado), 'PERFIL_YA_LIGADO', '4 · una cuenta ya ligada a otro expediente no se liga dos veces');
  perform tests.throws(format('select public.cliente_invitacion_aceptar(%L, %L)', h, s), 'PERFIL_INVALIDO', '4 · solo cuentas de cliente (no personal)');
  update public.cliente_invitaciones set expira_at = now() - interval '1 minute' where token_hash = h;
  perform tests.eq(public.cliente_invitacion_ver(h) ->> 'estado', 'expirada', '4 · vencida');
  perform tests.throws(format('select public.cliente_invitacion_aceptar(%L, %L)', h, d), 'INVITACION_EXPIRADA', '4 · vencida no se acepta');
  perform tests.act_as(d);
  perform tests.throws(format('select public.cliente_invitacion_aceptar(%L, %L)', h, d), 'permission denied', '4 · una sesión no acepta por su cuenta (solo el servidor)');
  perform tests.throws(format('select public.cliente_invitacion_ver(%L)', h), 'permission denied', '4 · ni consulta invitaciones');
end $t$;
rollback;
