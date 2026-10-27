-- BANDEJA-1 · cada solicitud de la Bandeja dice su origen (WhatsApp / Instagram / Messenger / enlace / portal), el nombre real
-- del contacto, su número y el último mensaje del cliente; solo lectura; la reversión devuelve la función exacta.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); r jsonb; cwa uuid; cig uuid; fila jsonb;
begin
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670007001', 'Dra. Ana López', 'wamid.BO.1', 'Me interesan 10 piezas de TNM', false); cwa := (r ->> 'conversation_id')::uuid;
  r := public.cc_meta_entrante('instagram', '17841400000777001', 'Clínica Sol', 'mid.BO.2', 'hola, ¿tienen nabota?', false); cig := (r ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  update public.cc_conversations set modo = 'human_requested', asesoria_solicitada_at = now() where id in (cwa, cig);

  perform tests.act_as(v_admin);
  r := public.cc_ruteo_pendientes();
  fila := (select x from jsonb_array_elements(r -> 'conversaciones') x where x ->> 'conversation_id' = cwa::text);
  perform tests.ok(fila -> 'contacto' ->> 'fuente' = 'whatsapp', '1 · WhatsApp: origen');
  perform tests.ok(fila -> 'contacto' ->> 'nombre' = 'Dra. Ana López', '1 · WhatsApp: nombre del perfil');
  perform tests.ok(fila -> 'contacto' ->> 'detalle' = '+5216670007001', '1 · WhatsApp: número');
  perform tests.ok(fila -> 'contacto' ->> 'ultimo_texto' = 'Me interesan 10 piezas de TNM', '1 · WhatsApp: último mensaje del cliente');
  fila := (select x from jsonb_array_elements(r -> 'conversaciones') x where x ->> 'conversation_id' = cig::text);
  perform tests.ok(fila -> 'contacto' ->> 'fuente' = 'instagram', '2 · Instagram: origen');
  perform tests.ok(fila -> 'contacto' ->> 'ultimo_texto' = 'hola, ¿tienen nabota?', '2 · Instagram: último mensaje');
  perform tests.ok((r -> 'conversaciones' -> 0) ? 'atencion' and (r -> 'conversaciones' -> 0) ? 'seller_nombre', '3 · las claves de siempre siguen');
  perform tests.ok(not has_function_privilege('authenticated', 'public._cc_contacto_conversacion(uuid)', 'execute') and not has_function_privilege('anon', 'public._cc_contacto_conversacion(uuid)', 'execute'), '4 · la función auxiliar no es pública');
  perform tests.act_as_owner();
  perform tests.ok(public._cc_contacto_conversacion(gen_random_uuid()) ->> 'fuente' = 'portal', '5 · sin canal ni enlace: portal');
end $t$;
\ir ../../../rollback/bandeja_origen/99_down.sql
do $t$ begin
  perform tests.ok(md5(pg_get_functiondef('public.cc_ruteo_pendientes()'::regprocedure)) = '843495c70f9c09689f18cf9781542427' and to_regprocedure('public._cc_contacto_conversacion(uuid)') is null, '6 · reversión exacta');
end $t$;
\ir ../../../migrations/20270125120000_bandeja_origen.sql
do $t$ begin perform tests.ok(to_regprocedure('public._cc_contacto_conversacion(uuid)') is not null, '6 · se reaplica'); end $t$;
rollback;
