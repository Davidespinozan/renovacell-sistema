-- CHAT PRO · rollback de la migración 161. Se pierden las respuestas rápidas guardadas; las conversaciones ya unidas
-- siguen unidas (la unión es la misma adopción de CC-1 y no se deshace).
drop function public.cc_enlace_unir(uuid, uuid);
drop function public.cc_enlace_candidatos(uuid);
drop function public._tel10(text);
drop function public.cc_respuesta_borrar(uuid);
drop function public.cc_respuesta_guardar(uuid, text, text, boolean);
drop table public.cc_respuestas_rapidas;
drop function public.cc_escribiendo(uuid, text, text, uuid, boolean);
alter table public.cc_participants drop column escribiendo_hasta;
