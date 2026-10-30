-- ============================================================================
-- PUSH DEL EQUIPO (30 oct 2026): los mensajes del "Chat del equipo" y los "Avisos del equipo" mandan aviso al
-- teléfono/computadora de quien debe verlos (aunque tenga el sistema cerrado). Antes solo sonaba la campana con el
-- sistema abierto.
--   · La BASE decide a quién: en un directo, el otro miembro; en un grupo, quien puede leerlo (misma regla que
--     can_access_conversation); en un aviso, su área (o todo el equipo). Nunca a quien lo escribió.
--   · Al guardar, un trigger despierta a la Edge `push` (acción 'equipo', con el secreto de la tarea programada del
--     vault) SOLO si alguno de los destinatarios tiene avisos activados. La Edge pide la carga a la base
--     (equipo_push_carga, solo service) y la manda. Si algo falla, el mensaje se guarda igual.
-- ============================================================================

-- ── 1 · A quién ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public._equipo_destinatarios(p_conv uuid, p_excluir uuid) returns uuid[]
  language sql stable security definer set search_path = public as
$$
  select coalesce(array_agg(p.id), '{}')
    from public.conversations c
    join public.profiles p on p.active and p.role_id <> 'doctor' and p.id is distinct from p_excluir
   where c.id = p_conv and (
     (c.kind = 'dm' and p.id = any (c.member_ids))
     or (c.kind = 'group' and (
       p.role_id = 'admin' or c.area is null or p.role_id = c.area
       or (c.area = 'warehouse' and p.role_id = 'packing')
       or (c.area = 'admin' and p.role_id = any (array['billing', 'comm'])))));
$$;

create or replace function public._equipo_destinatarios_aviso(p_aviso uuid) returns uuid[]
  language sql stable security definer set search_path = public as
$$
  select coalesce(array_agg(p.id), '{}')
    from public.announcements a
    join public.profiles p on p.active and p.id is distinct from a.created_by
     and p.role_id = any (array['admin', 'warehouse', 'packing', 'pos', 'billing', 'driver', 'comm'])
   where a.id = p_aviso
     and (nullif(a.metadata ->> 'audience', '') is null or p.role_id = a.metadata ->> 'audience'
          or (a.metadata ->> 'audience' = 'warehouse' and p.role_id = 'packing'));
$$;

create or replace function public._equipo_recorte(p_texto text, p_max int) returns text
  language sql immutable as
$$ select case when length(t) > p_max then left(t, p_max - 1) || '…' else t end
     from (select btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g')) t) x; $$;

-- ── 2 · Qué dice el aviso (la Edge lo pide; solo service) ─────────────────────────────────────────────
create or replace function public.equipo_push_carga(p_tipo text, p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare m public.messages; c public.conversations; a public.announcements; v_nombre text; v_tipo text;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_tipo = 'mensaje' then
    select * into m from public.messages where id = p_id;
    if m.id is null then return null; end if;
    select * into c from public.conversations where id = m.conversation_id;
    v_nombre := coalesce(nullif(btrim(split_part(m.sender_name, '·', 1)), ''), 'Alguien del equipo');
    return jsonb_build_object(
      'perfiles', to_jsonb(public._equipo_destinatarios(c.id, m.sender_id)),
      'title', case when c.kind = 'dm' then v_nombre else coalesce(nullif(c.title, ''), 'Chat del equipo') end,
      'body', case when c.kind = 'dm' then public._equipo_recorte(m.body, 120)
                   else v_nombre || ': ' || public._equipo_recorte(m.body, 110) end,
      'url', '/sistema?abrir=chat&conv=' || c.id,
      'tag', 'rc-equipo-' || c.id);
  elsif p_tipo = 'aviso' then
    select * into a from public.announcements where id = p_id;
    if a.id is null then return null; end if;
    v_tipo := case when a.metadata ->> 'kind' = 'anuncio' then 'Nuevo anuncio' else 'Nuevo aviso' end;
    v_nombre := nullif(btrim(a.metadata ->> 'author'), '');
    return jsonb_build_object(
      'perfiles', to_jsonb(public._equipo_destinatarios_aviso(a.id)),
      'title', v_tipo || coalesce(' · ' || v_nombre, ''),
      'body', public._equipo_recorte(a.title || coalesce(nullif(' — ' || btrim(a.body), ' — '), ''), 140),
      'url', '/sistema?abrir=avisos',
      'tag', 'rc-aviso-' || a.id);
  end if;
  return null;
end;
$$;

-- ── 3 · Despertar a la Edge al guardar ───────────────────────────────────────────────────────────────
create or replace function public._equipo_push_tr() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_tipo text; v_perfiles uuid[]; v_url text; v_secreto text;
begin
  begin
    if tg_table_name = 'messages' then
      v_tipo := 'mensaje'; v_perfiles := public._equipo_destinatarios(new.conversation_id, new.sender_id);
    else
      v_tipo := 'aviso'; v_perfiles := public._equipo_destinatarios_aviso(new.id);
    end if;
    if not exists (select 1 from public.push_suscripciones s where s.activo and s.profile_id = any (v_perfiles)) then return new; end if;
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'comm_cron_secret';
    if v_url is null or v_secreto is null then return new; end if;
    perform net.http_post(url := rtrim(v_url, '/') || '/functions/v1/push',
                          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
                          body := jsonb_build_object('action', 'equipo', 'tipo', v_tipo, 'id', new.id),
                          timeout_milliseconds := 10000);
  exception when others then
    raise warning 'PUSH_EQUIPO: % (el mensaje se guardó)', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists equipo_push_mensaje on public.messages;
create trigger equipo_push_mensaje after insert on public.messages for each row execute function public._equipo_push_tr();
drop trigger if exists equipo_push_aviso on public.announcements;
create trigger equipo_push_aviso after insert on public.announcements for each row execute function public._equipo_push_tr();

alter function public._equipo_destinatarios(uuid, uuid) owner to postgres;
alter function public._equipo_destinatarios_aviso(uuid) owner to postgres;
alter function public.equipo_push_carga(text, uuid) owner to postgres;
alter function public._equipo_push_tr() owner to postgres;
revoke all on function public._equipo_destinatarios(uuid, uuid), public._equipo_destinatarios_aviso(uuid),
  public._equipo_recorte(text, int), public.equipo_push_carga(text, uuid), public._equipo_push_tr() from public, anon, authenticated;
grant execute on function public.equipo_push_carga(text, uuid) to service_role;
