-- HERRAMIENTAS DEL VENDEDOR · bloque C (20270216) · down: fuera los seguimientos y su cron (se pierden los capturados).
do $c$ declare r record; begin for r in select jobid from cron.job where jobname = 'renovacell-seguimientos' loop perform cron.unschedule(r.jobid); end loop; end $c$;
drop function public.cc_seguimientos_avisar();
drop function public.mis_seguimientos();
drop function public.seguimiento_de(uuid, uuid);
drop function public.seguimiento_actualizar(uuid, boolean, date);
drop function public.seguimiento_guardar(uuid, uuid, text, text, date);
drop function public._seguimiento_json(public.cc_seguimientos);
drop function public._puede_seguimiento(uuid, uuid);
drop table public.cc_seguimientos;
