-- PUSH DEL EQUIPO (20270220) · down: fuera los triggers y las funciones del aviso del chat y de los avisos del equipo.
drop trigger if exists equipo_push_mensaje on public.messages;
drop trigger if exists equipo_push_aviso on public.announcements;
drop function if exists public._equipo_push_tr();
drop function if exists public.equipo_push_carga(text, uuid);
drop function if exists public._equipo_recorte(text, int);
drop function if exists public._equipo_destinatarios_aviso(uuid);
drop function if exists public._equipo_destinatarios(uuid, uuid);
