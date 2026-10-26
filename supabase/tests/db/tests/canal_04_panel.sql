-- R4-B2-4 · lecturas del panel operativo: control de UNA conversación de canal (quién atiende, si puedo tomar o escribir y
-- por qué no) y panel del canal (atención humana pedida/en curso + historial de descartados). Solo Dirección, sin datos de
-- contacto, sin escribir nada; coinciden con lo que la base hace al actuar (toma y exclusividad de B2-3b).
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); a2 uuid; a3 uuid; s1 uuid := tests.user('pos'); d uuid := tests.user('doctor');
        r jsonb; k jsonb; p jsonb; c uuid; c2 uuid; cp uuid; v_ids uuid[]; n_hist bigint; n_ev bigint;
begin
  perform tests.act_as_service();
  a2 := tests.user('admin'); a3 := tests.user('admin');
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}', full_name = 'Lucía Ventas' where id = s1;
  update public.profiles set full_name = 'Dirección Uno' where id = v_admin;
  perform tests.act_as_owner(); update public.cc_wa_config set modo = 'espejo', ia_habilitada = false, envio_pausado = false where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670004101', 'Panel', 'wamid.B24.1', 'Hola', false);
  c := (r ->> 'conversation_id')::uuid;

  -- 1 · permisos: solo Dirección activa
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_canal_conversacion_control(%L)', c), 'NO_AUTORIZADO', '1 · vendedora: no lee el control');
  perform tests.throws($$select public.cc_canal_panel('whatsapp')$$, 'NO_AUTORIZADO', '1 · vendedora: no lee el panel');
  perform tests.act_as(d);
  perform tests.throws($$select public.cc_canal_panel('whatsapp')$$, 'NO_AUTORIZADO', '1 · doctor: no lee el panel');
  perform tests.act_as_anon();
  perform tests.throws($$select public.cc_canal_panel('whatsapp')$$, 'permission denied', '1 · anónimo: sin permiso de ejecución');
  perform tests.act_as(v_admin);
  perform tests.throws($$select public.cc_canal_panel('sms')$$, 'CANAL_INVALIDO', '1 · canal inválido');
  perform tests.throws(format('select public.cc_canal_conversacion_control(%L)', gen_random_uuid()), 'NO_AUTORIZADO', '1 · conversación inexistente: sin pista');

  -- 2 · espejo: nadie atiende, no se toma ni se escribe (motivo canal_en_espejo)
  k := public.cc_canal_conversacion_control(c);
  perform tests.ok(k ->> 'canal' = 'whatsapp' and k ->> 'canal_modo' = 'espejo' and k ->> 'atiende' = 'nadie'
               and not (k ->> 'puede_tomar')::boolean and k ->> 'motivo_no_tomar' = 'canal_en_espejo'
               and not (k ->> 'puede_escribir')::boolean and k ->> 'motivo_no_escribir' = 'canal_en_espejo', '2 · espejo: sin toma ni escritura, con motivo');
  perform tests.ok(not (k::text ~ '5216670004101|wa_id|psid|telefono'), '2 · sin datos de contacto');

  -- 3 · activo con IA: atiende la IA; Dirección puede tomar; escribir exige toma
  perform tests.act_as_owner(); update public.cc_wa_config set modo = 'activo', ia_habilitada = true where id; perform tests.act_as(v_admin);
  k := public.cc_canal_conversacion_control(c);
  perform tests.ok(k ->> 'atiende' = 'ia' and (k ->> 'puede_tomar')::boolean and k ->> 'motivo_no_escribir' = 'toma_requerida', '3 · activo + IA: la IA atiende; tomar sí; escribir exige toma');
  -- coincide con la base al actuar
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', c, 'admin', v_admin, 'b24:1', 'Hola'), 'TOMA_REQUERIDA', '3 · la base también exige la toma');

  -- 4 · tomada por Dirección Uno: ella escribe; otra Dirección ve quién y no puede ni tomar ni escribir
  perform tests.act_as(v_admin);
  perform public.cc_tomar_conversacion(c, 'Atiendo yo');
  k := public.cc_canal_conversacion_control(c);
  perform tests.ok(k ->> 'atiende' = 'direccion' and k ->> 'atiende_nombre' = 'Dirección Uno' and (k ->> 'soy_yo')::boolean and (k ->> 'puede_escribir')::boolean
               and not (k ->> 'puede_tomar')::boolean and k ->> 'motivo_no_tomar' = 'ya_es_tuya' and k ->> 'tomada_at' is not null, '4 · quien tomó: puede escribir, ve su toma');
  perform tests.act_as(a2);
  k := public.cc_canal_conversacion_control(c);
  perform tests.ok(k ->> 'atiende' = 'direccion' and k ->> 'atiende_nombre' = 'Dirección Uno' and not (k ->> 'soy_yo')::boolean
               and k ->> 'motivo_no_tomar' = 'atendida_por_otro' and k ->> 'motivo_no_escribir' = 'atendida_por_otro', '4 · otra Dirección: ve quién atiende; no toma ni escribe');
  perform tests.throws(format('select public.cc_tomar_conversacion(%L)', c), 'ATENDIDA_POR_OTRO', '4 · la base también rechaza la segunda toma');

  -- 5 · asesoría de vendedora: Dirección ve a la vendedora y no interviene
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670004102', 'Panel2', 'wamid.B24.2', 'Quiero un asesor', false);
  c2 := (r ->> 'conversation_id')::uuid;
  perform public.cc_solicitar_asesor(c2, 'visitor', r ->> 'visitor_hash', null);
  perform tests.act_as(v_admin);
  p := public.cc_canal_panel('whatsapp');
  perform tests.ok(exists (select 1 from jsonb_array_elements(p -> 'atencion_humana') x where (x ->> 'conversation_id')::uuid = c2 and x ->> 'modo' in ('human_requested', 'human_assigned') and x ->> 'atiende' is null),
                   '5 · panel: la solicitud pendiente aparece sin persona atendiendo');
  perform tests.act_as_service();
  perform public.cc_asignar_asesor(c2, v_admin, s1);
  perform public.cc_iniciar_asesoria(c2, s1);
  perform tests.act_as(v_admin);
  k := public.cc_canal_conversacion_control(c2);
  perform tests.ok(k ->> 'atiende' = 'vendedor' and k ->> 'atiende_nombre' = 'Lucía Ventas' and k ->> 'motivo_no_tomar' = 'atendida_por_otro', '5 · asesoría en curso: Dirección ve a la vendedora y no toma');
  p := public.cc_canal_panel('whatsapp');
  perform tests.ok(exists (select 1 from jsonb_array_elements(p -> 'atencion_humana') x where (x ->> 'conversation_id')::uuid = c and x ->> 'atiende' = 'direccion' and (x ->> 'soy_yo')::boolean)
               and exists (select 1 from jsonb_array_elements(p -> 'atencion_humana') x where (x ->> 'conversation_id')::uuid = c2 and x ->> 'atiende' = 'vendedor' and x ->> 'atiende_nombre' = 'Lucía Ventas'),
                   '5 · panel: quién atiende cada conversación humana');
  perform tests.ok(not (p::text ~ '521667000410|wa_id|psid|telefono'), '5 · panel sin datos de contacto');
  perform tests.ok(jsonb_array_length(public.cc_canal_panel('instagram') -> 'atencion_humana') = 0, '5 · cada canal ve lo suyo');

  -- 6 · portal: sin control de canal
  perform tests.act_as_service();
  r := public.cc_abrir_conversacion(null, d);
  cp := (r ->> 'conversation_id')::uuid;
  perform tests.act_as(v_admin);
  perform tests.ok(public.cc_canal_conversacion_control(cp) -> 'canal' = 'null'::jsonb, '6 · portal: canal nulo (no aplica)');

  -- 7 · historial de descartados (quién, cuándo, por qué; texto acotado)
  perform tests.act_as_owner(); update public.cc_wa_config set envio_pausado = true where id;
  v_ids := array(select id from public.cc_wa_salida where estado = 'retenido' order by created_at);
  perform tests.act_as(v_admin);
  perform tests.ok(cardinality(v_ids) >= 1, '7 · hay retenidos con la pausa');
  r := public.cc_salida_decidir('whatsapp', v_ids[1:1], 'descartar', 'Aviso obsoleto en prueba');
  p := public.cc_canal_panel('whatsapp');
  perform tests.ok(jsonb_array_length(p -> 'descartados') = 1 and p -> 'descartados' -> 0 ->> 'decidido_por' = 'Dirección Uno'
               and p -> 'descartados' -> 0 ->> 'motivo' = 'Aviso obsoleto en prueba' and length(p -> 'descartados' -> 0 ->> 'texto') <= 120, '7 · descartado en el historial con responsable y motivo');

  -- 8 · solo lectura: no cambia controles, toma ni eventos
  perform tests.act_as_owner();
  select count(*) into n_hist from public.cc_canal_control_hist; select count(*) into n_ev from public.cc_conversation_events;
  perform tests.act_as(v_admin);
  perform public.cc_canal_panel('whatsapp'); perform public.cc_canal_conversacion_control(c); perform public.cc_canal_conversacion_control(c2);
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.cc_canal_control_hist) = n_hist and (select count(*) from public.cc_conversation_events) = n_ev, '8 · leer no escribe');

  -- 9 · Dirección suspendida: ya no lee
  perform tests.act_as_service();
  update public.profiles set active = false where id = a3;
  perform tests.act_as(a3);
  perform tests.throws_any($$select public.cc_canal_panel('whatsapp')$$, array['CUENTA_SUSPENDIDA', 'NO_AUTORIZADO'], '9 · admin suspendido: no lee el panel');
  perform tests.throws_any(format('select public.cc_canal_conversacion_control(%L)', c), array['CUENTA_SUSPENDIDA', 'NO_AUTORIZADO'], '9 · admin suspendido: no lee el control');
  perform tests.throws_any(format('select public.cc_tomar_conversacion(%L)', c2), array['CUENTA_SUSPENDIDA', 'NO_AUTORIZADO'], '9 · admin suspendido: no toma');
  perform tests.throws_any($$select public.cc_salida_revision('whatsapp')$$, array['CUENTA_SUSPENDIDA', 'NO_AUTORIZADO'], '9 · admin suspendido: no revisa salidas');

  -- 10 · la compuerta sigue cerrada
  perform tests.act_as_owner();
  perform tests.ok(not public._cc_canal_activacion_lista(), '10 · compuerta cerrada');
end $t$;
rollback;
