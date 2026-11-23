-- IA · TANDA 1 (23 nov 2026, dueño: «DALE»). Análisis de 34 conversaciones reales con la IA (WhatsApp/web/portal).
-- Esta migración trae la parte de BASE; la parte de la IA vive en _shared/ia (conversacion.ts, orquestador, política,
-- validación) y en meta-webhook. Nada aquí da a la IA identidad por el teléfono (R4-B1): precios y datos siguen igual.
--
--   A) cc_ia_estado_handoff + `cliente_reconocido` y `asesor_nombre`: si el EQUIPO ya ligó la conversación a un cliente
--      (customer_id / profile_id), la IA deja de pedirle nombre, cédula, correo y foto y le dice que su asesor (por nombre)
--      lo atiende con su historial. Solo cambia qué pide y a quién lo pasa; no abre precios, pedidos ni datos.
--   B) cc_ia_turno_reclamar: la IA calla si una persona del equipo escribió en los últimos 10 minutos (no habla encima del
--      vendedor) mientras la conversación siga en manos humanas (no aplica tras «terminar asesoría»: ai_active/human_ended).
--   C) PLAN B (_cc_ia_plan_b, dentro del cron renovacell-atencion-comercial que ya corre cada minuto): tras el traspaso,
--      si en 10 minutos hábiles NO escribió ninguna persona (un vendedor que «se unió» sin escribir cuenta como que no
--      llegó), la IA retoma con UN mensaje útil y corto, y se avisa al vendedor asignado y a Dirección (handoff_escalado).
--      Fuera de horario dice, una vez, cuándo lo atienden. Una vez por traspaso y como mucho una cada 3 horas. Si el
--      vendedor se había unido sin escribir, la conversación regresa a «asignada» (la IA puede seguir atendiendo; el
--      vendedor la retoma con «Iniciar asesoría»).
--   D) Examen de la IA: casos nuevos (categoría «conversacion») sacados de esas conversaciones, anonimizados.

-- ── A) Cliente reconocido y nombre de su asesor ────────────────────────────────────────────────────────────────────────
-- Primer nombre del asesor de la conversación: el asignado si ya hay asesoría; si no, el de la cartera / prospecto / reparto.
create or replace function public._cc_ia_asesor_nombre(p_conv uuid) returns text
  language plpgsql stable security definer set search_path = public as
$$
declare c record; s uuid;
begin
  select * into c from public.cc_conversations where id = p_conv;
  if not found then return null; end if;
  s := coalesce(case when c.modo in ('human_assigned', 'human_active') then c.seller_profile_id end, public._cc_vendedor_conv(p_conv));
  if s is null then return null; end if;
  return public._cc_primer_nombre(public._cc_nombre_personal(s));
end;
$$;
revoke all on function public._cc_ia_asesor_nombre(uuid) from public, anon, authenticated;

do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.cc_ia_estado_handoff(uuid)'::regprocedure);
  if position('''rechazado_carrito'', coalesce(v_rech, false));' in d) = 0 or position('cliente_reconocido' in d) > 0 then
    raise exception 'IA-TANDA1: cambió cc_ia_estado_handoff; revisar antes de aplicar';
  end if;
  d := replace(d, '''rechazado_carrito'', coalesce(v_rech, false));',
    '''rechazado_carrito'', coalesce(v_rech, false),
                            -- IA-TANDA1 · el EQUIPO ya ligó la conversación a un cliente: la IA no le pide datos (no le da identidad)
                            ''cliente_reconocido'', (c.customer_id is not null or c.profile_id is not null),
                            ''asesor_nombre'', public._cc_ia_asesor_nombre(p_conv));');
  execute d;
  if position('''cliente_reconocido''' in pg_get_functiondef('public.cc_ia_estado_handoff(uuid)'::regprocedure)) = 0 then
    raise exception 'IA-TANDA1: cc_ia_estado_handoff no quedó parchada';
  end if;
end $patch$;

-- ── B) La IA no habla encima de una persona del equipo que escribió hace menos de 10 minutos ───────────────────────────
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.cc_ia_turno_reclamar(uuid,bigint,text,text,integer)'::regprocedure);
  if position('v_prev record;' in d) = 0
     or position('  if c.estado <> ''abierta'' or not public._cc_ia_puede(c.modo) or not v_sesion_ok or not v_ia_ok then' in d) = 0
     or (length(d) - length(replace(d, 'when not v_ia_ok then ''ia_apagada'' else ''ia_silenciada'' end', ''))) / length('when not v_ia_ok then ''ia_apagada'' else ''ia_silenciada'' end') <> 2
     or position('v_humano' in d) > 0 then
    raise exception 'IA-TANDA1: cambió cc_ia_turno_reclamar; revisar antes de aplicar';
  end if;
  d := replace(d, 'v_prev record;', 'v_prev record; v_humano boolean;');
  d := replace(d, '  if c.estado <> ''abierta'' or not public._cc_ia_puede(c.modo) or not v_sesion_ok or not v_ia_ok then',
'  -- IA-TANDA1 · una persona del equipo escribió hace menos de 10 min y la conversación sigue en manos humanas: la IA calla
  v_humano := c.modo not in (''ai_active'', ''human_ended'') and exists (select 1 from public.cc_messages h where h.conversation_id = p_conv
                and h.actor_type in (''seller'', ''admin'') and h.created_at > now() - interval ''10 minutes'');
  if c.estado <> ''abierta'' or not public._cc_ia_puede(c.modo) or not v_sesion_ok or not v_ia_ok or v_humano then');
  d := replace(d, 'when not v_ia_ok then ''ia_apagada'' else ''ia_silenciada'' end', 'when not v_ia_ok then ''ia_apagada'' when v_humano then ''humano_reciente'' else ''ia_silenciada'' end');
  execute d;
  d := pg_get_functiondef('public.cc_ia_turno_reclamar(uuid,bigint,text,text,integer)'::regprocedure);
  if position('or not v_ia_ok or v_humano then' in d) = 0 or position('''humano_reciente''' in d) = 0 then
    raise exception 'IA-TANDA1: cc_ia_turno_reclamar no quedó parchada';
  end if;
end $patch$;

-- ── C) PLAN B cuando la persona no llega ───────────────────────────────────────────────────────────────────────────────
-- Texto del plan B: corto (≤ 2–3 líneas), una sola pregunta en horario y ninguna fuera de horario; dice cuándo lo atienden.
create or replace function public._cc_ia_plan_b_texto(p_abierto boolean, p_asesor text, p_proxima timestamptz, p_zona text, p_tiene_piezas boolean)
  returns text language plpgsql stable set search_path = public as
$$
declare v_quien text := coalesce(nullif(btrim(p_asesor), ''), 'nuestro equipo comercial'); v_cuando text; v_dias int;
begin
  if p_abierto then
    return 'Perdón la espera. Ya le avisé a ' || v_quien || ' que sigues aquí. '
        || case when p_tiene_piezas then 'Para adelantar, ¿lo enviamos a tu ciudad o pasas a recoger a sucursal?'
                else 'Para adelantar, ¿qué producto y cuántas piezas necesitas?' end;
  end if;
  if p_proxima is null then v_cuando := 'en cuanto abramos';
  else
    v_dias := (p_proxima at time zone coalesce(p_zona, 'America/Mazatlan'))::date - (now() at time zone coalesce(p_zona, 'America/Mazatlan'))::date;
    v_cuando := case v_dias when 0 then 'hoy' when 1 then 'mañana'
                  else 'el ' || (array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[extract(isodow from p_proxima at time zone coalesce(p_zona, 'America/Mazatlan'))::int] end
                || ' a partir de las ' || to_char(p_proxima at time zone coalesce(p_zona, 'America/Mazatlan'), 'HH24:MI');
  end if;
  return 'Ahorita estamos fuera de horario; ' || v_quien || ' te atiende ' || v_cuando || '. '
      || case when p_tiene_piezas then 'Si me dices a qué ciudad sería, lo dejo anotado para que te lo tengan listo.'
              else 'Si me dejas qué producto, cuántas piezas y a qué ciudad, lo dejo anotado para que te lo tengan listo.' end;
end;
$$;
revoke all on function public._cc_ia_plan_b_texto(boolean, text, timestamptz, text, boolean) from public, anon, authenticated;

-- Recorre las conversaciones traspasadas a una persona que no llegó. Cada conversación en su propio bloque: un error en una
-- nunca tumba el cron de atención (que además reparte y escala).
create or replace function public._cc_ia_plan_b() returns integer
  language plpgsql security definer set search_path = public as
$$
declare hor jsonb; v_abierto boolean; r record; v_h timestamptz; v_ref timestamptz; v_min int; v_key text; v_txt text; v_seq bigint;
        v_asesor text; v_piezas boolean; n int := 0;
begin
  hor := public._cc_horario_estado(now());
  if not coalesce((hor ->> 'configurado')::boolean, false) then return 0; end if;   -- sin horario no se puede decir cuándo
  v_abierto := coalesce((hor ->> 'abierto')::boolean, false);
  for r in
    select c.* from public.cc_conversations c
     where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active')
       and greatest(coalesce(c.asesoria_solicitada_at, '-infinity'::timestamptz), coalesce(c.asesoria_asignada_at, '-infinity'::timestamptz)) between now() - interval '12 hours' and now() - interval '10 minutes'
     order by c.updated_at limit 50
  loop
    begin
      -- el traspaso vigente: la solicitud o la asignación más reciente
      v_h := greatest(coalesce(r.asesoria_solicitada_at, '-infinity'::timestamptz), coalesce(r.asesoria_asignada_at, '-infinity'::timestamptz));
      v_ref := coalesce(r.asesoria_solicitada_at, r.asesoria_asignada_at);
      -- 1) llegó una persona: alguien del equipo escribió desde el traspaso → nada que hacer (nunca encima del vendedor)
      continue when exists (select 1 from public.cc_messages m where m.conversation_id = r.id and m.actor_type in ('seller', 'admin') and m.created_at >= least(v_h, v_ref));
      -- 1b) un vendedor que se acaba de unir tiene sus 10 minutos para escribir
      continue when r.modo = 'human_active' and r.asesoria_iniciada_at > now() - interval '10 minutes';
      -- 2) la IA sigue atendiendo (respondió hace menos de 10 min): no hace falta
      continue when exists (select 1 from public.cc_messages m where m.conversation_id = r.id and m.actor_type = 'ai' and m.created_at > now() - interval '10 minutes');
      -- 3) el cliente está esperando: escribió desde poco antes del traspaso
      continue when not exists (select 1 from public.cc_messages m where m.conversation_id = r.id and m.actor_type in ('visitor', 'doctor') and m.created_at >= v_h - interval '30 minutes');
      -- …y lo último fue suyo, o la IA le prometió a una persona (si la IA cerró el tema y él no volvió, no se le insiste)
      continue when not exists (select 1 from (select m.actor_type, m.content from public.cc_messages m where m.conversation_id = r.id and m.actor_type in ('visitor', 'doctor', 'ai')
                                                order by m.seq desc limit 1) u
                                 where u.actor_type in ('visitor', 'doctor') or u.content ~* '(asesor|asesora|equipo comercial|se unir|te atiende|te atender|persona del equipo|vendedor|vendedora)');
      -- 4) una sola vez por traspaso y como mucho una cada 3 horas por conversación
      v_key := 'tpl:planb:' || r.id::text || ':' || floor(extract(epoch from v_ref))::bigint::text;
      continue when exists (select 1 from public.cc_messages m where m.conversation_id = r.id and m.actor_type = 'ai'
                              and (m.client_message_id = v_key or (m.client_message_id like 'tpl:planb:%' and m.created_at > now() - interval '3 hours')));
      -- 5) la IA debe poder hablar en este canal (WhatsApp con IA encendida y el contacto atendido; Meta según su canal)
      continue when not public._cc_ia_permitida_en(r.id);
      -- 6) en horario: 10 minutos HÁBILES sin persona; fuera de horario: 10 minutos (ya filtrados) y se dice cuándo
      v_min := coalesce(public._cc_minutos_habiles(v_h, now()), 0);
      continue when v_abierto and v_min < 10;

      perform 1 from public.cc_conversations where id = r.id and estado = 'abierta' and modo = r.modo for update skip locked;
      continue when not found;   -- la tomó alguien en este instante
      -- Un vendedor que «se unió» y no escribió no llegó: regresa a asignada para que la IA pueda seguir atendiendo.
      if r.modo = 'human_active' then
        perform public._cc_cambiar_modo(r.id, 'human_assigned', 'human_assigned', 'system', null, null, jsonb_build_object('origen', 'ia_plan_b', 'motivo', 'asesor_sin_escribir'));
      end if;
      v_asesor := case when r.seller_profile_id is not null then public._cc_primer_nombre(public._cc_nombre_personal(r.seller_profile_id)) end;
      -- ¿ya dijo cuántas piezas? (un número corto en lo que escribió; una cédula de 7–8 dígitos no cuenta)
      v_piezas := exists (select 1 from public.cc_messages m where m.conversation_id = r.id and m.actor_type in ('visitor', 'doctor')
                            and m.created_at >= v_h - interval '2 hours' and m.content ~ '(^|[^0-9])[0-9]{1,3}([^0-9]|$)');
      v_txt := public._cc_ia_plan_b_texto(v_abierto, v_asesor, (hor ->> 'proxima_apertura')::timestamptz, hor ->> 'zona', v_piezas);
      update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = r.id returning ultimo_seq into v_seq;
      insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
      values (r.id, v_seq, 'ai', v_key, v_txt, md5(v_txt)) on conflict do nothing;
      -- Alerta interna (en horario): al vendedor asignado y a Dirección. Fuera de horario la escalación normal corre al abrir.
      if v_abierto then
        perform public._cc_notificar('handoff_escalado', r.id, case when r.seller_profile_id is not null then array[r.seller_profile_id] end, array['admin'],
          format('La IA retomó: %s lleva %s min sin respuesta%s', public._cc_nombre_dueno(r.id), v_min,
                 case when r.seller_profile_id is not null then ' de ' || public._cc_nombre_perfil(r.seller_profile_id) || case when r.modo = 'human_active' then ' (se unió y no escribió)' else '' end else '' end),
          'av_atencion', 'planb:' || r.id::text || ':' || floor(extract(epoch from v_ref))::bigint::text);
      end if;
      n := n + 1;
    exception when others then
      raise warning 'IA-TANDA1 plan B: % (conversación %)', sqlerrm, r.id;   -- nunca tumba el cron de atención
    end;
  end loop;
  return n;
exception when others then
  raise warning 'IA-TANDA1 plan B: %', sqlerrm;
  return 0;
end;
$$;
revoke all on function public._cc_ia_plan_b() from public, anon, authenticated;

-- El cron renovacell-atencion-comercial (cada minuto) ya evalúa la atención: el plan B corre al final, sin cron nuevo.
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.cc_atencion_evaluar()'::regprocedure);
  if position('  return jsonb_build_object(''evaluadas'', n, ''avisos'', n_aviso, ''escalaciones'', n_esc, ''repartos'', n_rep, ''agotados'', n_agot, ''en_cola'', n_cola);' in d) = 0
     or position('_cc_ia_plan_b' in d) > 0 then
    raise exception 'IA-TANDA1: cambió cc_atencion_evaluar; revisar antes de aplicar';
  end if;
  d := replace(d, '  return jsonb_build_object(''evaluadas'', n, ''avisos'', n_aviso, ''escalaciones'', n_esc, ''repartos'', n_rep, ''agotados'', n_agot, ''en_cola'', n_cola);',
    '  -- IA-TANDA1 · plan B: la persona no llegó en 10 min hábiles → la IA retoma con un mensaje útil y se avisa (vendedor + Dirección)
  return jsonb_build_object(''evaluadas'', n, ''avisos'', n_aviso, ''escalaciones'', n_esc, ''repartos'', n_rep, ''agotados'', n_agot, ''en_cola'', n_cola, ''plan_b'', public._cc_ia_plan_b());');
  execute d;
  if position('public._cc_ia_plan_b()' in pg_get_functiondef('public.cc_atencion_evaluar()'::regprocedure)) = 0 then
    raise exception 'IA-TANDA1: cc_atencion_evaluar no quedó parchada';
  end if;
end $patch$;

-- ── D) Examen: casos de la Tanda 1 (anonimizados; se miden con el orquestador real del portal) ─────────────────────────
insert into public.cc_ia_examen_casos (id, categoria, historial, pregunta, debe, no_debe, ideal) values
  -- A·C2 seq1-2 / A·C6 seq1-2: dos saludos seguidos → UNA respuesta
  ('CV01', 'conversacion', '[{"actor": "doctor", "content": "Hola"}]'::jsonb, 'Buen día', '["Una sola respuesta breve que saluda una vez y pregunta en qué le ayuda (una sola pregunta)"]'::jsonb, '["Saludar dos veces o contestar cada saludo por separado", "Más de 280 caracteres", "Enumerar lo que puede hacer o mencionar productos"]'::jsonb, '¡Buen día! ¿En qué te puedo ayudar?'),
  -- A·C2 seq4-6: «Tiene linurasse» + «?» + «Tiene linurasse?» → una respuesta
  ('CV02', 'conversacion', '[{"actor": "doctor", "content": "Hola"}, {"actor": "ai", "content": "¡Buen día! ¿En qué te puedo ayudar?"}, {"actor": "doctor", "content": "Tiene linurasse"}, {"actor": "doctor", "content": "?"}]'::jsonb, 'Tiene linurasse?', '["Busca el producto tolerando el error de dedo e identifica Linurase 100 UI si la herramienta lo regresa", "Responde las tres líneas en UN solo mensaje corto con una sola pregunta (p. ej. cuántas piezas)"]'::jsonb, '["Contestar como si fueran preguntas distintas o repetir la misma información", "Volver a saludar", "Más de 280 caracteres"]'::jsonb, 'Sí manejamos Linurase 100 UI. ¿Cuántas piezas necesitas?'),
  -- B·C3 seq31-33: «me envían una toxina» + «Xeomeen» + «100 u» → contesta Xeomeen, no lista todas
  ('CV03', 'conversacion', '[{"actor": "doctor", "content": "Si es posible me pueden enviar una toxina a mi consultorio en cuanto puedan?"}, {"actor": "doctor", "content": "Xeomeen"}]'::jsonb, '100 u', '["Responde sobre Xeomeen 100 UI (lo que aclaró en sus mensajes seguidos)", "Avanza con una sola pregunta (cuántas piezas o dirección de entrega)"]'::jsonb, '["Listar todas las toxinas del catálogo", "Más de 3 opciones de producto", "Más de 280 caracteres"]'::jsonb, 'Va, Xeomeen 100 UI. ¿Cuántas piezas te envío?'),
  -- A·C8 seq5-6: vuelve a escribir «Holaa» a media conversación → no re-saluda
  ('CV04', 'conversacion', '[{"actor": "doctor", "content": "Buena tarde, para corroborar la ubicación donde se entregará el pedido"}, {"actor": "ai", "content": "Nuestra sucursal está en Mía Plaza Perisur, en Culiacán. ¿Te ayudo con algo de tu pedido?"}]'::jsonb, 'Holaa', '["No vuelve a saludar («buena tarde de nuevo»): retoma lo pendiente en una línea"]'::jsonb, '["Saludar de nuevo", "Repetir la dirección y el horario completos", "Más de 280 caracteres"]'::jsonb, 'Aquí sigo. ¿Te confirmo algo de la entrega?'),
  -- B·C6 seq9-11 / B·C1: la promoción ya se dijo → no repetirla
  ('CV05', 'conversacion', '[{"actor": "doctor", "content": "Me podrías enviar las promos del buen fin"}, {"actor": "ai", "content": "Sí, el Mayoreo Especial Buen Fin está vigente; aplica en toxinas como NABOTA. ¿Cuál te interesa?"}, {"actor": "doctor", "content": "Nabota"}]'::jsonb, 'Nabota 10 piezas', '["Avanza la compra con una sola pregunta (presentación de NABOTA o ciudad)"]'::jsonb, '["Volver a explicar la promoción Buen Fin", "Más de 280 caracteres", "Más de una pregunta"]'::jsonb, 'Va, 10 piezas de NABOTA. ¿Las quieres de 100 o de 200 UI?'),
  -- A·C0 seq1-2: pide catálogo y promociones → máx. 3 opciones, corto
  ('CV06', 'conversacion', '[]'::jsonb, 'Hola! Buen día me podría compartir su catálogo y promociones?', '["Responde corto (2–3 líneas) con como mucho 3 líneas o productos relevantes y una pregunta para acotar qué busca"]'::jsonb, '["Listar el catálogo completo o más de 3 categorías/productos", "Más de 280 caracteres", "Más de una pregunta"]'::jsonb, '¡Buen día! Manejamos toxinas, rellenos y bioestimuladores, entre otros. ¿Qué buscas para tu consulta?'),
  -- B·C6 seq13-17: el horario ya se dijo → no repetirlo
  ('CV07', 'conversacion', '[{"actor": "doctor", "content": "Nabota 10 de 100 y 10 de 200"}, {"actor": "ai", "content": "Anotado. Hoy domingo estamos fuera de horario (atendemos de lunes a sábado de 10:00 a 18:00); el lunes te dan el precio."}]'::jsonb, 'Ya me tienen registrada', '["No pide datos a quien dice que ya es clienta; avanza en una línea"]'::jsonb, '["Repetir el horario o que es domingo", "Pedir nombre, cédula, correo o foto", "Más de 280 caracteres"]'::jsonb, 'Perfecto, con tu historial te atienden. ¿Lo enviamos a la misma dirección de siempre?'),
  -- A·C7 seq11: «Ya me tienen registrada ya he pedido» → no pedir datos
  ('CV08', 'conversacion', '[{"actor": "doctor", "content": "Me interesa Linurase"}, {"actor": "ai", "content": "Sí manejamos Linurase 100 UI. ¿Cuántas piezas necesitas?"}]'::jsonb, 'Ya me tienen registrada ya he pedido', '["Reconoce que ya es clienta sin pedir datos y avanza (cuántas piezas o precio si está autorizado)"]'::jsonb, '["Pedir nombre, cédula, correo o foto", "Mandarla a registrarse", "Más de 280 caracteres"]'::jsonb, '¡Qué gusto! Te atiendo con tu historial. ¿Cuántas piezas de Linurase necesitas?'),
  -- B·C10 seq5: da su número de cédula → no responde «Prefiero no afirmar nada de un producto…»
  ('CV09', 'conversacion', '[{"actor": "doctor", "content": "Me podría otorgar el costo de dysport de 500 y nabota de 200?"}, {"actor": "ai", "content": "Sí manejamos Dysport 500 UI y Nabota 200 UI. ¿Cuántas piezas de cada uno?"}]'::jsonb, 'Ya me tiene registrada mi cédula es 11111111', '["Agradece y retoma los productos de la conversación (Dysport 500 UI / Nabota 200 UI) con una sola pregunta"]'::jsonb, '["Decir que no puede afirmar nada de un producto que no consultó", "Pedir de nuevo la cédula", "Más de 280 caracteres"]'::jsonb, 'Gracias. ¿Cuántas piezas de Dysport 500 y de Nabota 200 te preparo?'),
  -- A·C15 seq3-4: «si les hago un pedido ahorita de Nabota ¿llega mañana?» → avanza, no espanta
  ('CV10', 'conversacion', '[]'::jsonb, 'Disculpen si les hago un pedido ahorita de Nabota si llega para el día de mañana?', '["Responde con los datos de entrega del negocio (mismo día en Culiacán / paquetería) y pregunta una sola cosa: ciudad o piezas"]'::jsonb, '["Decir que por este medio no registra pedidos ni carritos", "Inventar una fecha que no sale de los datos del negocio", "Más de 280 caracteres"]'::jsonb, 'Sí te puedo ayudar. ¿A qué ciudad sería? En Culiacán puede ser hoy mismo si confirmas antes del corte.'),
  -- B·C7 seq7-10: «Tnm» + «Porfavor.» → no responder «no puedo darte precios» sin que lo pida
  ('CV11', 'conversacion', '[{"actor": "doctor", "content": "Me gustaría saber el número que tienen en existencia nos interesa. 10 pz"}, {"actor": "ai", "content": "¿Qué producto buscas?"}, {"actor": "doctor", "content": "Tnm"}]'::jsonb, 'Porfavor.', '["Busca la sigla tal cual; si no la encuentra, pregunta qué producto es o lo pasa con un asesor, en un solo mensaje"]'::jsonb, '["Hablar de que no puede dar precios cuando no los pidió", "Dos respuestas distintas a «Tnm» y «Porfavor»", "Más de 280 caracteres"]'::jsonb, 'No me aparece «TNM» así. ¿Me dices el nombre completo del producto?'),
  -- A·C10 seq7: «Lo ocupo para hoy» (domingo, fuera de horario) → honesto y corto
  ('CV12', 'conversacion', '[{"actor": "doctor", "content": "Tienen disponible Botox?"}, {"actor": "ai", "content": "Sí manejamos Botox 100 UI. ¿Cuántas piezas necesitas?"}]'::jsonb, 'Lo ocupo para hoy', '["Dice con honestidad cuándo se puede entregar según el horario y los días de entrega de los datos del negocio, en 2–3 líneas, con una sola pregunta"]'::jsonb, '["Prometer entrega hoy si los datos del negocio no lo permiten", "Más de 280 caracteres", "Repetir la verificación o pedir datos"]'::jsonb, 'Hoy no alcanzamos a entregarlo; lo más pronto es el siguiente día de entrega. ¿Cuántas piezas te aparto?')
on conflict (id) do nothing;
