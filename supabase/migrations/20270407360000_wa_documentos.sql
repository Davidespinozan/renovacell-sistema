-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- DOCUMENTOS DE WHATSAPP (20 nov 2026, dueño: "le llegó un mensaje a Roberto con un documento y no lo puedo ver").
--   Lo que el cliente manda "como documento" por WhatsApp (su comprobante en PDF, un Word, un Excel, una foto sin
--   comprimir) solo dejaba el texto "Envió un documento por WhatsApp."; el archivo nunca se guardaba (4 casos en
--   producción, ninguno recuperable: Meta ya no entrega el archivo de un mensaje viejo).
--   Ahora meta-webhook lo descarga y lo guarda en el bucket privado `chat_archivos` (cc_archivos) ligado a SU mensaje,
--   igual que las notas de voz; el chat lo muestra como tarjeta con su nombre y se abre con enlace temporal.
--   · _cc_archivo_clase: + fotos (jpg, png, webp, heic) como 'documento'. Solo agrega casos: las filas existentes no
--     cambian. La subida desde el portal no cambia: la Edge `chat` sigue aceptando solo videos y documentos.
--   · cc_archivo_registrar_wa (solo servidor): + p_nombre (opcional) y acepta el mensaje "Envió un documento por
--     WhatsApp.". Con 4 argumentos se comporta igual que antes (audio y video).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_archivo_registrar_wa(uuid,text,text,bigint)') is null then
    raise exception 'PRECONDICION: falta NOTAS DE VOZ (20270407160000)'; end if;
  if to_regprocedure('public.cc_archivo_registrar_wa(uuid,text,text,bigint,text)') is not null then
    raise exception 'PRECONDICION: DOCUMENTOS DE WHATSAPP ya está aplicada'; end if;
  if not exists (select 1 from storage.buckets where id = 'chat_archivos' and not public) then
    raise exception 'PRECONDICION: falta el bucket privado chat_archivos'; end if;
end $pre$;

update storage.buckets set allowed_mime_types = (
  select array_agg(distinct t) from unnest(coalesce(allowed_mime_types, '{}') || array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) t)
 where id = 'chat_archivos';

create or replace function public._cc_archivo_clase(p_tipo text) returns text language sql immutable set search_path = public as
$$ select case when p_tipo in ('video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp') then 'video'
               when p_tipo in ('audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/amr', 'audio/mp4') then 'audio'
               when p_tipo in ('application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                               'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                               'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                               'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then 'documento' end $$;

-- Una sola firma (la de 5 argumentos, el último opcional): con dos firmas la llamada de 4 argumentos sería ambigua.
drop function public.cc_archivo_registrar_wa(uuid, text, text, bigint);
create function public.cc_archivo_registrar_wa(p_message uuid, p_ruta text, p_tipo text, p_bytes bigint, p_nombre text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare m record; a public.cc_archivos; v_clase text := public._cc_archivo_clase(p_tipo); v_nombre text;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into a from public.cc_archivos where message_id = p_message;
  if found then return jsonb_build_object('id', a.id, 'idempotente', true); end if;
  select id, conversation_id, client_message_id, actor_type, content into m from public.cc_messages where id = p_message;
  -- El audio y el video van con su mensaje de audio o video; como DOCUMENTO puede llegar cualquier tipo permitido
  -- (también un video o un audio adjuntado como archivo).
  if not found or coalesce(m.client_message_id, '') not like 'wa:%' or m.actor_type not in ('visitor', 'doctor') or v_clase is null
     or not ((v_clase in ('audio', 'video') and m.content ~ '^Envió un (audio|video) por WhatsApp\.')
             or m.content ~ '^Envió un documento por WhatsApp\.') then
    raise exception 'ARCHIVO_INVALIDO: el mensaje no es un audio, video o documento de WhatsApp' using errcode = 'check_violation'; end if;
  if split_part(p_ruta, '/', 1) <> m.conversation_id::text then raise exception 'ARCHIVO_INVALIDO: ruta de otra conversación' using errcode = 'check_violation'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'chat_archivos' and o.name = p_ruta) then
    raise exception 'ARCHIVO_INEXISTENTE: el archivo no se subió' using errcode = 'check_violation'; end if;
  v_nombre := left(nullif(btrim(regexp_replace(coalesce(p_nombre, ''), '[[:cntrl:]/\\]+', ' ', 'g')), ''), 200);
  insert into public.cc_archivos (message_id, conversation_id, ruta, tipo, bytes, nombre)
  values (p_message, m.conversation_id, p_ruta, p_tipo, p_bytes,
          coalesce(v_nombre, case v_clase when 'audio' then 'Nota de voz' when 'video' then 'Video' else 'Documento' end)) returning * into a;
  return jsonb_build_object('id', a.id, 'idempotente', false);
end;
$$;
alter function public.cc_archivo_registrar_wa(uuid, text, text, bigint, text) owner to postgres;
revoke all on function public.cc_archivo_registrar_wa(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.cc_archivo_registrar_wa(uuid, text, text, bigint, text) to service_role;

notify pgrst, 'reload schema';
