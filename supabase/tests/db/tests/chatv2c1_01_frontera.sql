-- Chat V2-C1 · 126 · Frontera de rollback (T1..T7). Cada escenario corre en una subtransacción que se
-- deshace (centinela), partiendo de un estado de sesiones limpio dentro de esta transacción de prueba.
begin;
do $t$
declare
  dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); dC uuid := tests.user('doctor'); dD uuid := tests.user('doctor');
  sD uuid := tests.user('pos'); pA uuid; cA uuid; cB uuid; cC uuid; cD uuid; kD uuid; r jsonb; semana jsonb;
  guard_ok boolean;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = sD;
  perform tests.cliente(dD);
  pA := tests.producto_cat('Rellenos', 1000); perform tests.stock(pA, 'FR-A', 100);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dD, sD);
  perform tests.act_as(tests.fixture_admin());
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar('America/Mazatlan', semana);

  -- Estado limpio de sesiones (solo dentro de esta transacción de prueba; se revierte al final).
  perform tests.act_as_owner();
  alter table public.cc_conversation_events disable trigger trg_ccce_append_only;
  delete from public.cc_conversation_events where session_id is not null or tipo in ('session_opened', 'session_closed');
  alter table public.cc_conversation_events enable trigger trg_ccce_append_only;
  delete from public.cc_conversation_sessions;

  -- Conversaciones "pre-125": mensajes sin trigger de sesión.
  alter table public.cc_messages disable trigger trg_ccm_sesion;
  perform tests.act_as_service();
  cA := (public.cc_abrir_conversacion(null, dA) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cA, 'doctor', null, dA, 'fa-1', 'Hola');
  cB := (public.cc_abrir_conversacion(null, dB) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cB, 'doctor', null, dB, 'fb-1', 'Hola');
  perform public.cc_cerrar_conversacion(cB, 'doctor', null, dB);          -- cerrada antes de la 125: sin sesión, sin evento
  kD := (public.cc_carrito_abrir('doctor', null, dD) ->> 'cart_id')::uuid;   -- caso como David: handoff + asesoría activa
  r := public.cc_carrito_agregar(kD, 'doctor', null, dD, pA, 1, 'fd-1');
  cD := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform public.cc_iniciar_asesoria(cD, sD);
  perform public.cc_enviar_mensaje(cD, 'seller', null, sD, 'fd-2', 'Hola doctor');
  perform tests.act_as_owner();
  alter table public.cc_messages enable trigger trg_ccm_sesion;
  perform public._cc_sesiones_respaldo();
  perform tests.ok((select count(*) = 0 from public.cc_conversation_events where tipo = 'session_closed'), 'premisa · el respaldo no escribe session_closed');
  perform tests.ok((select bool_and(ordinal = 1 and origen = 'migracion') from public.cc_conversation_sessions), 'premisa · el respaldo solo crea ordinal 1 (migracion)');
  perform tests.ok((select estado = 'cerrada' and close_reason = 'conversacion_cerrada' and closed_by_actor_type = 'system' from public.cc_conversation_sessions where conversation_id = cB), 'premisa · firma del respaldo de una conversación ya cerrada');

  -- ══ T1 · respaldo puro (abiertas + cerrada pre-125, sin session_closed) → NO cruzada ══
  perform tests.lives('select public._cc_chatv2c1_rollback_guard()', 'T1 · respaldo puro → NOT CROSSED');

  -- ══ T4 · sesión ordinal 1 abierta por uso real (trigger), sin session_closed → NO cruzada ══
  perform tests.act_as_service();
  cC := (public.cc_abrir_conversacion(null, dC) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cC, 'doctor', null, dC, 'fc-1', 'Hola');
  perform tests.act_as_owner();
  perform tests.ok((select ordinal = 1 and estado = 'abierta' and origen = 'cliente' from public.cc_conversation_sessions where conversation_id = cC), 'T4 · premisa: sesión 1 abierta por el trigger');
  perform tests.lives('select public._cc_chatv2c1_rollback_guard()', 'T4 · ordinal 1 abierta sin cierre → NOT CROSSED');

  -- ══ T2 · sesión migrada cerrada de verdad (cerrar conversación) → cruzada ══
  begin
    perform tests.act_as_service(); perform public.cc_cerrar_conversacion(cA, 'doctor', null, dA); perform tests.act_as_owner();
    perform tests.ok((select estado = 'cerrada' and origen = 'migracion' and ordinal = 1 from public.cc_conversation_sessions where conversation_id = cA), 'T2 · premisa: sesión migracion cerrada');
    perform tests.throws('select public._cc_chatv2c1_rollback_guard()', 'FORWARD-FIX ONLY', 'T2 · migracion cerrada con session_closed → CROSSED');
    raise exception 'escenario_fin';
  exception when others then if sqlerrm <> 'escenario_fin' then raise; end if;
  end;

  -- ══ T7 · estado real de David: sesión migrada, asesoría activa, Terminar asesoría ══
  begin
    perform tests.act_as_service(); r := public.cc_terminar_asesoria(cD, sD); perform tests.act_as_owner();
    perform tests.ok((select estado = 'cerrada' and origen = 'migracion' and ordinal = 1 and first_seq = 1 and last_seq = (select ultimo_seq from public.cc_conversations where id = cD) and close_reason = 'asesor_finalizo'
                        from public.cc_conversation_sessions where conversation_id = cD), 'T7 · premisa: igual que David (migracion, 1, cerrada por la asesora, last_seq = último)');
    -- causa raíz: la regla de la 125 NO lo detectaba
    perform tests.ok(not exists (select 1 from public.cc_conversation_sessions where ordinal > 1 or (estado = 'cerrada' and origen <> 'migracion')), 'T7 · causa raíz: la regla de la 125 lo veía como NO cruzada');
    perform tests.throws('select public._cc_chatv2c1_rollback_guard()', 'FORWARD-FIX ONLY', 'T7 · con la 126 → CROSSED');
    -- T6 · override: solo el valor exacto existente lo permite
    perform set_config('app.chatv2c1_rollback_forzado', 'ON', true);
    perform tests.throws('select public._cc_chatv2c1_rollback_guard()', 'FORWARD-FIX ONLY', 'T6 · "ON" no es el override');
    perform set_config('app.chatv2c1_rollback_forzado', 'true', true);
    perform tests.throws('select public._cc_chatv2c1_rollback_guard()', 'FORWARD-FIX ONLY', 'T6 · "true" no es el override');
    perform set_config('app.chatv2c1_rollback_forzado', 'on', true);
    perform tests.lives('select public._cc_chatv2c1_rollback_guard()', 'T6 · el override explícito existente ("on") sigue funcionando igual');
    perform set_config('app.chatv2c1_rollback_forzado', '', true);
    raise exception 'escenario_fin';
  exception when others then if sqlerrm <> 'escenario_fin' then raise; end if;
  end;

  -- ══ T3 · nueva sesión (ordinal 2) SIN ningún session_closed: conversación cerrada antes de la 125 que vuelve ══
  begin
    perform tests.act_as_service();
    perform public.cc_abrir_conversacion(null, dB);                         -- reabre el canal permanente (cB)
    perform public.cc_enviar_mensaje(cB, 'doctor', null, dB, 'fb-2', 'Vuelvo');
    perform tests.act_as_owner();
    perform tests.ok((select count(*) = 0 from public.cc_conversation_events where tipo = 'session_closed') and exists (select 1 from public.cc_conversation_sessions where conversation_id = cB and ordinal = 2 and estado = 'abierta'), 'T3 · premisa: ordinal 2 abierta y cero session_closed');
    perform tests.throws('select public._cc_chatv2c1_rollback_guard()', 'FORWARD-FIX ONLY', 'T3 · ordinal > 1 → CROSSED aunque no haya cierres');
    raise exception 'escenario_fin';
  exception when others then if sqlerrm <> 'escenario_fin' then raise; end if;
  end;

  -- ══ T5 · estados ambiguos / inconsistentes → fail-closed ══
  begin
    update public.cc_conversation_sessions set close_reason = 'asesor_finalizo' where conversation_id = cB;   -- cierre sin evento y fuera de la firma del respaldo
    perform tests.throws('select public._cc_chatv2c1_rollback_guard()', 'FORWARD-FIX ONLY', 'T5 · cierre migracion fuera de la firma del respaldo (sin evento) → bloquea');
    raise exception 'escenario_fin';
  exception when others then if sqlerrm <> 'escenario_fin' then raise; end if;
  end;
  begin
    update public.cc_conversation_sessions set closed_by_actor_type = 'doctor' where conversation_id = cB;
    perform tests.throws('select public._cc_chatv2c1_rollback_guard()', 'FORWARD-FIX ONLY', 'T5 · cerrada por un actor distinto de system sin evento → bloquea');
    raise exception 'escenario_fin';
  exception when others then if sqlerrm <> 'escenario_fin' then raise; end if;
  end;
  begin
    update public.cc_conversation_sessions set origen = 'cliente' where conversation_id = cB;
    perform tests.throws('select public._cc_chatv2c1_rollback_guard()', 'FORWARD-FIX ONLY', 'T5 · sesión no-migracion cerrada sin evento → bloquea');
    raise exception 'escenario_fin';
  exception when others then if sqlerrm <> 'escenario_fin' then raise; end if;
  end;

  -- tras deshacer cada escenario, vuelve a ser respaldo puro + la sesión de uso real abierta (T1/T4)
  perform tests.lives('select public._cc_chatv2c1_rollback_guard()', 'cada escenario se deshizo: el estado limpio sigue NOT CROSSED');
end $t$;
rollback;
