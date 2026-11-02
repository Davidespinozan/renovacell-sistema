-- ============================================================================
-- RETOMA DEL ASESOR (2 nov 2026, caso real: la Dra. Muciño contestó a Alejandra 5 h después de que su asesoría se cerró
-- por inactividad; la respuesta le llegó a la IA y Alejandra no se enteró). Decisión del dueño:
--   1) Si el cliente vuelve a escribir dentro de las 24 h siguientes a una asesoría que se cerró por INACTIVIDAD (no si el
--      asesor la terminó), la conversación regresa al MISMO asesor: en horario se le asigna (la IA se calla, como en todo
--      traspaso) y al cliente se le dice que su asesor ya sabe; fuera de horario la IA atiende y al asesor solo se le avisa.
--   2) Un contacto sin cartera (visitante, WhatsApp) recuerda quién lo atendió (ultimo_asesor_id): en su siguiente
--      solicitud de asesor va con esa persona antes que al reparto. La cartera sigue ganando; las rotaciones del reparto
--      (asesor que no contestó) no se tocan.
-- ============================================================================
alter table public.cc_conversations add column if not exists ultimo_asesor_id uuid references public.profiles(id) on delete set null;
alter table public.cc_conversations add column if not exists ultimo_asesor_at timestamptz;

-- ── 1 · Quién lo atendió: el vendedor que inició la asesoría ─────────────────────────────────────
create or replace function public._cc_ultimo_asesor_tr() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if new.actor_type = 'seller' and new.actor_profile_id is not null then
    update public.cc_conversations set ultimo_asesor_id = new.actor_profile_id, ultimo_asesor_at = new.created_at where id = new.conversation_id;
  end if;
  return new;
exception when others then
  raise warning 'ULTIMO_ASESOR: % (el evento se guardó)', sqlerrm;
  return new;
end;
$$;
drop trigger if exists cc_ultimo_asesor on public.cc_conversation_events;
create trigger cc_ultimo_asesor after insert on public.cc_conversation_events for each row when (new.tipo = 'human_started') execute function public._cc_ultimo_asesor_tr();

-- Lo que ya pasó: el último vendedor que inició una asesoría en cada conversación.
update public.cc_conversations c set ultimo_asesor_id = e.actor_profile_id, ultimo_asesor_at = e.created_at
  from (select distinct on (conversation_id) conversation_id, actor_profile_id, created_at from public.cc_conversation_events
         where tipo = 'human_started' and actor_type = 'seller' and actor_profile_id is not null order by conversation_id, created_at desc) e
 where e.conversation_id = c.id and c.ultimo_asesor_id is null;

-- ── 2 · Su siguiente solicitud va con quien lo atendió (solo sin cartera y solo al empezar una solicitud) ──
create or replace function public._cc_preferir_ultimo_asesor_tr() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  -- Solo una solicitud NUEVA (desde IA o asesoría terminada), nunca la rotación del reparto (asignada → en cola).
  if new.modo = 'human_requested' and old.modo in ('ai_active', 'human_offered', 'human_ended') and new.seller_profile_id is null
     and new.profile_id is null and new.ultimo_asesor_id is not null and public._cc_vendedor_elegible(new.ultimo_asesor_id, false) then
    new.seller_profile_id := new.ultimo_asesor_id;   -- _cc_rutear ya respeta al asesor de la conversación de un visitante
  end if;
  return new;
end;
$$;
drop trigger if exists cc_preferir_ultimo_asesor on public.cc_conversations;
create trigger cc_preferir_ultimo_asesor before update of modo on public.cc_conversations for each row execute function public._cc_preferir_ultimo_asesor_tr();

-- ── 3 · Retoma: el cliente vuelve a escribir dentro de 24 h de una asesoría cerrada por inactividad ──
create or replace function public._cc_retoma_tr() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare c record; e record; v_horario jsonb; v_nombre text;
begin
  select * into c from public.cc_conversations where id = new.conversation_id;
  if c.modo not in ('ai_active', 'human_ended') or c.ultimo_asesor_id is null or c.estado <> 'abierta' then return new; end if;
  -- La asesoría anterior se cerró por inactividad con el asesor atendiendo, hace menos de 24 h, y nadie la ha retomado.
  select * into e from public.cc_conversation_events
   where conversation_id = c.id and tipo = 'session_closed' order by created_at desc limit 1;
  if not found or e.detalle ->> 'motivo' <> 'inactividad' or e.detalle ->> 'modo_al_cerrar' <> 'human_active' or e.created_at < now() - interval '24 hours' then return new; end if;
  if exists (select 1 from public.cc_conversation_events x where x.conversation_id = c.id and x.tipo in ('human_assigned', 'human_requested') and x.created_at > e.created_at) then return new; end if;
  if not public._cc_vendedor_elegible(c.ultimo_asesor_id, false) then return new; end if;
  v_nombre := public._cc_primer_nombre(public._cc_nombre_personal(c.ultimo_asesor_id));
  v_horario := public._cc_horario_estado(now());
  if coalesce((v_horario ->> 'abierto')::boolean, false) then
    perform public._cc_handler_asignar(c.id, c.ultimo_asesor_id, 'system', null, 'retoma', 'retoma');
    perform public._cc_sistema(c.id, 'Ya le avisé a ' || coalesce(v_nombre, 'tu asesor') || ', quien te atendió, que escribiste. Te responde por aquí en un momento.',
                               'sys:solicitud:retoma:' || c.id || ':' || new.seq);
  else
    -- Fuera de horario: la IA atiende como siempre; el asesor se entera para retomarlo al abrir.
    perform public._cc_notificar('retoma', c.id, array[c.ultimo_asesor_id], null,
      public._cc_nombre_dueno(c.id) || ' te volvió a escribir (fuera de horario; la IA lo atiende mientras tanto).', 'asesorias',
      'retoma:' || c.id || ':' || to_char(now() at time zone 'America/Mazatlan', 'YYYYMMDD'));
  end if;
  return new;
exception when others then
  raise warning 'RETOMA: % (el mensaje se guardó)', sqlerrm;   -- la retoma nunca tumba el mensaje del cliente
  return new;
end;
$$;
drop trigger if exists trg_ccm_zretoma on public.cc_messages;
create trigger trg_ccm_zretoma after insert on public.cc_messages for each row when (new.actor_type in ('doctor', 'visitor')) execute function public._cc_retoma_tr();

revoke all on function public._cc_ultimo_asesor_tr(), public._cc_preferir_ultimo_asesor_tr(), public._cc_retoma_tr() from public, anon, authenticated;
