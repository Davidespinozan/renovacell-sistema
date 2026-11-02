-- VERIFICACIÓN POR WHATSAPP (20270306) · la IA registra la solicitud con los datos que juntó (validados), el responsable
-- (o Dirección) recibe la señal y la ve en el chat; al cerrarla, el WhatsApp queda ligado y la IA lo reconoce; al
-- rechazarla se le dice al cliente. Toda señal de compra llega al humano sin quitarle la conversación a la IA.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); c1 uuid; c2 uuid; r jsonb; v_sol uuid; ok boolean; t text;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  r := public.cc_wa_entrante('5216671112222', 'Éclat de Vie', 'wamid.VW.1', 'Quiero 3 nabota 200', false); c1 := (r ->> 'conversation_id')::uuid;

  -- ══ 1 · la IA registra la solicitud; los datos se validan ══
  perform tests.ok((public.cc_ia_solicitar_alta(c1, 'Kattya', '1234567', 'k@x.mx') ->> 'campo') = 'nombre', '1 · nombre sin apellido: se pide de nuevo');
  perform tests.ok((public.cc_ia_solicitar_alta(c1, 'Kattya Muciño', '12', 'k@x.mx') ->> 'campo') = 'cedula', '1 · cédula inválida');
  perform tests.ok((public.cc_ia_solicitar_alta(c1, 'Kattya Muciño', '1234567', 'nocorreo') ->> 'campo') = 'email', '1 · correo inválido');
  r := public.cc_ia_solicitar_alta(c1, 'Kattya Muciño', '12345678', 'kattya@clinica.mx', 'Medicina estética', 'Culiacán');
  perform tests.ok((r ->> 'registrada')::boolean and (r ->> 'fotos')::int = 0, '1 · registrada (sin foto aún)');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'verificacion_wa' and conversation_id = c1 and 'admin' = any (roles)), '1 · sin vendedor responsable: le llega a Dirección');
  perform tests.ok((public.cc_ia_solicitar_alta(c1, 'Kattya Muciño García', '12345678', 'kattya@clinica.mx') ->> 'registrada')::boolean
               and (select count(*) from public.cc_solicitudes_alta where conversation_id = c1 and estado = 'pendiente') = 1, '1 · corregir datos no duplica la solicitud');
  select id into v_sol from public.cc_solicitudes_alta where conversation_id = c1 and estado = 'pendiente';

  -- ══ 2 · el personal la ve; un doctor no ══
  perform tests.act_as(v_admin);
  r := public.cc_solicitud_alta_de(c1);
  perform tests.ok(r ->> 'nombre' = 'Kattya Muciño García' and r ->> 'estado' = 'pendiente', '2 · Dirección la ve en el chat');
  perform tests.act_as(d1);
  begin perform public.cc_solicitud_alta_de(c1); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '2 · un doctor no la ve');

  -- ══ 3 · aprobada (lo que hace la Edge al final): WhatsApp ligado y la IA lo reconoce; se le avisa por el chat ══
  perform tests.act_as_service();
  r := public.cc_alta_wa_cerrar(v_sol, null, d1, v_admin);
  perform tests.ok((r ->> 'vinculado')::boolean and public.cc_ia_identidad_canal(c1) = d1, '3 · su WhatsApp queda ligado: la IA lo reconoce');
  select content into t from public.cc_messages where conversation_id = c1 and client_message_id like 'tpl:alta_wa:%';
  perform tests.ok(t like '¡Listo%Ya quedaste verificado(a)%' and t like '%ya tienes tu portal%¿Olvidaste tu contraseña?%kattya@clinica.mx%', '3 · se le avisa por el mismo chat, con su acceso al portal (ADOPCIÓN)');
  begin perform public.cc_alta_wa_cerrar(v_sol, null, d1, v_admin); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '3 · no se cierra dos veces');
  perform tests.eq((public.cc_ia_solicitar_alta(c1, 'Otra Persona', '7654321', 'o@x.mx') ->> 'campo'), 'ya_identificado', '3 · ya identificado: no se piden datos otra vez');

  -- ══ 4 · rechazada: se le explica y puede volver a mandar ══
  r := public.cc_wa_entrante('5216673334444', 'Luis', 'wamid.VW.2', 'precio botox', false); c2 := (r ->> 'conversation_id')::uuid;
  perform public.cc_ia_solicitar_alta(c2, 'Luis Pérez', '7654321', 'luis@x.mx');
  select id into v_sol from public.cc_solicitudes_alta where conversation_id = c2;
  perform tests.act_as(v_admin);
  perform public.cc_solicitud_alta_rechazar(v_sol, 'la foto de la cédula no se ve completa');
  perform tests.act_as_service();
  perform tests.ok((select content from public.cc_messages where conversation_id = c2 and client_message_id like 'tpl:alta_wa_no:%') like '%no pudimos completar tu verificación: la foto de la cédula no se ve completa%', '4 · rechazo explicado al cliente');
  perform tests.ok((public.cc_ia_solicitar_alta(c2, 'Luis Pérez', '7654321', 'luis@x.mx') ->> 'registrada')::boolean, '4 · puede volver a mandar sus datos');

  -- ══ 5 · señal de compra → humano (la IA sigue) ══
  t := public.cc_senal_interes(c2, 'compra'); if t <> 'emitida' then raise exception 'DBG senal=%', t; end if;
  perform tests.ok(t = 'emitida' and exists (select 1 from public.notifications where kind = 'senal_compra' and conversation_id = c2), '5 · la señal de compra llega al humano');
  perform tests.ok((select modo from public.cc_conversations where id = c2) = 'ai_active', '5 · y la conversación sigue con la IA');
  perform tests.ok(not has_function_privilege('authenticated', 'public.cc_ia_solicitar_alta(uuid,text,text,text,text,text)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.cc_alta_wa_cerrar(uuid,uuid,uuid,uuid,text,boolean)', 'EXECUTE'), '6 · registrar y cerrar son del servidor');
end $t$;
rollback;
