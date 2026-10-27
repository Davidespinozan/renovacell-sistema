-- R4-B2-1 · controles por canal: valores iniciales, CHECK (IA solo en activo), espejo apaga la IA (también por SQL directo),
-- RPC solo para Dirección, validación estricta, motivo obligatorio, historial (rpc y directo), compuerta de activación
-- cerrada, independencia por canal y sin acceso directo al historial.
begin;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql   -- R4-C6: contrato con la compuerta CERRADA (abierta: canal_06)
do $t$
declare v_admin uuid := tests.fixture_admin(); v_admin2 uuid; s1 uuid := tests.user('pos'); d uuid := tests.user('doctor'); r jsonb; e jsonb; n0 bigint; n bigint;
begin
  -- 0 · valores iniciales y compuerta
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'espejo' and not ia_habilitada and not envio_pausado from public.cc_wa_config), '0 · WhatsApp: espejo, IA apagada, envíos sin pausa');
  perform tests.ok((select count(*) = 2 and bool_and(modo = 'espejo' and not ia_habilitada and not envio_pausado) from public.cc_meta_config where canal in ('instagram', 'messenger')), '0 · Instagram y Messenger: igual');
  perform tests.ok(not public._cc_canal_activacion_lista(), '0 · compuerta de activación cerrada');
  n0 := (select count(*) from public.cc_canal_control_hist);

  -- 1 · la IA no puede quedar encendida en espejo: el trigger la normaliza (sin cambio efectivo, sin historial) y el CHECK
  --     es la última defensa si el trigger faltara
  update public.cc_wa_config set ia_habilitada = true where id;
  update public.cc_meta_config set ia_habilitada = true where canal = 'instagram';
  perform tests.ok((select not ia_habilitada from public.cc_wa_config) and (select not ia_habilitada from public.cc_meta_config where canal = 'instagram'), '1 · IA en espejo por SQL directo: queda apagada');
  perform tests.eq((select count(*) from public.cc_canal_control_hist), n0, '1 · sin cambio efectivo, sin historial');
  alter table public.cc_wa_config disable trigger trg_cc_wa_config_normalizar;
  alter table public.cc_meta_config disable trigger trg_cc_meta_config_normalizar;
  perform tests.throws($$update public.cc_wa_config set ia_habilitada = true where id$$, 'ck_wa_ia_requiere_activo', '1 · sin el trigger, el CHECK de WhatsApp lo rechaza');
  perform tests.throws($$update public.cc_meta_config set ia_habilitada = true where canal = 'instagram'$$, 'ck_meta_ia_requiere_activo', '1 · sin el trigger, el CHECK de Instagram lo rechaza');
  alter table public.cc_wa_config enable trigger trg_cc_wa_config_normalizar;
  alter table public.cc_meta_config enable trigger trg_cc_meta_config_normalizar;

  -- 2 · SQL directo (emergencia): activo+IA y luego espejo → la IA se apaga en la MISMA sentencia; queda en el historial como 'directo'
  alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = true where id;
  update public.cc_wa_config set modo = 'espejo' where id;
  perform tests.ok((select modo = 'espejo' and not ia_habilitada from public.cc_wa_config), '2 · pasar a espejo apaga la IA atómicamente');
  perform tests.eq((select count(*) from public.cc_canal_control_hist where origen = 'directo' and canal = 'whatsapp' and actor_profile_id is null), 2::bigint, '2 · los dos cambios directos quedaron en el historial');
  perform tests.ok((select despues = '{"modo":"espejo","ia_habilitada":false,"envio_pausado":false}'::jsonb and antes ->> 'ia_habilitada' = 'true' from public.cc_canal_control_hist where canal = 'whatsapp' order by id desc limit 1), '2 · el historial guarda antes/después');
  update public.cc_wa_config set modo = 'espejo' where id;   -- sin cambio efectivo: no se registra
  perform tests.eq((select count(*) from public.cc_canal_control_hist), n0 + 2, '2 · un update sin cambio no ensucia el historial');

  -- 3 · permisos
  perform tests.act_as_anon();
  perform tests.throws($$select public.cc_canal_estado()$$, 'permission denied', '3 · anónimo no lee el estado');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', 'prueba anónima')$$, 'permission denied', '3 · anónimo no cambia');
  perform tests.act_as(d);
  perform tests.throws($$select public.cc_canal_estado()$$, 'NO_AUTORIZADO', '3 · doctor no lee el estado');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', 'prueba de doctor')$$, 'NO_AUTORIZADO', '3 · doctor no cambia');
  perform tests.act_as(s1);
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', 'prueba de vendedora')$$, 'NO_AUTORIZADO', '3 · vendedora no cambia');
  perform tests.act_as_service();
  perform tests.ok((public.cc_canal_estado() ->> 'activacion_disponible') = 'false', '3 · el servidor sí lee el estado');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', 'prueba de servicio')$$, 'NO_AUTORIZADO', '3 · el servidor NO cambia por la RPC (no hay responsable)');
  perform tests.act_as(s1);
  perform tests.throws($$select count(*) from public.cc_canal_control_hist$$, 'permission denied', '3 · el historial no se lee directo');
  perform tests.act_as(v_admin);
  perform tests.throws($$select count(*) from public.cc_canal_control_hist$$, 'permission denied', '3 · ni Dirección lo lee directo (solo por la RPC)');
  perform tests.throws($$insert into public.cc_canal_control_hist (canal, antes, despues, origen) values ('whatsapp', '{}', '{}', 'directo')$$, 'permission denied', '3 · nadie inserta en el historial');
  perform tests.throws($$update public.cc_wa_config set envio_pausado = true where id$$, 'permission denied', '3 · Dirección no escribe la configuración directo');

  -- 4 · validación estricta
  perform tests.throws($$select public.cc_canal_cambiar('sms', '{"envio_pausado":true}', 'canal raro')$$, 'CANAL_INVALIDO', '4 · canal desconocido');
  perform tests.throws($$select public.cc_canal_cambiar(null, '{"envio_pausado":true}', 'sin canal')$$, 'CANAL_INVALIDO', '4 · canal nulo');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{}', 'vacío')$$, 'CAMBIO_INVALIDO', '4 · cambios vacíos');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '[1]', 'arreglo')$$, 'CAMBIO_INVALIDO', '4 · cambios que no son objeto');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"modo":"espejo","token":"x"}', 'propiedad extra')$$, 'CAMBIO_INVALIDO', '4 · propiedad no permitida');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"modo":"encendido"}', 'modo raro')$$, 'CAMBIO_INVALIDO', '4 · modo inválido');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"envio_pausado":"true"}', 'texto en vez de booleano')$$, 'CAMBIO_INVALIDO', '4 · tipo inválido');

  -- 5 · motivo obligatorio para cambios efectivos; sin cambio no lo exige
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', null)$$, 'MOTIVO_REQUERIDO', '5 · sin motivo');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', '   ok ')$$, 'MOTIVO_REQUERIDO', '5 · motivo demasiado corto');
  perform tests.throws(format('select public.cc_canal_cambiar(%L, %L, %L)', 'whatsapp', '{"envio_pausado":true}', repeat('x', 501)), 'MOTIVO_LARGO', '5 · motivo demasiado largo');
  r := public.cc_canal_cambiar('whatsapp', '{"envio_pausado":false}', null);
  perform tests.ok(not (r ->> 'cambiado')::boolean, '5 · sin cambio efectivo: no exige motivo ni registra');

  -- 6 · compuerta: no se activa el canal ni se enciende la IA mientras R4-B2 no esté completo
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"modo":"activo"}', 'Activar WhatsApp')$$, 'ACTIVACION_BLOQUEADA', '6 · activar WhatsApp: bloqueado');
  perform tests.throws($$select public.cc_canal_cambiar('instagram', '{"modo":"activo","ia_habilitada":true}', 'Activar Instagram con IA')$$, 'ACTIVACION_BLOQUEADA', '6 · activar Instagram con IA: bloqueado');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"ia_habilitada":true}', 'IA en espejo')$$, 'IA_REQUIERE_ACTIVO', '6 · IA en espejo: rechazada antes de la compuerta');
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'espejo' and not ia_habilitada from public.cc_wa_config), '6 · nada cambió tras los rechazos');
  -- canal ya activo por SQL directo: la RPC tampoco enciende la IA
  perform tests.act_as_owner(); update public.cc_meta_config set modo = 'activo' where canal = 'messenger'; perform tests.act_as(v_admin);
  perform tests.throws($$select public.cc_canal_cambiar('messenger', '{"ia_habilitada":true}', 'Encender IA en Messenger')$$, 'ACTIVACION_BLOQUEADA', '6 · encender la IA con el canal activo: bloqueado');

  -- 7 · cambios seguros permitidos y auditados (pausar, reanudar, volver a espejo)
  r := public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', 'Pausa de prueba R4-B2-1');
  perform tests.ok((r ->> 'cambiado')::boolean and (r -> 'despues' ->> 'envio_pausado') = 'true', '7 · pausar envíos de WhatsApp');
  perform tests.act_as_owner();
  perform tests.ok((select envio_pausado from public.cc_wa_config) and (select not envio_pausado from public.cc_meta_config where canal = 'instagram'), '7 · independiente por canal: Instagram no cambió');
  perform tests.ok((select origen = 'rpc' and actor_profile_id = v_admin and motivo = 'Pausa de prueba R4-B2-1' and canal = 'whatsapp' from public.cc_canal_control_hist order by id desc limit 1), '7 · historial con responsable y motivo');
  perform tests.act_as(v_admin);
  r := public.cc_canal_cambiar('whatsapp', '{"envio_pausado":false}', 'Reanudar tras prueba');
  perform tests.act_as_owner();
  perform tests.ok((r ->> 'cambiado')::boolean and not (select envio_pausado from public.cc_wa_config), '7 · reanudar envíos');
  perform tests.act_as(v_admin);
  r := public.cc_canal_cambiar('messenger', '{"modo":"espejo"}', 'Regresar Messenger a espejo');
  perform tests.act_as_owner();
  perform tests.ok((r ->> 'cambiado')::boolean and (select modo = 'espejo' and not ia_habilitada from public.cc_meta_config where canal = 'messenger'), '7 · volver a espejo siempre permitido');
  perform tests.act_as(v_admin);
  r := public.cc_canal_cambiar('instagram', '{"envio_pausado":true}', 'Pausa Instagram');
  perform tests.act_as_owner();
  perform tests.ok((select envio_pausado from public.cc_meta_config where canal = 'instagram') and not (select envio_pausado from public.cc_meta_config where canal = 'messenger'), '7 · pausa de Instagram no toca Messenger');
  perform tests.act_as(v_admin);

  -- 8 · estado para Dirección: canales, compuerta e historial (con nombre del responsable, sin datos de clientes)
  e := public.cc_canal_estado();
  perform tests.ok(jsonb_array_length(e -> 'canales') = 3 and (e ->> 'activacion_disponible') = 'false', '8 · estado: 3 canales y compuerta cerrada');
  perform tests.ok(exists (select 1 from jsonb_array_elements(e -> 'canales') c where c ->> 'canal' = 'instagram' and (c ->> 'envio_pausado')::boolean), '8 · estado refleja la pausa de Instagram');
  perform tests.ok((e -> 'historial' -> 0 ->> 'motivo') = 'Pausa Instagram' and (e -> 'historial' -> 0 ->> 'origen') = 'rpc' and (e -> 'historial' -> 0 ->> 'actor') is not null, '8 · historial más reciente primero, con responsable');
  perform tests.ok(not (e::text ~ 'wa_id|psid|telefono|phone'), '8 · sin datos de contactos');

  -- 9 · Dirección suspendida ya no cambia
  perform tests.act_as_service();
  v_admin2 := tests.user('admin');
  update public.profiles set active = false where id = v_admin2;
  perform tests.act_as(v_admin2);
  perform tests.throws_any($$select public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', 'Cuenta suspendida')$$, array['CUENTA_SUSPENDIDA', 'NO_AUTORIZADO'], '9 · admin suspendido no cambia');
end $t$;
rollback;
