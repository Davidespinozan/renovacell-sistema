-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ROLLBACK · Chat V2-C2 (migración 127) → estado de la 126. Retira el cron, el motor, la vista previa, la
-- configuración de sesiones y restaura la regla de actividad y el cierre de C1. NO toca sesiones, mensajes
-- ni eventos: los cierres por inactividad ya ocurridos siguen siendo historia real de C1.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $c$ begin
  if to_regprocedure('cron.unschedule(text)') is not null and exists (select 1 from cron.job where jobname = 'renovacell-sesiones-inactivas') then
    perform cron.unschedule('renovacell-sesiones-inactivas');
  end if;
end $c$;

CREATE OR REPLACE FUNCTION public._cc_sesion_mensaje()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_ord int; v_origen text;
begin
  update public.cc_conversation_sessions set last_activity_at = new.created_at where conversation_id = new.conversation_id and estado = 'abierta';
  if found then return null; end if;
  v_origen := case
    when new.actor_type = 'system' and coalesce(new.client_message_id, '') like 'sys:handoff:%' then 'carrito'
    when new.actor_type = 'system' and coalesce(new.client_message_id, '') like 'sys:solicitud:%' then 'cliente'
    when new.actor_type in ('doctor', 'visitor') then 'cliente'
    when new.actor_type in ('seller', 'admin') then 'asesor'
    else 'sistema' end;
  select coalesce(max(ordinal), 0) + 1 into v_ord from public.cc_conversation_sessions where conversation_id = new.conversation_id;
  insert into public.cc_conversation_sessions (conversation_id, ordinal, estado, origen, first_seq, opened_at, last_activity_at)
  values (new.conversation_id, v_ord, 'abierta', v_origen, new.seq, new.created_at, new.created_at) returning id into v_id;
  insert into public.cc_conversation_events (conversation_id, tipo, actor_type, detalle, session_id)
  values (new.conversation_id, 'session_opened', 'system', jsonb_build_object('ordinal', v_ord, 'origen', v_origen, 'first_seq', new.seq), v_id);
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_sesion_cerrar(p_conv uuid, p_motivo text, p_actor_type text, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare s record; c record;
begin
  select * into s from public.cc_conversation_sessions where conversation_id = p_conv and estado = 'abierta' for update;
  if not found then return null; end if;
  select * into c from public.cc_conversations where id = p_conv;
  insert into public.cc_conversation_events (conversation_id, tipo, actor_type, actor_profile_id, detalle, session_id)
  values (p_conv, 'session_closed', p_actor_type, p_actor, jsonb_build_object('ordinal', s.ordinal, 'motivo', p_motivo, 'first_seq', s.first_seq, 'last_seq', c.ultimo_seq, 'modo', c.modo), s.id);
  update public.cc_conversation_sessions
     set estado = 'cerrada', last_seq = c.ultimo_seq, closed_at = now(), close_reason = p_motivo, closed_by_actor_type = p_actor_type, closed_by_profile_id = p_actor,
         handoff_origen = coalesce(c.handoff_origen, handoff_origen), handoff_cart_id = coalesce(c.handoff_cart_id, handoff_cart_id),
         asesoria_solicitada_at = coalesce(c.asesoria_solicitada_at, asesoria_solicitada_at), asesoria_asignada_at = coalesce(c.asesoria_asignada_at, asesoria_asignada_at),
         asesoria_iniciada_at = coalesce(c.asesoria_iniciada_at, asesoria_iniciada_at)
   where id = s.id;
  return s.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_atencion_config_ver()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg record;
begin
  perform public._cc7_direccion();
  select * into cfg from public.cc_atencion_config where id = 1;
  return jsonb_build_object('aviso_min', cfg.aviso_min, 'escalamiento_min', cfg.escalamiento_min, 'pausar_fuera_horario', cfg.pausar_fuera_horario, 'updated_at', cfg.updated_at,
                            'horario', public._cc_horario_estado(now()));
end;
$function$;

drop function if exists public.cc_sesiones_config_guardar(integer, integer, integer, integer);
drop function if exists public.cc_sesiones_inactivas_preview(integer, integer, integer, integer);
drop function if exists public.cc_sesiones_cerrar_inactivas(integer);
drop function if exists public._cc_atencion_liberar(uuid);
drop function if exists public._cc_sesion_cerrar_con(uuid, text, text, uuid, jsonb);
drop function if exists public._cc_mensaje_renueva(text, text);

alter table public.cc_conversation_sessions drop constraint if exists ck_ccs_motivo;
do $m$ begin
  if exists (select 1 from public.cc_conversation_sessions where close_reason = 'solicitud_expirada') then
    alter table public.cc_conversation_sessions add constraint ck_ccs_motivo check (close_reason is null or close_reason in ('asesor_finalizo', 'direccion_finalizo', 'inactividad', 'conversacion_cerrada', 'consolidada')) not valid;
  else
    alter table public.cc_conversation_sessions add constraint ck_ccs_motivo check (close_reason is null or close_reason in ('asesor_finalizo', 'direccion_finalizo', 'inactividad', 'conversacion_cerrada', 'consolidada'));
  end if;
end $m$;
alter table public.cc_atencion_config_hist drop column if exists sesion_ia_min, drop column if exists sesion_humana_min, drop column if exists sesion_aviso_previo_min, drop column if exists solicitud_expira_min;
alter table public.cc_atencion_config drop column if exists sesion_ia_min, drop column if exists sesion_humana_min, drop column if exists sesion_aviso_previo_min, drop column if exists solicitud_expira_min;
