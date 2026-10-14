-- FOTOS EN EL CHAT · rollback de la migración 157. Aplicar en UNA transacción. Los mensajes "Envió una imagen."
-- se conservan (son historia de la conversación); los archivos del bucket se borran aparte, con service_role.
do $pre$ begin
  if to_regclass('public.cc_adjuntos') is null then raise exception 'CHAT-ADJUNTOS rollback: la migración no está aplicada'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'chat') then raise exception 'CHAT-ADJUNTOS rollback: el bucket chat tiene archivos; bórralos antes con service_role'; end if;
end $pre$;
drop function public.cc_adjunto_marcar_uso(uuid, text, uuid);
drop function public.cc_adjunto_para_verificacion(uuid);
drop function public.cc_adjunto_registrar(uuid, text, text, integer);
drop table public.cc_adjuntos;
delete from storage.buckets where id = 'chat';
