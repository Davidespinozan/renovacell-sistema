-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- VIDEOS Y DOCUMENTOS EN CONVERSACIONES (3 nov 2026, dueño: "sí" a que el chat con clientes acepte también videos y
-- documentos, p. ej. la ficha técnica en PDF o un video del producto).
--   Las FOTOS siguen exactamente igual (cc_adjuntos, bucket `chat`, JPG/PNG reducidas): de ellas dependen "Usar como
--   INE", el comprobante de pago desde el chat y el aviso de comprobante por WhatsApp. Lo nuevo vive APARTE:
--   · bucket `chat_archivos`  privado, SIN políticas, 50 MB: solo el servidor firma subidas y descargas.
--   · cc_archivos             un video o documento por mensaje (como cc_adjuntos), con su nombre original.
--   · cc_archivo_autorizar    (servidor) ¿quien llama puede escribir YA en esa conversación? Misma autoridad que
--                             cc_enviar_mensaje (_cc_autoridad, abierta, asesor con asesoría iniciada). Además: por
--                             Instagram/Messenger no salen archivos (solo texto); por WhatsApp, hasta 100 MB.
--   · cc_archivo_registrar    (servidor) liga el archivo ya subido a SU mensaje recién creado (client id 'arc:').
--   El mensaje es un mensaje NORMAL ("Envió un video." / "Envió un documento: <nombre>."): lectura, sesiones, avisos e
--   IA no cambian; la IA sabe que llegó un archivo pero no lo abre.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_archivos') is not null then raise exception 'CHAT-ARCHIVOS: ya aplicada'; end if;
  if exists (select 1 from storage.buckets where id = 'chat_archivos') then raise exception 'CHAT-ARCHIVOS: el bucket ya existe'; end if;
  if to_regprocedure('public._cc_autoridad(uuid,text,uuid,uuid)') is null or to_regprocedure('public._cc_canal_de(uuid)') is null or to_regclass('public.cc_adjuntos') is null then
    raise exception 'CHAT-ARCHIVOS: faltan CC-2, FOTOS EN EL CHAT o el canal'; end if;
end $pre$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat_archivos', 'chat_archivos', false, 52428800, array[
  'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']);

create function public._cc_archivo_clase(p_tipo text) returns text language sql immutable set search_path = public as
$$ select case when p_tipo in ('video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp') then 'video'
               when p_tipo in ('application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                               'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                               'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation') then 'documento' end $$;

create table public.cc_archivos (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null unique references public.cc_messages(id) on delete cascade,
  conversation_id uuid not null references public.cc_conversations(id) on delete cascade,
  ruta            text not null unique check (ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$'),
  tipo            text not null check (public._cc_archivo_clase(tipo) is not null),
  clase           text not null generated always as (public._cc_archivo_clase(tipo)) stored,
  bytes           bigint not null check (bytes between 1 and 52428800),
  nombre          text not null check (length(btrim(nombre)) between 1 and 200),
  created_at      timestamptz not null default now()
);
comment on table public.cc_archivos is 'CHAT-ARCHIVOS · video o documento de un mensaje (bucket privado chat_archivos). Solo el servidor lo lee y firma, tras la autoridad de la conversación.';
create index ix_cc_archivos_conv on public.cc_archivos (conversation_id);
alter table public.cc_archivos enable row level security;   -- sin políticas: solo comandos y servidor
revoke all on table public.cc_archivos from public, anon, authenticated;
grant select, insert on table public.cc_archivos to service_role;

-- ¿Puede escribir YA? Las mismas reglas de cc_enviar_mensaje, sin escribir nada. Devuelve el canal para los límites.
create function public.cc_archivo_autorizar(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_tipo text, p_bytes bigint) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_visitor uuid; c record; v_canal text;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_actor_type not in ('visitor', 'doctor', 'seller', 'admin') then raise exception 'ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
  if public._cc_archivo_clase(p_tipo) is null then raise exception 'ARCHIVO_TIPO: solo videos y documentos (PDF, Word, Excel, PowerPoint, texto)' using errcode = 'check_violation'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 52428800 then raise exception 'ARCHIVO_TAMANO: el máximo es 50 MB' using errcode = 'check_violation'; end if;
  if p_actor_type = 'visitor' then
    v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if;
  end if;
  perform public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if p_actor_type = 'seller' and c.modo <> 'human_active' then raise exception 'ASESORIA_NO_INICIADA: modo %', c.modo using errcode = 'insufficient_privilege'; end if;
  v_canal := public._cc_canal_de(p_conv);
  if v_canal in ('instagram', 'messenger') then
    raise exception 'ARCHIVO_CANAL: por % solo se mandan textos y fotos; comparte el archivo como enlace', initcap(v_canal) using errcode = 'check_violation'; end if;
  return jsonb_build_object('ok', true, 'canal', v_canal, 'clase', public._cc_archivo_clase(p_tipo));
end;
$$;

-- El archivo va con SU mensaje: de esa conversación, marcado como archivo (client id 'arc:'), de quien escribe.
create function public.cc_archivo_registrar(p_message uuid, p_ruta text, p_tipo text, p_bytes bigint, p_nombre text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare m record; a public.cc_archivos;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into a from public.cc_archivos where message_id = p_message;
  if found then return jsonb_build_object('id', a.id, 'idempotente', true); end if;
  select id, conversation_id, client_message_id, actor_type into m from public.cc_messages where id = p_message;
  if not found or coalesce(m.client_message_id, '') not like 'arc:%' or m.actor_type not in ('visitor', 'doctor', 'seller', 'admin') then
    raise exception 'ARCHIVO_INVALIDO: el mensaje no es un archivo' using errcode = 'check_violation'; end if;
  if split_part(p_ruta, '/', 1) <> m.conversation_id::text then raise exception 'ARCHIVO_INVALIDO: ruta de otra conversación' using errcode = 'check_violation'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'chat_archivos' and o.name = p_ruta) then
    raise exception 'ARCHIVO_INEXISTENTE: el archivo no se subió' using errcode = 'check_violation'; end if;
  insert into public.cc_archivos (message_id, conversation_id, ruta, tipo, bytes, nombre)
  values (p_message, m.conversation_id, p_ruta, p_tipo, p_bytes, left(btrim(p_nombre), 200)) returning * into a;
  return jsonb_build_object('id', a.id, 'idempotente', false);
end;
$$;

revoke all on function public._cc_archivo_clase(text) from public, anon;
revoke all on function public.cc_archivo_autorizar(uuid, text, text, uuid, text, bigint), public.cc_archivo_registrar(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.cc_archivo_autorizar(uuid, text, text, uuid, text, bigint), public.cc_archivo_registrar(uuid, text, text, bigint, text) to service_role;

do $post$ begin
  if (select public from storage.buckets where id = 'chat_archivos') or has_table_privilege('authenticated', 'public.cc_archivos', 'select')
     or has_function_privilege('authenticated', 'public.cc_archivo_registrar(uuid,text,text,bigint,text)', 'execute')
     or exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') like '%chat_archivos%' or coalesce(with_check, '') like '%chat_archivos%')) then
    raise exception 'CHAT-ARCHIVOS: el bucket o los permisos no quedaron privados'; end if;
end $post$;
