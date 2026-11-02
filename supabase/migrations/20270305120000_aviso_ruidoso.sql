-- ============================================================================
-- AVISO RUIDOSO AL VENDEDOR (2 nov 2026, dueño: "estamos perdiendo muchos clientes… necesita rápido enterarse el vendedor de
-- que alguien está hablando, salirle una notificación muy ruidosa").
--   1) Las alertas comerciales de la campana (te asignaron un cliente, retoma, escritura de un cliente, escaladas a
--      Dirección) también salen como PUSH urgente al teléfono (antes solo vivían en la campana del sistema).
--   2) Cuando un cliente con dueño comercial (su vendedor de cartera o quien lo atendió antes) empieza a escribir y lo está
--      atendiendo la IA, ese vendedor se entera al momento (una vez por sesión): "X está escribiendo; la IA lo atiende".
-- ============================================================================
create or replace function public._cc_responsable_comercial(p_conv uuid) returns uuid
  language sql stable security definer set search_path = public as
$$
  select coalesce(
    case when c.modo in ('human_assigned', 'human_active') then c.seller_profile_id end,
    case when c.profile_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de(c.profile_id), false) then public._cc_vendedor_de(c.profile_id) end,
    case when c.customer_id is not null and public._cc_vendedor_elegible(public._cc_vendedor_de_cliente(c.customer_id), false) then public._cc_vendedor_de_cliente(c.customer_id) end,
    case when public._cc_vendedor_elegible(c.ultimo_asesor_id, false) then c.ultimo_asesor_id end)
  from public.cc_conversations c where c.id = p_conv
$$;

-- ── 1 · Un cliente con dueño comercial empieza a escribir y lo atiende la IA ───────────────────────
create or replace function public._cc_cliente_escribe_tr() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare c record; v_s uuid; v_ses uuid;
begin
  select * into c from public.cc_conversations where id = new.conversation_id;
  if c.modo not in ('ai_active', 'human_offered', 'human_ended') then return new; end if;   -- con asesor/solicitud, ya avisan el push del chat y el handoff
  v_s := public._cc_responsable_comercial(c.id);
  if v_s is null then return new; end if;
  select id into v_ses from public.cc_conversation_sessions where conversation_id = c.id and estado = 'abierta' order by opened_at desc limit 1;
  perform public._cc_notificar('cliente_escribe', c.id, array[v_s], null,
    public._cc_nombre_dueno(c.id) || ' está escribiendo; la IA lo atiende. Entra si quieres tomarlo.', 'asesorias',
    'cliente_escribe:' || c.id || ':' || coalesce(v_ses::text, to_char(now(), 'YYYYMMDDHH24')));
  return new;
exception when others then
  raise warning 'CLIENTE_ESCRIBE: % (el mensaje se guardó)', sqlerrm;
  return new;
end;
$$;
-- Corre DESPUÉS de la retoma (orden alfabético de disparadores): si la retoma ya lo asignó, aquí no se duplica.
drop trigger if exists trg_ccm_zzescribe on public.cc_messages;
create trigger trg_ccm_zzescribe after insert on public.cc_messages for each row when (new.actor_type in ('doctor', 'visitor')) execute function public._cc_cliente_escribe_tr();

-- ── 2 · Push urgente de las alertas comerciales ───────────────────────────────────────────────────
create or replace function public.aviso_push_carga(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare n public.notifications; v_perfiles uuid[];
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into n from public.notifications where id = p_id;
  if not found then return null; end if;
  v_perfiles := coalesce(n.user_ids, '{}') || coalesce((select array_agg(p.id) from public.profiles p where p.active and p.role_id = any (coalesce(n.roles, '{}'))), '{}');
  if coalesce(array_length(v_perfiles, 1), 0) = 0 then return null; end if;
  return jsonb_build_object('perfiles', to_jsonb(v_perfiles), 'kind', n.kind, 'body', n.body, 'conversation_id', n.conversation_id,
    'title', case n.kind when 'handoff_asignado' then '🔔 Cliente esperando' when 'retoma' then '🔔 Tu cliente volvió a escribir'
                         when 'cliente_escribe' then '💬 Tu cliente está escribiendo' when 'handoff_escalado' then '⚠️ Cliente sin atender'
                         when 'handoff_sin_vendedor' then '⚠️ Solicitud sin vendedor' when 'handoff_aviso' then '⏰ Cliente esperando' else 'Renovacell' end);
end;
$$;

create or replace function public._cc_aviso_push_tr() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_url text; v_secreto text;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'comm_cron_secret';
    if v_url is null or v_secreto is null then return new; end if;
    perform net.http_post(url := rtrim(v_url, '/') || '/functions/v1/push',
                          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
                          body := jsonb_build_object('action', 'aviso', 'id', new.id), timeout_milliseconds := 10000);
  exception when others then
    raise warning 'PUSH_AVISO: % (el aviso se guardó)', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists cc_aviso_push on public.notifications;
create trigger cc_aviso_push after insert on public.notifications for each row
  when (new.kind in ('handoff_asignado', 'handoff_aviso', 'handoff_escalado', 'handoff_sin_vendedor', 'retoma', 'cliente_escribe'))
  execute function public._cc_aviso_push_tr();

revoke all on function public._cc_responsable_comercial(uuid), public._cc_cliente_escribe_tr(), public._cc_aviso_push_tr(), public.aviso_push_carga(uuid) from public, anon, authenticated;
grant execute on function public.aviso_push_carga(uuid) to service_role;
