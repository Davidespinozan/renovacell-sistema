-- BANDEJA-2 · bandeja única de Dirección: todas las conversaciones abiertas de cualquier origen, clasificadas (por atender /
-- en atención / IA), ordenadas por urgencia, con origen y contacto; solo Dirección; reversión limpia.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); r jsonb; c_pide uuid; c_ia uuid; c_activa uuid; c_sin uuid; g jsonb;
begin
  perform tests.act_as_service();
  c_pide := (public.cc_wa_entrante('5216670008001', 'Pide Asesor', 'wamid.BU.1', 'quiero hablar con alguien', false) ->> 'conversation_id')::uuid;
  c_ia := (public.cc_wa_entrante('5216670008002', 'Solo IA', 'wamid.BU.2', 'hola', false) ->> 'conversation_id')::uuid;
  c_activa := (public.cc_wa_entrante('5216670008003', 'En Curso', 'wamid.BU.3', 'ya me atienden', false) ->> 'conversation_id')::uuid;
  c_sin := (public.cc_wa_entrante('5216670008004', 'Sin Respuesta', 'wamid.BU.4', 'La wegovy', false) ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  update public.cc_conversations set modo = 'human_requested', asesoria_solicitada_at = now() - interval '10 minutes' where id = c_pide;
  update public.cc_conversations set modo = 'human_active' where id = c_activa;
  alter table public.cc_messages disable trigger trg_ccm_append_only;   -- solo en esta prueba (se revierte): simular 20 min sin respuesta
  update public.cc_messages set created_at = now() - interval '20 minutes' where conversation_id = c_sin;
  alter table public.cc_messages enable trigger trg_ccm_append_only;
  perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c_ia, 'ai', null, null, 'ai:bu', '¡Hola! ¿En qué te ayudo?');
  perform tests.act_as_owner();

  perform tests.act_as(s1);
  perform tests.throws($$select public.cc_bandeja_unificada()$$, 'NO_AUTORIZADO', '0 · solo Dirección');

  perform tests.act_as(v_admin);
  r := public.cc_bandeja_unificada();
  g := (select jsonb_object_agg(x ->> 'conversation_id', x ->> 'grupo') from jsonb_array_elements(r -> 'conversaciones') x);
  perform tests.eq(g ->> c_pide::text, 'por_atender', '1 · pide asesor → por atender');
  perform tests.eq(g ->> c_sin::text, 'por_atender', '1 · cliente sin respuesta hace 20 min → por atender');
  perform tests.eq(g ->> c_activa::text, 'en_atencion', '1 · atendida por una persona → en atención');
  perform tests.eq(g ->> c_ia::text, 'ia', '1 · la IA contestó → IA');
  perform tests.ok((r -> 'resumen' ->> 'por_atender')::int >= 2 and (r -> 'resumen' ->> 'en_atencion')::int >= 1 and (r -> 'resumen' ->> 'ia')::int >= 1, '2 · resumen por grupo');
  perform tests.ok((select bool_and(x ->> 'grupo' = 'por_atender') from (select x from jsonb_array_elements(r -> 'conversaciones') with ordinality t(x, n) order by n limit 2) y), '3 · por atender va primero');
  perform tests.ok((select x -> 'contacto' ->> 'fuente' from jsonb_array_elements(r -> 'conversaciones') x where x ->> 'conversation_id' = c_sin::text) = 'whatsapp'
                and (select x -> 'contacto' ->> 'nombre' from jsonb_array_elements(r -> 'conversaciones') x where x ->> 'conversation_id' = c_sin::text) = 'Sin Respuesta', '4 · origen y nombre');
  perform tests.ok((select (x ->> 'sin_responder')::boolean from jsonb_array_elements(r -> 'conversaciones') x where x ->> 'conversation_id' = c_sin::text), '4 · marca sin responder');
  perform tests.ok(jsonb_array_length(public.cc_bandeja_unificada(1) -> 'conversaciones') = 1, '5 · respeta el límite');
  perform tests.act_as_owner();
end $t$;
\ir ../../../rollback/bandeja_unificada/99_down.sql
do $t$ begin perform tests.ok(to_regprocedure('public.cc_bandeja_unificada(integer)') is null, '6 · reversión'); end $t$;
\ir ../../../migrations/20270126120000_bandeja_unificada.sql
do $t$ begin perform tests.ok(to_regprocedure('public.cc_bandeja_unificada(integer)') is not null, '6 · se reaplica'); end $t$;
rollback;
