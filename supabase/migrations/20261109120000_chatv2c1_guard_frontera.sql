-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- Chat V2-C1 · FORWARD-FIX del guard de la frontera de rollback (migración 126). SOLO reemplaza
-- public._cc_chatv2c1_rollback_guard(); no toca tablas, filas, mensajes, eventos ni funciones de C1.
--
-- Causa raíz (125): la frontera se consideraba cruzada solo con ordinal > 1 o con una sesión cerrada de
-- origen distinto de 'migracion'. El primer cierre REAL de producción fue sobre una sesión respaldada
-- (origen 'migracion') → el guard seguía diciendo "no cruzada" y el down habría corrido sin override,
-- borrando la historia de sesiones.
--
-- Regla nueva (fail-closed). FRONTERA CRUZADA si existe CUALQUIERA de:
--   1. un evento session_closed (único escritor: _cc_sesion_cerrar; el respaldo no escribe eventos);
--   2. una sesión con ordinal > 1 (el respaldo solo crea la 1; p. ej. una conversación cerrada antes de
--      la 125 que se reabre y recibe un mensaje abre la 2 sin ningún session_closed);
--   3. una sesión cerrada que NO tenga la firma exacta del respaldo (origen 'migracion' + motivo
--      'conversacion_cerrada' + cerrada por 'system'): cualquier estado que no se pueda demostrar como
--      respaldo puro bloquea el down.
-- Override: el mismo de la 125, sin debilitarlo (app.chatv2c1_rollback_forzado = 'on' exacto).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
begin
  if to_regprocedure('public._cc_chatv2c1_rollback_guard()') is null or to_regclass('public.cc_conversation_sessions') is null then
    raise exception 'Chat V2-C1 guard: requiere la migración 125';
  end if;
end $pre$;

create or replace function public._cc_chatv2c1_rollback_guard() returns void
  language plpgsql set search_path = public as
$$
begin
  if (exists (select 1 from public.cc_conversation_events where tipo = 'session_closed')
      or exists (select 1 from public.cc_conversation_sessions where ordinal > 1)
      or exists (select 1 from public.cc_conversation_sessions
                  where estado = 'cerrada'
                    and not (origen = 'migracion' and close_reason = 'conversacion_cerrada' and closed_by_actor_type = 'system')))
     and coalesce(current_setting('app.chatv2c1_rollback_forzado', true), '') <> 'on' then
    raise exception 'Chat V2-C1 rollback: la historia de sesiones ya es real (session_closed, ordinal > 1 o cierre fuera del respaldo). Frontera cruzada: FORWARD-FIX ONLY.';
  end if;
end;
$$;
revoke all on function public._cc_chatv2c1_rollback_guard() from public, anon, authenticated;
