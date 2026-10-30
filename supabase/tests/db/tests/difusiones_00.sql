-- HERRAMIENTAS DEL VENDEDOR · bloque D (20270217) · listas de difusión: el vendedor arma sus listas con SUS clientes, manda
-- por correo (buzón, plantilla 'difusion', con baja) y por el chat del portal (tarjeta) a una lista, a un filtro o a toda su
-- cartera; quien se dio de baja no recibe correos; 5 por día; jefe y Dirección llegan a todos.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sJefe uuid := tests.user('pos'); d1 uuid := tests.user('doctor', 'ana.dif@test.local');
  cuAna uuid; cuDerma uuid; cuClin uuid; cuSinCorreo uuid; cuOtro uuid; l1 uuid; r jsonb; v_tok uuid; i int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","jefe_ventas"]}' where id = sJefe;
  cuAna := tests.cliente(d1);
  update public.customers set full_name = 'Ana Pérez', email = null, tipo_cliente = 'doctor', especialidad = 'dermatologia' where id = cuAna;   -- correo de su cuenta
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  insert into public.customers (full_name, email, active, tipo_cliente, especialidad) values ('Beto Derma', 'beto@test.local', true, 'doctor', 'dermatologia') returning id into cuDerma;
  insert into public.customers (full_name, email, active, tipo_cliente) values ('Clínica Sol', 'sol@test.local', true, 'clinica') returning id into cuClin;
  insert into public.customers (full_name, active, tipo_cliente) values ('Sin Correo', true, 'doctor') returning id into cuSinCorreo;
  insert into public.customers (full_name, email, active) values ('De Otro', 'otro@test.local', true) returning id into cuOtro;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cuDerma, s1), (cuClin, s1), (cuSinCorreo, s1), (cuOtro, s2);

  -- ══ 1 · listas propias ══
  perform tests.act_as(s1);
  l1 := (public.lista_guardar(null, ' Dermatólogos  VIP ') ->> 'id')::uuid;
  perform tests.eq((public.mis_listas() -> 0 ->> 'nombre'), 'Dermatólogos VIP', '1 · crea su lista');
  perform tests.throws('select public.lista_guardar(null, ''dermatólogos vip'')', 'LISTA_REPETIDA', '1 · sin nombres repetidos');
  perform tests.eq((public.lista_clientes_cambiar(l1, array[cuAna, cuOtro], true) ->> 'clientes')::int, 1, '1 · solo entran SUS clientes (el de otro vendedor no)');
  perform tests.eq((public.lista_agregar_filtro(l1, 'doctor', 'dermatologia') ->> 'clientes')::int, 2, '1 · agregar por filtro: todos sus dermatólogos');
  r := public.lista_buscar_clientes(l1, 'sol', false);
  perform tests.ok(r -> 0 ->> 'nombre' = 'Clínica Sol' and not (r -> 0 ->> 'en_lista')::boolean and (r -> 0 ->> 'con_correo')::boolean, '1 · buscar para agregar, marca si ya está');
  perform tests.eq(jsonb_array_length(public.lista_buscar_clientes(l1, null, true)), 2, '1 · ver solo los de la lista');
  perform tests.eq((public.lista_clientes_cambiar(l1, array[cuDerma], false) ->> 'clientes')::int, 1, '1 · quitar de la lista');
  perform public.lista_clientes_cambiar(l1, array[cuDerma], true);
  perform tests.act_as(s2);
  perform tests.throws(format('select public.lista_clientes_cambiar(%L, %L, true)', l1, array[cuOtro]), 'NO_AUTORIZADO', '1 · nadie toca la lista de otro');
  perform tests.eq(jsonb_array_length(public.mis_listas()), 0, '1 · ni la ve');

  -- ══ 2 · previa y envío ══
  perform tests.act_as(s1);
  r := public.difusion_previa('{"tipo":"cartera"}');
  perform tests.ok((r ->> 'total')::int = 4 and (r ->> 'con_correo')::int = 3 and (r ->> 'sin_correo')::int = 1 and (r ->> 'con_cuenta')::int = 1, '2 · previa de su cartera: cuántos por correo y por chat');
  r := public.difusion_enviar('Nuevo Dysport 500', 'Ya llegó el Dysport de 500 UI. Pídelo por aquí.', 'https://renovacell.mx/promo', 'https://cdn.test/dysport.jpg', jsonb_build_object('tipo', 'lista', 'etiqueta_id', l1), array['correo', 'chat']);
  perform tests.ok((r ->> 'destinatarios')::int = 2 and (r ->> 'correo')::int = 2 and (r ->> 'chat')::int = 1, '2 · a su lista: 2 correos (uno con el correo de su cuenta) y 1 chat (la que tiene cuenta)');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 2 and bool_and(plantilla = 'difusion' and status = 'pendiente' and payload ->> 'baja_url' like 'https://renovacell.mx/baja?t=%') from public.comm_outbox where event_key like 'difusion:' || (r ->> 'id') || ':%'), '2 · los correos van al buzón, con su enlace de baja');
  perform tests.ok(exists (select 1 from public.cc_messages m join public.cc_conversations c on c.id = m.conversation_id where c.profile_id = d1 and m.actor_type = 'system' and m.content like '[difusion:' || (r ->> 'id') || ']%[enlace] https://renovacell.mx/promo%[imagen] https://cdn.test/dysport.jpg'), '2 · en su chat del portal, como tarjeta');
  perform tests.act_as(s1);
  r := public.difusion_enviar('A mis doctores', 'Hola doctores', null, null, '{"tipo":"filtro","tipo_cliente":"doctor"}', array['correo']);
  perform tests.ok((r ->> 'destinatarios')::int = 3 and (r ->> 'sin_correo')::int = 1, '2 · por filtro (doctores): el que no tiene correo queda contado');
  perform tests.throws('select public.difusion_enviar(''Hola'', ''x'', ''http://inseguro.com'', null, ''{"tipo":"cartera"}'', array[''correo''])', 'ck_dif_enlace', '2 · enlaces solo https');
  perform tests.throws('select public.difusion_enviar(''Hola'', ''x'', null, null, ''{"tipo":"cartera"}'', array[]::text[])', 'DATO_INVALIDO:canales', '2 · al menos un canal');

  -- ══ 3 · baja: ya no recibe difusiones por correo ══
  perform tests.act_as_owner();
  select correo_baja_token into v_tok from public.customers where id = cuDerma;
  perform tests.act_as_anon();
  perform tests.eq(public.correo_baja(v_tok) ->> 'ok', 'true', '3 · con el enlace del correo, sin sesión');
  perform tests.eq(public.correo_baja(gen_random_uuid()) ->> 'ok', 'false', '3 · un token inventado no hace nada');
  perform tests.act_as(s1);
  r := public.difusion_enviar('Otra', 'Texto', null, null, jsonb_build_object('tipo', 'lista', 'etiqueta_id', l1), array['correo']);
  perform tests.ok((r ->> 'correo')::int = 1 and (r ->> 'dados_de_baja')::int = 1, '3 · quien se dio de baja ya no recibe correo');

  -- ══ 4 · freno diario, historial, prueba, alcance del jefe ══
  perform public.difusion_enviar('Cuarta', 'x', null, null, '{"tipo":"cartera"}', array['correo']);
  perform public.difusion_enviar('Quinta', 'x', null, null, '{"tipo":"cartera"}', array['correo']);
  perform tests.throws('select public.difusion_enviar(''Sexta'', ''x'', null, null, ''{"tipo":"cartera"}'', array[''correo''])', 'LIMITE_DIARIO', '4 · máximo 5 difusiones por día');
  perform tests.eq(jsonb_array_length(public.mis_difusiones()), 5, '4 · su historial');
  perform tests.ok(public.difusion_prueba('Hola', 'x', null, null) ->> 'para' like '%•••@test.local', '4 · prueba a su propio correo (enmascarado)');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.comm_outbox where event_key like 'difusion-prueba:' || s1::text || ':%' and payload ->> 'prueba' = 'true' and payload -> 'baja_url' is null), '4 · la prueba va al buzón, sin enlace de baja');
  perform tests.act_as(s1);
  perform tests.act_as(sJefe);
  perform tests.eq((public.difusion_previa('{"tipo":"cartera"}') ->> 'total')::int >= 5, true, '4 · el jefe de ventas llega a todos');
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.mis_difusiones()) x where x ->> 'vendedor' is not null and not (x ->> 'es_mia')::boolean), '4 · y ve las del equipo');
  perform tests.act_as(d1);
  perform tests.throws('select public.mis_listas()', 'NO_AUTORIZADO', '4 · un doctor no');
  perform tests.act_as(s1);
  perform tests.throws('select count(*) from public.cc_difusiones', 'permission denied', '4 · las tablas no se leen directo');
end $t$;
rollback;
