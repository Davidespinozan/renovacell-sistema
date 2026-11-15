-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- NOTAS DE VOZ DE WHATSAPP (15 nov 2026, lista del equipo: "no se escuchan notas de voz").
--   Antes el audio (y el video) que mandaba el cliente por WhatsApp solo dejaba el texto "Envió un audio por WhatsApp.";
--   el archivo nunca se guardaba. Ahora meta-webhook lo descarga y lo guarda en el bucket privado `chat_archivos`
--   (cc_archivos, clase 'audio' o 'video') ligado a SU mensaje; el chat lo reproduce con enlace temporal.
--   · _cc_archivo_clase: + audio (ogg/opus, mp3, aac, amr, m4a). Solo agrega casos: las filas existentes no cambian.
--   · cc_archivo_registrar_wa (solo servidor): el archivo va con su mensaje ENTRANTE de WhatsApp ('wa:', visitante o doctor).
--   La subida de archivos desde el portal no cambia (la Edge solo acepta videos y documentos).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_archivos') is null or to_regprocedure('public._cc_archivo_clase(text)') is null then
    raise exception 'PRECONDICION: falta CHAT-ARCHIVOS (20270324)'; end if;
  if to_regprocedure('public.cc_archivo_registrar_wa(uuid,text,text,bigint)') is not null then
    raise exception 'PRECONDICION: cc_archivo_registrar_wa ya existe'; end if;
end $pre$;

update storage.buckets set allowed_mime_types = (
  select array_agg(distinct t) from unnest(coalesce(allowed_mime_types, '{}') || array['audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/amr', 'audio/mp4']) t)
 where id = 'chat_archivos';

create or replace function public._cc_archivo_clase(p_tipo text) returns text language sql immutable set search_path = public as
$$ select case when p_tipo in ('video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp') then 'video'
               when p_tipo in ('audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/amr', 'audio/mp4') then 'audio'
               when p_tipo in ('application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                               'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                               'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation') then 'documento' end $$;

create function public.cc_archivo_registrar_wa(p_message uuid, p_ruta text, p_tipo text, p_bytes bigint) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare m record; a public.cc_archivos;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into a from public.cc_archivos where message_id = p_message;
  if found then return jsonb_build_object('id', a.id, 'idempotente', true); end if;
  select id, conversation_id, client_message_id, actor_type, content into m from public.cc_messages where id = p_message;
  if not found or coalesce(m.client_message_id, '') not like 'wa:%' or m.actor_type not in ('visitor', 'doctor')
     or public._cc_archivo_clase(p_tipo) not in ('audio', 'video')
     or m.content !~ '^Envió un (audio|video) por WhatsApp\.' then
    raise exception 'ARCHIVO_INVALIDO: el mensaje no es un audio o video de WhatsApp' using errcode = 'check_violation'; end if;
  if split_part(p_ruta, '/', 1) <> m.conversation_id::text then raise exception 'ARCHIVO_INVALIDO: ruta de otra conversación' using errcode = 'check_violation'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'chat_archivos' and o.name = p_ruta) then
    raise exception 'ARCHIVO_INEXISTENTE: el archivo no se subió' using errcode = 'check_violation'; end if;
  insert into public.cc_archivos (message_id, conversation_id, ruta, tipo, bytes, nombre)
  values (p_message, m.conversation_id, p_ruta, p_tipo, p_bytes,
          case when public._cc_archivo_clase(p_tipo) = 'audio' then 'Nota de voz' else 'Video' end) returning * into a;
  return jsonb_build_object('id', a.id, 'idempotente', false);
end;
$$;
alter function public.cc_archivo_registrar_wa(uuid, text, text, bigint) owner to postgres;
revoke all on function public.cc_archivo_registrar_wa(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.cc_archivo_registrar_wa(uuid, text, text, bigint) to service_role;
