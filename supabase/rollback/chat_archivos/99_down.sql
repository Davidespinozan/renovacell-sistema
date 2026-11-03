-- Reversa de 20270324120000_chat_archivos.sql. El bucket solo se quita si está vacío (los archivos subidos no se borran).
drop function if exists public.cc_archivo_registrar(uuid, text, text, bigint, text), public.cc_archivo_autorizar(uuid, text, text, uuid, text, bigint);
drop table if exists public.cc_archivos;
drop function if exists public._cc_archivo_clase(text);
delete from storage.buckets b where b.id = 'chat_archivos' and not exists (select 1 from storage.objects o where o.bucket_id = 'chat_archivos');
