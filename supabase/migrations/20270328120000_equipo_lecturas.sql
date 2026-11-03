-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CHAT DEL EQUIPO · PALOMITAS AZULES Y "ESCRIBIENDO…" (3 nov 2026, dueño: "que el chat del equipo también tenga palomitas
-- azules y el escribiendo igual que en Conversaciones").
--   Antes, lo leído vivía solo en el navegador (localStorage): servía para resaltar lo nuevo, no para avisar al otro.
--   · equipo_lecturas    una fila por persona y conversación: hasta qué mensaje leyó (instante) y si está tecleando
--                        (escribiendo_hasta vence sola en segundos). Nunca guarda el texto.
--   · Leer: quien puede leer la conversación (can_access_conversation, la misma regla de los mensajes). Escribir: solo
--     por comandos y solo lo propio. Se publica en Realtime para que las palomitas y el "escribiendo…" lleguen al momento.
--   · equipo_lectores(conv): quiénes deberían leerla (los mismos destinatarios del aviso al celular, sin cuentas
--     internas) con hasta dónde leyó cada uno: en un directo, el otro; en un grupo, todos (azul cuando todos vieron).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.equipo_lecturas') is not null then raise exception 'EQUIPO-LECTURAS: ya aplicada'; end if;
  if to_regprocedure('public._equipo_destinatarios(uuid,uuid)') is null or to_regprocedure('public.can_access_conversation(uuid)') is null then
    raise exception 'EQUIPO-LECTURAS: faltan el chat del equipo o PUSH-EQUIPO'; end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') or (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'EQUIPO-LECTURAS: publicación supabase_realtime ausente o FOR ALL TABLES'; end if;
end $pre$;

create table public.equipo_lecturas (
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  leido_hasta       timestamptz,
  escribiendo_hasta timestamptz,
  updated_at        timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);
comment on table public.equipo_lecturas is 'EQUIPO-LECTURAS · hasta dónde leyó cada quien y si está tecleando (sin texto). Escritura solo por comandos.';
alter table public.equipo_lecturas enable row level security;
revoke all on public.equipo_lecturas from public, anon, authenticated;
grant select on public.equipo_lecturas to authenticated;
create policy equipo_lecturas_ver on public.equipo_lecturas for select to authenticated using (public.can_access_conversation(conversation_id));

-- Leí hasta aquí (nunca retrocede; no más allá del último mensaje).
create function public.equipo_leido(p_conv uuid, p_hasta timestamptz) returns void language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_max timestamptz;
begin
  if v_uid is null or not public.can_access_conversation(p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select max(created_at) into v_max from public.messages where conversation_id = p_conv;
  if v_max is null or p_hasta is null then return; end if;
  insert into public.equipo_lecturas (conversation_id, profile_id, leido_hasta) values (p_conv, v_uid, least(p_hasta, v_max))
  on conflict (conversation_id, profile_id) do update set leido_hasta = greatest(coalesce(equipo_lecturas.leido_hasta, excluded.leido_hasta), excluded.leido_hasta), updated_at = now()
    where equipo_lecturas.leido_hasta is distinct from greatest(coalesce(equipo_lecturas.leido_hasta, excluded.leido_hasta), excluded.leido_hasta);
end;
$$;

-- Estoy escribiendo (vence sola en 6 s) / dejé de escribir.
create function public.equipo_escribiendo(p_conv uuid, p_activo boolean) returns void language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.can_access_conversation(p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  insert into public.equipo_lecturas (conversation_id, profile_id, escribiendo_hasta) values (p_conv, v_uid, case when p_activo then now() + interval '6 seconds' end)
  on conflict (conversation_id, profile_id) do update set escribiendo_hasta = excluded.escribiendo_hasta, updated_at = now();
end;
$$;

-- Quiénes deberían leerla (sin mí ni cuentas internas) y hasta dónde leyó cada uno.
create function public.equipo_lectores(p_conv uuid) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.can_access_conversation(p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', p.id, 'nombre', coalesce(nullif(btrim(p.full_name), ''), 'Equipo'), 'leido_hasta', l.leido_hasta,
                                        'escribiendo', coalesce(l.escribiendo_hasta > now(), false)) order by p.full_name)
      from unnest(public._equipo_destinatarios(p_conv, v_uid)) d(id)
      join public.profiles p on p.id = d.id and not coalesce(p.interna, false)
      left join public.equipo_lecturas l on l.conversation_id = p_conv and l.profile_id = p.id), '[]'::jsonb);
end;
$$;

revoke all on function public.equipo_leido(uuid, timestamptz), public.equipo_escribiendo(uuid, boolean), public.equipo_lectores(uuid) from public, anon;
grant execute on function public.equipo_leido(uuid, timestamptz), public.equipo_escribiendo(uuid, boolean), public.equipo_lectores(uuid) to authenticated;

do $rt$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'equipo_lecturas') then
    alter publication supabase_realtime add table public.equipo_lecturas;
  end if;
end $rt$;

do $post$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'equipo_lecturas')
     or has_table_privilege('anon', 'public.equipo_lecturas', 'select') or has_table_privilege('authenticated', 'public.equipo_lecturas', 'insert') then
    raise exception 'EQUIPO-LECTURAS: no quedó aplicada o con permisos de más'; end if;
end $post$;
