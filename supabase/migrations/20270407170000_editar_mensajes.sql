-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- EDITAR MENSAJES (15 nov 2026, lista del equipo: "poder editar los mensajes").
--   cc_messages es append-only (trg_ccm_append_only): el original NUNCA cambia. La corrección se guarda aparte
--   (cc_mensaje_ediciones) y la Edge `chat` muestra el texto corregido con la marca «editado».
--   Reglas (como WhatsApp): solo quien lo escribió (personal), solo texto, dentro de 15 minutos, y solo en el PORTAL:
--   lo que ya salió por WhatsApp, Instagram o Facebook no se puede cambiar en el teléfono del cliente (Meta no lo permite).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_mensaje_ediciones') is not null then raise exception 'EDITAR-MENSAJES: ya aplicada'; end if;
  if to_regprocedure('public._cc_contacto_conv(uuid)') is null then raise exception 'EDITAR-MENSAJES: falta CONV-WHATSAPP'; end if;
end $pre$;

create table public.cc_mensaje_ediciones (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.cc_messages(id) on delete cascade,
  conversation_id uuid not null references public.cc_conversations(id) on delete cascade,
  texto           text not null check (length(btrim(texto)) between 1 and 4000),
  editado_por     uuid not null references public.profiles(id),
  created_at      timestamptz not null default now()
);
comment on table public.cc_mensaje_ediciones is 'EDITAR-MENSAJES · correcciones de un mensaje del personal (el original en cc_messages no cambia). Gana la más reciente.';
create index ix_cc_mensaje_ediciones_msg on public.cc_mensaje_ediciones (message_id, created_at desc);
create index ix_cc_mensaje_ediciones_conv on public.cc_mensaje_ediciones (conversation_id, created_at desc);
alter table public.cc_mensaje_ediciones enable row level security;   -- sin políticas: solo el comando y el servidor
revoke all on table public.cc_mensaje_ediciones from public, anon, authenticated;
grant select on table public.cc_mensaje_ediciones to service_role;

create function public.cc_mensaje_editar(p_message uuid, p_texto text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); m record; v_texto text := btrim(coalesce(p_texto, '')); e public.cc_mensaje_ediciones;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if length(v_texto) < 1 or length(v_texto) > 4000 then raise exception 'EDITAR_TEXTO: escribe el mensaje (máximo 4,000 letras)' using errcode = 'check_violation'; end if;
  select id, conversation_id, actor_type, actor_profile_id, client_message_id, content, created_at into m from public.cc_messages where id = p_message;
  if not found or m.actor_profile_id is distinct from v_uid or m.actor_type not in ('seller', 'admin') then
    raise exception 'NO_AUTORIZADO: solo puedes editar tus propios mensajes' using errcode = 'insufficient_privilege'; end if;
  if coalesce(m.client_message_id, '') ~ '^(img|arc):' then raise exception 'EDITAR_TIPO: las fotos y archivos no se editan' using errcode = 'check_violation'; end if;
  if m.created_at < now() - interval '15 minutes' then raise exception 'EDITAR_TIEMPO: solo se puede editar en los primeros 15 minutos' using errcode = 'check_violation'; end if;
  if coalesce(public._cc_contacto_conv(m.conversation_id) ->> 'canal', 'portal') <> 'portal' then
    raise exception 'EDITAR_CANAL: lo que ya salió por WhatsApp, Instagram o Facebook no se puede cambiar en el teléfono del cliente' using errcode = 'check_violation'; end if;
  if v_texto = coalesce((select x.texto from public.cc_mensaje_ediciones x where x.message_id = p_message order by x.created_at desc limit 1), m.content) then
    return jsonb_build_object('message_id', p_message, 'texto', v_texto, 'sin_cambio', true); end if;
  insert into public.cc_mensaje_ediciones (message_id, conversation_id, texto, editado_por) values (p_message, m.conversation_id, v_texto, v_uid) returning * into e;
  return jsonb_build_object('message_id', p_message, 'texto', e.texto, 'editado_at', e.created_at, 'sin_cambio', false);
end;
$$;
alter function public.cc_mensaje_editar(uuid, text) owner to postgres;
revoke all on function public.cc_mensaje_editar(uuid, text) from public, anon;
grant execute on function public.cc_mensaje_editar(uuid, text) to authenticated;

do $post$ begin
  if has_table_privilege('authenticated', 'public.cc_mensaje_ediciones', 'select') then raise exception 'EDITAR-MENSAJES: la tabla quedó expuesta'; end if;
end $post$;
