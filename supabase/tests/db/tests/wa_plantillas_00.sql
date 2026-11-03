-- WA-PLANTILLAS (20270403) · fuera de las 24 h, el vendedor responsable retoma al cliente de WhatsApp con una plantilla
-- aprobada: sale por la cola aunque la ventana esté cerrada, una por contacto cada 24 h, con las variables puestas por la
-- base. Nacen apagadas; Dirección las activa cuando Meta las aprueba.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos');
  cw uuid; cw2 uuid; pm uuid; r jsonb; ok boolean; hoy date;
begin
  perform tests.act_as_service();
  update public.profiles set full_name = 'Alejandra Cázarez', meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s2;
  perform tests.act_as_owner();
  update public.cc_wa_config set modo = 'activo', ia_habilitada = true where id;
  perform tests.act_as_service();
  cw := (public.cc_wa_entrante('5216670000091', 'yara lópez', 'wamid.TP.1', 'Hola, ¿precio de Nabota?', false) ->> 'conversation_id')::uuid;
  cw2 := (public.cc_wa_entrante('5216670000092', 'Beto', 'wamid.TP.2', 'Hola', false) ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  insert into public.cc_cartera_prospectos (visitor_id, seller_profile_id) select visitor_id, s1 from public.cc_conversations where id in (cw, cw2);

  -- ══ 0 · nacen apagadas; solo Dirección las activa ══
  perform tests.ok((select count(*) = 3 and bool_and(not activa) from public.cc_wa_plantillas), '0 · tres plantillas, apagadas');
  perform tests.act_as(s1);
  perform tests.eq(public.cc_wa_plantillas_lista(), '[]'::jsonb, '0 · el vendedor no ve las apagadas');
  perform tests.throws(format('select public.cc_wa_plantilla_enviar(%L, ''seguimiento_vendedor'')', cw), 'PLANTILLA_INEXISTENTE', '0 · ni puede mandarlas');
  perform tests.throws('select public.cc_wa_plantilla_activar(''seguimiento_vendedor'', true)', 'NO_AUTORIZADO', '0 · ni activarlas');
  perform tests.act_as(v_admin);
  perform tests.eq(jsonb_array_length(public.cc_wa_plantillas_lista()), 3, '0 · Dirección ve las tres');
  perform public.cc_wa_plantilla_activar('seguimiento_vendedor', true);
  perform public.cc_wa_plantilla_activar('promocion_vigente', true);

  -- ══ 1 · dentro de las 24 h: escríbele normal ══
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_wa_plantilla_enviar(%L, ''seguimiento_vendedor'')', cw), 'PLANTILLA_VENTANA_ABIERTA', '1 · con la ventana abierta no hace falta plantilla');

  -- ══ 2 · fuera de las 24 h: la manda, sale por la cola y queda atendiéndola ══
  perform tests.act_as_owner();
  update public.cc_wa_contactos set ultimo_entrante_at = now() - interval '3 days' where wa_id in ('5216670000091', '5216670000092');
  perform tests.act_as(s1);
  r := public.cc_wa_plantilla_enviar(cw, 'seguimiento_vendedor');
  perform tests.eq(r ->> 'texto', 'Hola Yara, le saluda Alejandra de Renovacell. Quedo a sus órdenes para cotizaciones, existencias o su próximo pedido. ¿Le puedo ayudar en algo esta semana?', '2 · texto con su nombre y el de la vendedora');
  perform tests.act_as_owner();
  perform tests.ok((select estado = 'pendiente' from public.cc_wa_salida where message_id = (r ->> 'message_id')::uuid), '2 · sale por la cola aunque la ventana esté cerrada');
  perform tests.ok((select plantilla = 'seguimiento_vendedor' and parametros = array['Yara', 'Alejandra'] and wa_id = '5216670000091' from public.cc_wa_plantilla_envios where message_id = (r ->> 'message_id')::uuid), '2 · con la plantilla y sus parámetros');
  perform tests.ok((select modo = 'human_active' and seller_profile_id = s1 from public.cc_conversations where id = cw), '2 · la vendedora queda atendiéndola (cuando conteste, sigue la plática)');
  -- Un mensaje normal fuera de la ventana sigue sin salir.
  perform tests.act_as_service();
  r := public.cc_enviar_mensaje(cw, 'seller', null, s1, 'c:normal1', 'Texto libre');
  perform tests.act_as_owner();
  perform tests.eq((select estado from public.cc_wa_salida where message_id = (r ->> 'id')::uuid), 'fuera_ventana', '2 · el texto libre sigue retenido por la regla de Meta');

  -- ══ 3 · una por contacto cada 24 h; solo su vendedor ══
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_wa_plantilla_enviar(%L, ''seguimiento_vendedor'')', cw), 'PLANTILLA_RECIENTE', '3 · otra en menos de 24 h: no');
  perform tests.act_as(s2);
  perform tests.throws(format('select public.cc_wa_plantilla_enviar(%L, ''seguimiento_vendedor'')', cw2), 'NO_AUTORIZADO', '3 · otro vendedor no le escribe a un cliente ajeno');

  -- ══ 4 · promoción: hay que elegir una vigente ══
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_wa_plantilla_enviar(%L, ''promocion_vigente'')', cw2), 'PLANTILLA_PROMOCION', '4 · sin promoción elegida: no');
  perform tests.act_as_owner();
  hoy := public._promo_hoy();
  insert into public.promociones (nombre, desde, hasta) values ('Buen Fin', hoy - 1, make_date(extract(year from hoy)::int, 12, 17)) returning id into pm;
  perform tests.act_as(s1);
  r := public.cc_wa_plantilla_enviar(cw2, 'promocion_vigente', pm);
  perform tests.ok(r ->> 'texto' = 'Hola Beto, tenemos Buen Fin con precio especial hasta el 17 de diciembre. ¿Le aparto piezas?', '4 · con la promoción y su fecha (' || (r ->> 'texto') || ')');

  -- ══ 5 · "Detener promociones": ya no recibe Marketing; Utilidad sí ══
  perform tests.act_as_service();
  perform public.cc_wa_entrante('5216670000092', 'Beto', 'wamid.TP.3', 'Detener promociones', false);
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.cc_wa_bajas_promo where wa_id = '5216670000092'), '5 · tocar "Detener promociones" lo da de baja de promociones');
  update public.cc_wa_contactos set ultimo_entrante_at = now() - interval '3 days' where wa_id = '5216670000092';
  delete from public.cc_wa_plantilla_envios where wa_id = '5216670000092';
  perform tests.act_as(v_admin);
  perform public.cc_wa_plantilla_activar('acceso_portal', true);
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_wa_plantilla_enviar(%L, ''seguimiento_vendedor'')', cw2), 'PLANTILLA_BAJA', '5 · ya no se le manda Marketing');
  perform tests.ok(public.cc_wa_plantilla_enviar(cw2, 'acceso_portal') ->> 'texto' like 'Hola Beto, su cuenta en Renovacell está lista.%', '5 · su acceso (Utilidad) sí');
  perform tests.act_as_owner();
  perform tests.ok((select bool_and(array_length(botones, 1) >= 1) from public.cc_wa_plantillas), '5 · cada plantilla trae sus respuestas rápidas');

  -- ══ 6 · permisos ══
  perform tests.act_as(tests.user('doctor'));
  perform tests.throws('select public.cc_wa_plantillas_lista()', 'NO_AUTORIZADO', '5 · un doctor no');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_wa_plantilla_enviar(%L, ''seguimiento_vendedor'')', cw), 'permission denied', '5 · anónimo no');
end $t$;
rollback;
