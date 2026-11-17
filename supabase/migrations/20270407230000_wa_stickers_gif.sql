-- STICKERS, GIFS Y WEBP DE WHATSAPP (17 nov 2026, dueño: «¿no podemos hacer que sí se vean los gifs, emojis, stickers que
-- manda el cliente?»). Las fotos del chat solo aceptaban JPG y PNG: un sticker (WEBP, también animado) o una imagen GIF/WEBP
-- se descargaba y se tiraba, y quedaba solo el texto. Ahora se guardan y se ven:
--   · bucket `chat` y cc_adjuntos aceptan image/webp e image/gif (mismo tope de 3 MB).
--   · cc_adjunto_registrar_wa acepta también el mensaje "Envió un sticker por WhatsApp.".
do $pre$ begin
  if position('m.content not like ''Envió una imagen por WhatsApp.%''' in pg_get_functiondef('public.cc_adjunto_registrar_wa(uuid,text,text,integer)'::regprocedure)) = 0 then
    raise exception 'WA-STICKERS: cc_adjunto_registrar_wa cambió; revisar el parche'; end if;
end $pre$;

update storage.buckets set allowed_mime_types = (select array_agg(distinct t) from unnest(coalesce(allowed_mime_types, '{}') || array['image/webp', 'image/gif']) t) where id = 'chat';

alter table public.cc_adjuntos drop constraint cc_adjuntos_tipo_check;
alter table public.cc_adjuntos add constraint cc_adjuntos_tipo_check check (tipo = any (array['image/jpeg', 'image/png', 'image/webp', 'image/gif']));
alter table public.cc_adjuntos drop constraint cc_adjuntos_ruta_check;
alter table public.cc_adjuntos add constraint cc_adjuntos_ruta_check check (ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$');

do $patch$
declare d text := pg_get_functiondef('public.cc_adjunto_registrar_wa(uuid,text,text,integer)'::regprocedure);
begin
  execute replace(d, 'm.content not like ''Envió una imagen por WhatsApp.%''',
                     '(m.content not like ''Envió una imagen por WhatsApp.%'' and m.content not like ''Envió un sticker por WhatsApp.%'')');
end $patch$;

do $post$ begin
  if position('Envió un sticker por WhatsApp.%' in pg_get_functiondef('public.cc_adjunto_registrar_wa(uuid,text,text,integer)'::regprocedure)) = 0
     or not (select 'image/webp' = any (allowed_mime_types) from storage.buckets where id = 'chat') then
    raise exception 'WA-STICKERS: no quedó aplicada'; end if;
end $post$;
