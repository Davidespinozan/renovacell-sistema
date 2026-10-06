-- ============================================================================
-- CC-4 · ROLLBACK. Retira el libro de turnos, la traza y las herramientas de IA. No toca CC-2
-- ni CC-3 (CC-4 solo AÑADE). Los turnos locales se pierden (CC-4 nunca llegó a producción).
-- Ejecutar en UNA transacción.
-- ============================================================================
drop function if exists public.cc_ia_estado_pedido(uuid, text);
drop function if exists public.cc_ia_disponibilidad(uuid, uuid);
drop function if exists public.cc_ia_precio(uuid, uuid, int);
drop function if exists public._cc_ia_producto_vendible(uuid, text);
drop function if exists public.cc_ia_contexto_actor(uuid);
drop function if exists public.cc_ia_aviso_no_disponible(uuid);
drop function if exists public.cc_ia_turno_fallar(uuid, text, boolean, text, int, int, int);
drop function if exists public.cc_ia_turno_responder(uuid, text, text, text[], int, int, int);
drop function if exists public.cc_ia_herramienta_registrar(uuid, int, text, text, uuid[], jsonb);
drop function if exists public.cc_ia_turno_reclamar(uuid, bigint, text, text, int);
drop function if exists public._cc_solo_servicio();
drop function if exists public._cc_ia_puede(text);
drop table if exists public.cc_ai_tool_calls;
drop table if exists public.cc_ai_turns;
