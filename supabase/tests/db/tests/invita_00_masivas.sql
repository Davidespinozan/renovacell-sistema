-- INVITA-1 · invitaciones masivas: audiencia con motivos, solo Dirección crea/controla, la cola respeta horario y límite
-- diario, la base emite la invitación (solo huella), el resultado se asienta y un rechazo del canal pausa sin quemar la lista.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); dCon uuid := tests.user('doctor', 'ya.cuenta@test.local');
  a uuid; b uuid; dup1 uuid; dup2 uuid; malo uuid; conCuenta uuid; telA uuid; r jsonb; camp uuid; n int; tok text; e bigint;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  insert into public.customers (full_name, email, phone, active, source) values ('Dra. A', 'a@test.local', '6671110001', true, 'odoo') returning id into a;
  insert into public.customers (full_name, email, phone, active, source) values ('Dr. B', 'B@Test.local ', '6671110002', true, 'odoo') returning id into b;
  insert into public.customers (full_name, email, phone, active, source) values ('Dup 1', 'dup@test.local', '6671110003', true, 'odoo') returning id into dup1;
  insert into public.customers (full_name, email, phone, active, source) values ('Dup 2', 'dup@test.local', '6671110003', true, 'odoo') returning id into dup2;
  insert into public.customers (full_name, email, phone, active, source) values ('Dra. C', 'c@test.local', '6671110009', true, 'odoo'), ('Dra. D', 'd@test.local', '6671110010', true, 'odoo');
  insert into public.customers (full_name, email, phone, active, source) values ('Malo', 'malo@sin', null, true, 'odoo') returning id into malo;
  insert into public.customers (full_name, email, phone, active, source) values ('Con cuenta', 'ya.cuenta@test.local', '6671110005', true, 'odoo') returning id into conCuenta;
  insert into public.customers (full_name, email, phone, active, source) values ('Baja', 'baja@test.local', '6671110006', false, 'odoo');
  perform tests.act_as(v_admin); perform public.cliente_vendedor_asignar(a, s1, null);

  -- ══ 1 · quién ══
  perform tests.act_as(s1);
  perform tests.throws($$select public.invitaciones_masivas_previa('correo')$$, 'NO_AUTORIZADO', '1 · un vendedor no ve ni lanza campañas');
  perform tests.act_as_anon();
  perform tests.throws($$select public.invitaciones_masivas_previa('correo')$$, 'permission denied', '1 · anónimo tampoco');
  perform tests.act_as(v_admin);
  perform tests.throws('select count(*) from public.invitacion_envios', 'permission denied', '1 · las tablas no se leen directo');
  perform tests.throws($$select * from public._invm_reclamar('correo', 5)$$, 'permission denied', '1 · Dirección no reclama lotes (solo el servidor)');

  -- ══ 2 · audiencia ══
  r := public.invitaciones_masivas_previa('correo');
  perform tests.ok((r ->> 'elegibles')::int >= 2 and (r -> 'omitidos' ->> 'correo_repetido')::int >= 2 and (r -> 'omitidos' ->> 'correo_invalido')::int >= 1
                   and (r -> 'omitidos' ->> 'correo_con_cuenta')::int >= 1, '2 · correo: elegibles y omitidos por repetido, inválido y con cuenta');
  perform tests.eq((public.invitaciones_masivas_previa('correo', s1) ->> 'elegibles')::int, 1, '2 · filtro por vendedor: solo su cartera');
  perform tests.ok((public.invitaciones_masivas_previa('whatsapp') -> 'omitidos' ->> 'telefono_repetido')::int >= 2, '2 · WhatsApp: teléfono repetido se omite');
  perform tests.throws($$select count(*) from public._invm_audiencia('correo', null, false)$$, 'permission denied', '2 · la audiencia cruda no es pública');
  perform tests.act_as_service();
  perform tests.ok(not exists (select 1 from public._invm_audiencia('correo', null, false) x where x.nombre = 'Baja'), '2 · dados de baja fuera');
  perform tests.act_as(v_admin);

  -- ══ 3 · crear ══
  perform tests.throws($$select public.invitaciones_masivas_crear('whatsapp')$$, 'FALTA_PLANTILLA', '3 · WhatsApp exige la plantilla aprobada');
  r := public.invitaciones_masivas_crear('correo', null, false, 1);
  camp := (r ->> 'campana_id')::uuid;
  perform tests.ok((r ->> 'pendientes')::int >= 2 and (r ->> 'omitidos')::int >= 4, '3 · foto de la audiencia: pendientes y omitidos para revisar');
  perform tests.act_as_service();
  perform tests.ok((select destino = 'b@test.local' from public.invitacion_envios where campana_id = camp and customer_id = b), '3 · el correo se guarda normalizado');
  perform tests.act_as(v_admin);
  perform tests.throws($$select public.invitaciones_masivas_crear('correo')$$, 'CAMPANA_VIVA', '3 · una campaña viva por canal');
  perform tests.ok(jsonb_array_length(public.invitaciones_masivas_revisar(camp)) >= 4, '3 · lista de revisión con los omitidos');

  -- ══ 4 · cola: horario y límite diario ══
  perform tests.act_as_service();
  update public.cc_horario_config set configurado = false;
  perform tests.eq((select count(*)::int from public._invm_reclamar('correo', 10)), 0, '4 · sin horario configurado no sale nada (falla cerrado)');
  perform tests.eq(public._invm_despachar(), 'fuera_de_horario', '4 · el despertador tampoco llama');
  update public.cc_horario_config set configurado = true;
  insert into public.cc_horario_semanal (dia, abierto, abre, cierra) select d, true, '00:00', '23:59:59' from generate_series(1, 7) d
    on conflict (dia) do update set abierto = true, abre = '00:00', cierra = '23:59:59';
  delete from public.cc_horario_excepciones;
  perform tests.act_as_owner();
  perform tests.eq(public._invm_despachar(), 'sin_configurar', '4 · sin secreto en vault no llama');
  insert into vault.decrypted_secrets values ('project_url', 'https://x.supabase.co/'), ('comm_cron_secret', 's3cr3t');
  delete from net._llamadas;
  perform tests.eq(public._invm_despachar(), 'despachado', '4 · en horario y con pendientes: despierta a la Edge');
  perform tests.ok((select url = 'https://x.supabase.co/functions/v1/invitacion' and headers ->> 'x-cron-secret' = 's3cr3t' and body ->> 'action' = 'masiva' from net._llamadas order by id desc limit 1), '4 · a la Edge invitacion, acción masiva, con su secreto');
  perform tests.act_as_service();
  select count(*)::int, max(x.token), max(x.envio_id) into n, tok, e from public._invm_reclamar('correo', 10) x;
  perform tests.eq(n, 1, '4 · límite diario 1: un solo envío hoy');
  perform tests.ok(tok ~ '^[A-Za-z0-9_-]{43}$', '4 · el lote trae el secreto (una vez)');
  perform tests.ok((select i.token_hash = encode(extensions.digest(tok, 'sha256'), 'hex') and i.creada_por = v_admin
                      from public.invitacion_envios v join public.cliente_invitaciones i on i.id = v.invitacion_id where v.id = e), '4 · la invitación nace con huella y quien creó la campaña');
  perform tests.ok(not exists (select 1 from public.invitacion_envios where error = tok or proveedor_id = tok), '4 · el secreto no se guarda en la cola');
  perform tests.eq((select count(*)::int from public._invm_reclamar('correo', 10)), 0, '4 · cupo del día agotado');

  -- ══ 5 · resultado ══
  perform public._invm_resolver(e, 'enviado', 're_123');
  perform tests.ok((select estado = 'enviado' and proveedor_id = 're_123' and enviado_at is not null from public.invitacion_envios where id = e), '5 · enviado con el id del proveedor');
  update public.invitacion_campanas set limite_diario = 1000 where id = camp;
  select max(x.envio_id) into e from public._invm_reclamar('correo', 1) x;
  perform public._invm_resolver(e, 'fallido', null, 'dirección rechazada');
  perform tests.ok((select v.estado = 'fallido' and i.revocada_at is not null from public.invitacion_envios v join public.cliente_invitaciones i on i.id = v.invitacion_id where v.id = e), '5 · fallido: su invitación se retira');
  -- un cliente que creó su cuenta mientras esperaba ya no recibe nada
  update public.customers set profile_id = tests.user('doctor') where id = (select customer_id from public.invitacion_envios where campana_id = camp and estado = 'pendiente' order by id limit 1);
  perform public._invm_reclamar('correo', 50);
  perform tests.ok(exists (select 1 from public.invitacion_envios where campana_id = camp and estado = 'omitido' and motivo = 'ya_tiene_cuenta'), '5 · al reclamar se revisa otra vez: con cuenta se omite');
  perform tests.eq((select estado from public.invitacion_campanas where id = camp), 'terminada', '5 · sin pendientes la campaña termina');
  update public.invitacion_envios set reclamado_at = now() - interval '11 minutes' where campana_id = camp and estado = 'enviando';
  perform public._invm_reclamar('correo', 1);
  perform tests.ok(not exists (select 1 from public.invitacion_envios where campana_id = camp and estado = 'enviando'), '5 · lo reclamado sin asentar pasa a sin confirmar (no se reenvía)');
  perform tests.act_as(v_admin);
  r := public.invitaciones_masivas_estado() -> 'campanas' -> 0;
  perform tests.ok((r ->> 'enviados')::int = 1 and (r ->> 'fallidos')::int = 1 and r ->> 'estado' = 'terminada', '5 · el tablero cuenta enviados y fallidos');
end $t$;

do $t$
declare v_admin uuid := tests.fixture_admin(); camp uuid; e bigint; c2 uuid; i uuid;
begin
  -- ══ 6 · WhatsApp: rechazo de plantilla pausa sin quemar; pausar / reanudar / cancelar ══
  perform tests.act_as_service();
  insert into public.customers (full_name, phone, active, source) values ('Wa Uno', '+52 (667) 222-0001', true, 'odoo'), ('Wa Dos', '6672220002', true, 'odoo');
  perform tests.act_as(v_admin);
  camp := (public.invitaciones_masivas_crear('whatsapp', null, false, 500, 'invitacion_cuenta') ->> 'campana_id')::uuid;
  perform tests.act_as_service();
  perform tests.ok((select destino = '6672220001' from public.invitacion_envios v join public.customers c on c.id = v.customer_id where v.campana_id = camp and c.full_name = 'Wa Uno'), '6 · celular normalizado a 10 dígitos');
  perform tests.act_as_service();
  select x.envio_id into e from public._invm_reclamar('whatsapp', 1) x where x.plantilla_wa = 'invitacion_cuenta' and x.idioma_wa = 'es_MX';
  perform tests.ok(e is not null, '6 · el lote trae la plantilla y el idioma');
  select invitacion_id into i from public.invitacion_envios where id = e;
  perform public._invm_resolver(e, 'retener', null, 'Meta: la plantilla no existe');
  perform tests.ok((select estado = 'pendiente' and invitacion_id is null from public.invitacion_envios where id = e)
                   and (select estado = 'pausada' and nota like 'Meta:%' from public.invitacion_campanas where id = camp)
                   and (select revocada_at is not null from public.cliente_invitaciones where id = i), '6 · rechazo del canal: vuelve a la cola, la campaña se pausa con la nota y la invitación se retira');
  perform tests.eq((select count(*)::int from public._invm_reclamar('whatsapp', 5)), 0, '6 · pausada no sale nada');
  perform tests.act_as(v_admin);
  perform tests.eq(public.invitaciones_masivas_cambiar(camp, 'reanudar') ->> 'estado', 'activa', '6 · reanudar');
  perform tests.eq(public.invitaciones_masivas_cambiar(camp, 'pausar') ->> 'estado', 'pausada', '6 · pausar');
  perform tests.throws(format('select public.invitaciones_masivas_cambiar(%L, %L)', camp, 'pausar'), 'ACCION_INVALIDA', '6 · no se pausa dos veces');
  perform tests.eq(public.invitaciones_masivas_cambiar(camp, 'cancelar') ->> 'estado', 'cancelada', '6 · cancelar');
  perform tests.act_as_service();
  perform tests.ok(not exists (select 1 from public.invitacion_envios where campana_id = camp and estado = 'pendiente'), '6 · cancelada: nada queda en cola');
  perform tests.act_as(v_admin);
  c2 := (public.invitaciones_masivas_crear('whatsapp', null, false, 500, 'invitacion_cuenta') ->> 'campana_id')::uuid;
  perform tests.ok(c2 is not null, '6 · cancelada la anterior, se puede lanzar otra');
end $t$;
rollback;
