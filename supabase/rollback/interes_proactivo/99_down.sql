-- INTERÉS PROACTIVO (20270224) · down: fuera la tarea de cada minuto, el trigger, la cola, la configuración y sus funciones.
do $cron$ declare r record; begin
  for r in select jobid from cron.job where jobname = 'renovacell-interes' loop perform cron.unschedule(r.jobid); end loop;
end $cron$;
drop trigger if exists cc_interes_senal on public.cc_actividad_catalogo;
drop function if exists public.interes_config_guardar(boolean, int);
drop function if exists public.interes_config();
drop function if exists public.cliente_interes_reciente(uuid);
drop function if exists public.cc_interes_despachar();
drop function if exists public._cc_interes_texto(uuid, text, uuid, text);
drop function if exists public._cc_dinero(numeric);
drop function if exists public._cc_interes_tr();
drop table if exists public.cc_interes_cola;
drop table if exists public.cc_interes_config;
