-- BOT DETECTADO · REVERSIÓN EXACTA de 20270331120000_bot_detectado.sql: quita cc_bot_detectado, devuelve el CHECK de tipos de
-- evento y cc_canal_conversacion tal como quedó tras 20270123 (copia literal). Se NIEGA si ya hay eventos 'bot_detectado'
-- (la bitácora es solo-agregar: no se borran para poder bajar).
do $pre$
begin
  if exists (select 1 from public.cc_conversation_events where tipo = 'bot_detectado') then
    raise exception 'BOT down: ya hay eventos bot_detectado en la bitácora; no se puede devolver el CHECK anterior';
  end if;
end $pre$;

drop function if exists public.cc_bot_detectado(uuid, text);

alter table public.cc_conversation_events drop constraint ck_ccce_tipo;
alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo = any (array['conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned',
  'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened', 'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected',
  'notificacion_fallida', 'session_opened', 'session_closed']));

CREATE OR REPLACE FUNCTION public.cc_canal_conversacion(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare w public.cc_wa_contactos; m public.cc_meta_contactos;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  w := public._cc_wa_contacto_de(p_conv);
  if w.wa_id is not null then
    return jsonb_build_object('canal', 'whatsapp', 'id', w.wa_id, 'wa_id', w.wa_id, 'modo', public._cc_wa_modo_efectivo(w.wa_id),   -- R4-C5 · modo efectivo por contacto
     
      'ventana_hasta', w.ultimo_entrante_at + interval '24 hours', 'ventana_abierta', w.ultimo_entrante_at > now() - interval '24 hours',
      'fallidos', (select count(*) from public.cc_wa_salida where conversation_id = p_conv and estado in ('fallido', 'fuera_ventana')));
  end if;
  m := public._cc_meta_contacto_de(p_conv);
  if m.psid is null then return null; end if;
  return jsonb_build_object('canal', m.canal, 'id', m.psid, 'modo', (select modo from public.cc_meta_config where canal = m.canal),
    'ventana_hasta', m.ultimo_entrante_at + interval '24 hours', 'ventana_abierta', m.ultimo_entrante_at > now() - interval '24 hours',
    'fallidos', (select count(*) from public.cc_meta_salida where conversation_id = p_conv and estado in ('fallido', 'fuera_ventana')));
end;
$function$;
