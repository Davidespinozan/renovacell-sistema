-- ROLLBACK · migración 126 (guard de la frontera de Chat V2-C1). Restaura el texto de la 125.
-- ADVERTENCIA: reintroduce el defecto (no detecta el cierre real de una sesión de origen 'migracion').
-- Úsese solo para revertir la 126 en sí; no es necesario para bajar la 125 (ese down llama al guard
-- vigente y luego lo elimina).
create or replace function public._cc_chatv2c1_rollback_guard() returns void
  language plpgsql set search_path = public as
$$
begin
  if exists (select 1 from public.cc_conversation_sessions where ordinal > 1 or (estado = 'cerrada' and origen <> 'migracion'))
     and coalesce(current_setting('app.chatv2c1_rollback_forzado', true), '') <> 'on' then
    raise exception 'Chat V2-C1 rollback: ya hay sesiones reales (ordinal > 1 o cerradas). Frontera cruzada: FORWARD-FIX ONLY.';
  end if;
end;
$$;
revoke all on function public._cc_chatv2c1_rollback_guard() from public, anon, authenticated;
