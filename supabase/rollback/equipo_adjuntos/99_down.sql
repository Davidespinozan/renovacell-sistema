-- Reversa de 20270323120000_equipo_adjuntos.sql. El bucket solo se quita si está vacío (los archivos subidos no se borran).
do $patch$
declare d text := pg_get_functiondef('public.equipo_push_carga(text,uuid)'::regprocedure);
begin
  d := replace(d, 'public._equipo_recorte(public._equipo_texto_msg(m), 120)', 'public._equipo_recorte(m.body, 120)');
  d := replace(d, 'public._equipo_recorte(public._equipo_texto_msg(m), 110)', 'public._equipo_recorte(m.body, 110)');
  execute d;
end $patch$;
drop trigger if exists equipo_adjunto_valida on public.messages;
drop policy if exists equipo_adjuntos_leer on storage.objects;
drop policy if exists equipo_adjuntos_subir on storage.objects;
drop policy if exists equipo_adjuntos_borrar on storage.objects;
drop function if exists public._equipo_adjunto_valida(), public._equipo_texto_msg(public.messages), public._equipo_conv_de_ruta(text);
alter table public.messages drop column if exists adjunto;
delete from storage.buckets b where b.id = 'equipo' and not exists (select 1 from storage.objects o where o.bucket_id = 'equipo');
