-- BOT DETECTADO (6 nov 2026, dueño): «que les salga una alerta de que fue un bot para que sepan los de Renovacell».
-- El freno ANTIBOT (meta-webhook) ya calla a la IA ante otro bot; ahora además lo DEJA DICHO:
--   · evento 'bot_detectado' en la conversación (una vez cada 24 h por conversación, con el motivo);
--   · aviso en la campana a Dirección (y al vendedor si la conversación ya tiene uno);
--   · cc_canal_conversacion devuelve `bot` → el chat del personal muestra el aviso arriba del redactor.
-- Nada de esto le llega al contacto (no hay mensaje de sistema: por WhatsApp alimentaría al otro bot).

alter table public.cc_conversation_events drop constraint ck_ccce_tipo;
alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo = any (array['conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned',
  'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened', 'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected',
  'notificacion_fallida', 'session_opened', 'session_closed', 'bot_detectado']));

create or replace function public.cc_bot_detectado(p_conv uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record; w public.cc_wa_contactos; m public.cc_meta_contactos; v_quien text;
  v_motivo text := left(coalesce(nullif(btrim(p_motivo), ''), 'automatico'), 40);
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv;
  if not found then return jsonb_build_object('nuevo', false); end if;
  -- una vez cada 24 h por conversación: un bucle no llena la campana
  if exists (select 1 from public.cc_conversation_events e where e.conversation_id = p_conv and e.tipo = 'bot_detectado' and e.created_at > now() - interval '24 hours') then
    return jsonb_build_object('nuevo', false);
  end if;
  perform public._cc_evento(p_conv, 'bot_detectado', 'system', null, null, jsonb_build_object('motivo', v_motivo));
  w := public._cc_wa_contacto_de(p_conv);
  if w.wa_id is not null then
    v_quien := coalesce(nullif(btrim(w.nombre), ''), '+' || w.wa_id) || ' (WhatsApp)';
  else
    m := public._cc_meta_contacto_de(p_conv);
    v_quien := coalesce(nullif(btrim(public._cc_nombre_dueno(p_conv)), ''), 'Un contacto') || coalesce(' (' || m.canal || ')', '');
  end if;
  perform public._cc_notificar('bot_detectado', p_conv, case when c.seller_profile_id is not null then array[c.seller_profile_id] end, array['admin'],
    'Posible bot: ' || v_quien || ' manda respuestas automáticas. La IA dejó de contestarle; si es una persona, contéstale tú.', 'av_atencion',
    'bot:' || p_conv::text || ':' || extract(epoch from now())::bigint::text);
  return jsonb_build_object('nuevo', true);
end;
$$;

revoke all on function public.cc_bot_detectado(uuid, text) from public, anon, authenticated;
grant execute on function public.cc_bot_detectado(uuid, text) to service_role;

-- Misma función de 20270123 (R4-C5) + `bot`: el último aviso de bot de las últimas 24 h (null si no hay).
create or replace function public.cc_canal_conversacion(p_conv uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare w public.cc_wa_contactos; m public.cc_meta_contactos; v_bot jsonb;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select jsonb_build_object('motivo', e.detalle ->> 'motivo', 'at', e.created_at) into v_bot from public.cc_conversation_events e
   where e.conversation_id = p_conv and e.tipo = 'bot_detectado' and e.created_at > now() - interval '24 hours' order by e.created_at desc limit 1;
  w := public._cc_wa_contacto_de(p_conv);
  if w.wa_id is not null then
    return jsonb_build_object('canal', 'whatsapp', 'id', w.wa_id, 'wa_id', w.wa_id, 'modo', public._cc_wa_modo_efectivo(w.wa_id),   -- R4-C5 · modo efectivo por contacto
      'ventana_hasta', w.ultimo_entrante_at + interval '24 hours', 'ventana_abierta', w.ultimo_entrante_at > now() - interval '24 hours',
      'fallidos', (select count(*) from public.cc_wa_salida where conversation_id = p_conv and estado in ('fallido', 'fuera_ventana')), 'bot', v_bot);
  end if;
  m := public._cc_meta_contacto_de(p_conv);
  if m.psid is null then return null; end if;
  return jsonb_build_object('canal', m.canal, 'id', m.psid, 'modo', (select modo from public.cc_meta_config where canal = m.canal),
    'ventana_hasta', m.ultimo_entrante_at + interval '24 hours', 'ventana_abierta', m.ultimo_entrante_at > now() - interval '24 hours',
    'fallidos', (select count(*) from public.cc_meta_salida where conversation_id = p_conv and estado in ('fallido', 'fuera_ventana')), 'bot', v_bot);
end;
$$;
