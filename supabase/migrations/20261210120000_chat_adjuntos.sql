-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- FOTOS EN EL CHAT (migración 157) · EL CLIENTE Y SU ASESOR SE MANDAN IMÁGENES EN LA MISMA CONVERSACIÓN
--   Decisiones del dueño (15 oct 2026): solo imágenes (JPG/PNG); las ven solo los participantes (cliente, su asesor,
--   Dirección) con enlaces que caducan; el asistente de IA no las "ve" (sabe que llegó una foto); quien puede verificar
--   al doctor puede usar una foto como INE frente o reverso; se guardan como el resto de la conversación.
--   · bucket `chat`        NUEVO, privado, sin políticas: solo el servidor sube y firma (después de que los comandos
--                          cc_* autorizan a quien escribe o lee).
--   · cc_adjuntos          NUEVA. Una imagen por mensaje. El mensaje es un mensaje NORMAL ("Envió una imagen."), así
--                          que lectura, sesiones, cursores, avisos e IA no cambian.
--   · cc_adjunto_registrar          NUEVA (servidor). Liga la imagen subida a SU mensaje recién creado.
--   · cc_adjunto_para_verificacion  NUEVA. Para "Usar como INE": la imagen la mandó el propio doctor y quien pide puede
--                                    verificarlo; devuelve dónde está.
--   · cc_adjunto_marcar_uso         NUEVA (servidor). Deja constancia de que la foto se usó como evidencia.
--   NO cambia: cc_messages, cc_enviar_mensaje, cc_leer_conversacion, sesiones, IA, ni las políticas de `proofs`.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/chat_adjuntos/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_adjuntos') is not null then raise exception 'CHAT-ADJUNTOS: ya aplicada'; end if;
  if exists (select 1 from storage.buckets where id = 'chat') then raise exception 'CHAT-ADJUNTOS: el bucket chat ya existe'; end if;
  if to_regprocedure('public._puede_verificar(uuid)') is null then raise exception 'CHAT-ADJUNTOS: falta la 154'; end if;
end $pre$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 3000000, array['image/jpeg', 'image/png']);

create table public.cc_adjuntos (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null unique references public.cc_messages(id) on delete restrict,
  conversation_id uuid not null references public.cc_conversations(id) on delete restrict,
  ruta            text not null unique check (ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'),
  tipo            text not null check (tipo in ('image/jpeg', 'image/png')),
  bytes           integer not null check (bytes between 1 and 3000000),
  uso             text check (uso is null or uso in ('ine-front', 'ine-back')),
  usado_por       uuid references public.profiles(id) on delete set null,
  usado_at        timestamptz,
  created_at      timestamptz not null default now()
);
comment on table public.cc_adjuntos is 'FOTOS EN EL CHAT · imagen de un mensaje. Se lee y firma solo por el servidor tras la autoridad de la conversación.';
create index ix_cc_adjuntos_conv on public.cc_adjuntos (conversation_id);
alter table public.cc_adjuntos enable row level security;   -- sin políticas: solo comandos y servidor
revoke all on table public.cc_adjuntos from public, anon, authenticated;
grant select, insert, update on table public.cc_adjuntos to service_role;

create function public.cc_adjunto_registrar(p_message uuid, p_ruta text, p_tipo text, p_bytes integer) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- La imagen va con SU mensaje: de esa conversación, de quien la mandó, marcado como imagen (client id 'img:').
declare m record; a public.cc_adjuntos;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into a from public.cc_adjuntos where message_id = p_message;
  if found then return jsonb_build_object('id', a.id, 'idempotente', true); end if;
  select id, conversation_id, client_message_id, actor_type into m from public.cc_messages where id = p_message;
  if not found or coalesce(m.client_message_id, '') not like 'img:%' or m.actor_type not in ('visitor', 'doctor', 'seller', 'admin') then
    raise exception 'ADJUNTO_INVALIDO: el mensaje no es una imagen' using errcode = 'check_violation';
  end if;
  if split_part(p_ruta, '/', 1) <> m.conversation_id::text then raise exception 'ADJUNTO_INVALIDO: ruta de otra conversación' using errcode = 'check_violation'; end if;
  insert into public.cc_adjuntos (message_id, conversation_id, ruta, tipo, bytes) values (p_message, m.conversation_id, p_ruta, p_tipo, p_bytes) returning * into a;
  return jsonb_build_object('id', a.id, 'idempotente', false);
end;
$$;

create function public.cc_adjunto_para_verificacion(p_adjunto uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
-- "Usar como INE": la foto la mandó el PROPIO doctor (dueño de la conversación) y quien pide puede verificarlo.
declare a record;
begin
  select ad.id, ad.ruta, ad.tipo, c.profile_id, m.actor_type, m.actor_profile_id into a
    from public.cc_adjuntos ad join public.cc_messages m on m.id = ad.message_id join public.cc_conversations c on c.id = ad.conversation_id
   where ad.id = p_adjunto;
  if not found then raise exception 'ADJUNTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if a.profile_id is null or a.actor_type <> 'doctor' or a.actor_profile_id is distinct from a.profile_id then
    raise exception 'ADJUNTO_NO_ES_DEL_DOCTOR: solo una foto que mandó el propio doctor sirve como su identificación' using errcode = 'check_violation';
  end if;
  if not public._puede_verificar(a.profile_id) then raise exception 'NO_AUTORIZADO: no atiendes a este doctor' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object('profile_id', a.profile_id, 'ruta', a.ruta, 'tipo', a.tipo);
end;
$$;

create function public.cc_adjunto_marcar_uso(p_adjunto uuid, p_uso text, p_por uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_uso not in ('ine-front', 'ine-back') then raise exception 'USO_INVALIDO' using errcode = 'check_violation'; end if;
  update public.cc_adjuntos set uso = p_uso, usado_por = p_por, usado_at = now() where id = p_adjunto;
end;
$$;

alter function public.cc_adjunto_registrar(uuid, text, text, integer) owner to postgres;
alter function public.cc_adjunto_para_verificacion(uuid) owner to postgres;
alter function public.cc_adjunto_marcar_uso(uuid, text, uuid) owner to postgres;
revoke all on function public.cc_adjunto_registrar(uuid, text, text, integer), public.cc_adjunto_marcar_uso(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cc_adjunto_registrar(uuid, text, text, integer), public.cc_adjunto_marcar_uso(uuid, text, uuid) to service_role;
revoke all on function public.cc_adjunto_para_verificacion(uuid) from public, anon;
grant execute on function public.cc_adjunto_para_verificacion(uuid) to authenticated, service_role;

do $post$ begin
  if (select public from storage.buckets where id = 'chat') or has_table_privilege('authenticated', 'public.cc_adjuntos', 'select')
     or has_function_privilege('authenticated', 'public.cc_adjunto_registrar(uuid,text,text,integer)', 'execute')
     or exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') like '%''chat''%' or coalesce(with_check, '') like '%''chat''%')) then
    raise exception 'CHAT-ADJUNTOS: el bucket o los permisos no quedaron privados';
  end if;
end $post$;
