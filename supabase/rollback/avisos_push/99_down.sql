-- AVISOS PUSH · rollback de la migración 160. Los dispositivos dados de alta se pierden (dejan de recibir avisos).
drop function public.push_resultado(uuid, boolean, boolean);
drop function public.push_destinos(uuid[], uuid[]);
drop function public.push_baja(text);
drop function public.push_suscribir(uuid, text, text, text, text);
drop table public.push_suscripciones;
