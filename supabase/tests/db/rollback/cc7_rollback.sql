-- CC-7 · El rollback retira horario/cartera/handoff y devuelve EXACTAMENTE el comportamiento CC-2/5/6 previo.
begin;
set app.chatv2c1_rollback_forzado = 'on';   -- prueba estructural de la cadena completa (la frontera se prueba en chatv2c1_rollback.sql)
\ir ../../../rollback/chatv2c1/99_down.sql   -- Chat V2-C1 (125) se baja primero
\ir ../../../rollback/chv2a_cron/99_down.sql   -- CHV2-A cron fix (124) se baja primero
\ir ../../../rollback/chv2a/99_down.sql   -- CHV2-A (123) se baja primero
\ir ../../../rollback/c360_f3/99_down.sql   -- C360-F3 (121) se baja primero
\ir ../../../rollback/c360_0/99_down.sql   -- C360-0 (120) se baja primero
\ir ../../../rollback/cc7/99_down.sql
do $t$
begin
  perform tests.ok(to_regclass('public.cc_cartera') is null and to_regclass('public.cc_cartera_historial') is null and to_regclass('public.cc_horario_config') is null
               and to_regclass('public.cc_horario_semanal') is null and to_regclass('public.cc_horario_excepciones') is null and to_regclass('public.cc_horario_eventos') is null, 'tablas CC-7 retiradas');
  perform tests.ok(to_regprocedure('public._cc_handoff_carrito(uuid)') is null and to_regprocedure('public.cc_cartera_asignar(uuid,uuid,text)') is null
               and to_regprocedure('public.cc_horario_guardar(text,jsonb)') is null and to_regprocedure('public.cc_handoff_rechazar(uuid,text,text,uuid)') is null, 'funciones CC-7 retiradas');
  perform tests.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('cc_carts', 'cc_conversations')
                                and column_name in ('handoff_estado', 'handoff_at', 'handoff_conversation_id', 'handoff_error', 'handoff_origen', 'handoff_cart_id', 'handoff_fuera_horario', 'ruteo_motivo')), 'columnas CC-7 retiradas');
  perform tests.ok(to_regprocedure('public.cc_checkout_revisar(uuid,uuid)') is not null and to_regprocedure('public.cc_checkout_revisar(uuid,uuid,jsonb)') is null
               and to_regprocedure('public.cc_checkout_confirmar(uuid,text,integer)') is not null and to_regprocedure('public.cc_checkout_confirmar(uuid,text,integer,boolean)') is null, 'firmas CC-6 restauradas');
  perform tests.ok(has_function_privilege('authenticated', 'public.cc_checkout_confirmar(uuid,text,integer)', 'EXECUTE') and not has_function_privilege('anon', 'public.cc_checkout_confirmar(uuid,text,integer)', 'EXECUTE'), 'privilegios CC-6 restaurados');
  perform tests.ok(not public._cc_ia_puede('human_assigned') and public._cc_ia_puede('human_requested'), 'regla de IA CC-4 restaurada');
  perform tests.ok(pg_get_functiondef('public._cc_cart_mutar(uuid,text,text,uuid,text,uuid,integer,text)'::regprocedure) not like '%handoff%', 'carrito sin handoff');
  perform tests.ok(pg_get_functiondef('public.cc_asignar_asesor(uuid,uuid,uuid)'::regprocedure) like '%autoasignación desde la cola%', 'asignación CC-2 restaurada');
  perform tests.ok(pg_get_function_result('public.cc_cola_asesorias()'::regprocedure) not like '%handoff_origen%', 'cola CC-2 restaurada');
  perform tests.ok(pg_get_functiondef('public._cc_chk_seller(uuid)'::regprocedure) like '%dueno_cartera%', 'atribución CC-6 restaurada');
end $t$;
rollback;
