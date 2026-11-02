-- SEGUIMIENTO IA (20270301) · down: sin cron, sin push proactivo, sin seguimiento.
do $cron$ declare r record; begin for r in select jobid from cron.job where jobname = 'renovacell-seguimiento' loop perform cron.unschedule(r.jobid); end loop; end $cron$;
drop trigger if exists cc_proactivo_push on public.cc_messages;
drop function if exists public._cc_proactivo_push_tr();
drop function if exists public.ia_proactivo_push_carga(uuid);
drop function if exists public.seguimiento_resumen(int);
drop function if exists public.seguimiento_config_guardar(jsonb);
drop function if exists public.seguimiento_config();
drop function if exists public.cc_seguimiento_despachar();
drop function if exists public._cc_seg_candidatos(public.cc_seguimiento_config);
drop function if exists public._cc_seg_texto_promo(uuid, uuid, uuid);
drop function if exists public._cc_seg_texto_recompra(uuid, uuid, int, date);
drop function if exists public._cc_seg_texto_carrito(uuid, uuid);
drop function if exists public._cc_seg_nivel(uuid, int);
drop function if exists public._cc_seg_puede(uuid, uuid, public.cc_seguimiento_config);
drop function if exists public._cc_seg_ciclo_categoria(text);
drop table if exists public.cc_seguimiento_envios;
drop table if exists public.cc_seguimiento_config;
