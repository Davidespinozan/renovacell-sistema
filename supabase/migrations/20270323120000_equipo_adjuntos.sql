-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ADJUNTOS EN EL CHAT DEL EQUIPO (3 nov 2026, Alejandra vía el dueño: "no puede mandar imágenes o videos en el chat;
-- deberían poder tanto imágenes, videos o documentos").
--   · Bucket PRIVADO `equipo` (50 MB por archivo): imágenes, videos y documentos de oficina/PDF.
--   · Ruta <conversación>/<quien sube>/<archivo>: solo quien puede leer esa conversación ve o sube archivos en ella
--     (can_access_conversation, la misma regla de los mensajes); cada quien sube solo en su carpeta; borra el autor o
--     Dirección. Ningún doctor entra (can_access_conversation ya lo excluye).
--   · messages.adjunto (jsonb): {path, nombre, tipo, tamano, clase}. Un disparador exige que el archivo exista en el
--     bucket, sea de esa conversación y lo haya subido quien manda el mensaje: nadie "adjunta" un archivo ajeno.
--   · El aviso al celular de un mensaje sin texto dice "📷 Imagen", "🎥 Video" o "📄 <nombre>".
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'adjunto') then
    raise exception 'EQUIPO-ADJUNTOS: ya aplicada'; end if;
  if to_regprocedure('public.can_access_conversation(uuid)') is null or to_regprocedure('public.equipo_push_carga(text,uuid)') is null then
    raise exception 'EQUIPO-ADJUNTOS: faltan el chat del equipo o PUSH-EQUIPO'; end if;
  if position('public._equipo_recorte(m.body, 120)' in pg_get_functiondef('public.equipo_push_carga(text,uuid)'::regprocedure)) = 0
     or position('public._equipo_recorte(m.body, 110)' in pg_get_functiondef('public.equipo_push_carga(text,uuid)'::regprocedure)) = 0 then
    raise exception 'EQUIPO-ADJUNTOS: equipo_push_carga cambió; revisar el parche'; end if;
end $pre$;

alter table public.messages add column adjunto jsonb;
comment on column public.messages.adjunto is 'EQUIPO-ADJUNTOS · {path, nombre, tipo, tamano, clase: imagen|video|documento}; el archivo vive en el bucket privado equipo.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('equipo', 'equipo', false, 52428800, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

-- Conversación dueña de una ruta del bucket (null si la ruta no empieza con un uuid: nunca un error de conversión).
create function public._equipo_conv_de_ruta(p_name text) returns uuid language sql immutable set search_path = public as
$$ select case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 1)::uuid end $$;

create policy equipo_adjuntos_leer on storage.objects for select to authenticated
  using (bucket_id = 'equipo' and public.can_access_conversation(public._equipo_conv_de_ruta(name)));
create policy equipo_adjuntos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'equipo' and split_part(name, '/', 2) = auth.uid()::text and split_part(name, '/', 3) <> ''
              and public.can_access_conversation(public._equipo_conv_de_ruta(name)));
create policy equipo_adjuntos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'equipo' and (split_part(name, '/', 2) = auth.uid()::text or public.auth_role() = 'admin')
         and public.can_access_conversation(public._equipo_conv_de_ruta(name)));

-- Un mensaje con adjunto: forma válida, archivo existente en ESA conversación y subido por quien lo manda.
create function public._equipo_adjunto_valida() returns trigger language plpgsql security definer set search_path = public as
$$
declare a jsonb := new.adjunto; v_path text;
begin
  if a is null then
    if btrim(coalesce(new.body, '')) = '' then raise exception 'MENSAJE_VACIO' using errcode = 'check_violation'; end if;
    return new;
  end if;
  if jsonb_typeof(a) <> 'object' or coalesce(a ->> 'clase', '') not in ('imagen', 'video', 'documento')
     or coalesce(a ->> 'path', '') = '' or coalesce(btrim(a ->> 'nombre'), '') = '' or coalesce(a ->> 'tipo', '') = '' then
    raise exception 'ADJUNTO_INVALIDO' using errcode = 'check_violation'; end if;
  v_path := a ->> 'path';
  if public._equipo_conv_de_ruta(v_path) is distinct from new.conversation_id or split_part(v_path, '/', 2) <> coalesce(new.sender_id::text, '') then
    raise exception 'ADJUNTO_AJENO: el archivo no es de esta conversación o no lo subiste tú' using errcode = 'check_violation'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'equipo' and o.name = v_path) then
    raise exception 'ADJUNTO_INEXISTENTE: sube el archivo antes de mandarlo' using errcode = 'check_violation'; end if;
  new.adjunto := jsonb_build_object('path', v_path, 'nombre', left(btrim(a ->> 'nombre'), 200), 'tipo', left(a ->> 'tipo', 120),
                                    'tamano', case when (a ->> 'tamano') ~ '^\d{1,12}$' then (a ->> 'tamano')::bigint end, 'clase', a ->> 'clase');
  new.body := coalesce(new.body, '');
  return new;
end;
$$;
create trigger equipo_adjunto_valida before insert on public.messages for each row execute function public._equipo_adjunto_valida();

-- Texto del aviso: el mensaje o, si solo es un archivo, qué es.
create function public._equipo_texto_msg(m public.messages) returns text language sql stable set search_path = public as
$$ select coalesce(nullif(btrim(m.body), ''), case m.adjunto ->> 'clase' when 'imagen' then '📷 Imagen' when 'video' then '🎥 Video'
                                                   when 'documento' then '📄 ' || coalesce(m.adjunto ->> 'nombre', 'Documento') end, '') $$;

do $patch$
declare d text := pg_get_functiondef('public.equipo_push_carga(text,uuid)'::regprocedure);
begin
  d := replace(d, 'public._equipo_recorte(m.body, 120)', 'public._equipo_recorte(public._equipo_texto_msg(m), 120)');
  d := replace(d, 'public._equipo_recorte(m.body, 110)', 'public._equipo_recorte(public._equipo_texto_msg(m), 110)');
  execute d;
end $patch$;

revoke all on function public._equipo_adjunto_valida(), public._equipo_texto_msg(public.messages) from public, anon, authenticated;
grant execute on function public._equipo_conv_de_ruta(text) to authenticated;

do $post$ begin
  if position('_equipo_texto_msg(m)' in pg_get_functiondef('public.equipo_push_carga(text,uuid)'::regprocedure)) = 0
     or not exists (select 1 from storage.buckets where id = 'equipo' and not public) then
    raise exception 'EQUIPO-ADJUNTOS: no quedó aplicada'; end if;
end $post$;
