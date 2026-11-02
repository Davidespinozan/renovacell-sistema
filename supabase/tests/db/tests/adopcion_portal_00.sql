-- ADOPCIÓN DEL PORTAL (20270308) · el aviso de aprobación lleva su enlace de acceso; el pedido por WhatsApp, su enlace al portal;
-- Dirección ve cuántos ya usan su cuenta y por dónde llegan los pedidos.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); d1 uuid := tests.user('doctor'); c1 uuid; r jsonb; v_sol uuid; t text; ok boolean;
begin
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216677778888', 'Dra. Paz', 'wamid.AP.1', 'Hola', false); c1 := (r ->> 'conversation_id')::uuid;
  perform public.cc_ia_solicitar_alta(c1, 'Paz Romero', '22334455', 'paz@x.mx');
  select id into v_sol from public.cc_solicitudes_alta where conversation_id = c1;
  perform public.cc_alta_wa_cerrar(v_sol, null, d1, v_admin, 'https://sistema.renovacell.mx/sistema#token=abc', true);
  select content into t from public.cc_messages where conversation_id = c1 and client_message_id like 'tpl:alta_wa:%';
  perform tests.ok(t like '%crea tu contraseña aquí https://sistema.renovacell.mx/sistema#token=abc%vale una hora%', '1 · al aprobar le llega su enlace para crear su contraseña');
  perform tests.ok(t like '%vuelves a pedir con un toque%', '1 · y para qué le sirve su portal');
  perform tests.ok(pg_get_functiondef('public.cc_ia_pedido_confirmar(uuid,uuid)'::regprocedure) like '%''portal'', jsonb_build_object(''url''%', '2 · el pedido por WhatsApp lleva el enlace al portal');
  perform tests.act_as(v_admin);
  r := public.adopcion_resumen(30);
  perform tests.ok(r -> 'clientes' ? 'con_cuenta' and r -> 'clientes' ? 'entraron' and r ? 'pedidos' and (r ->> 'verificados_por_whatsapp')::int = 1, '3 · resumen de adopción para Dirección');
  perform tests.act_as(d1);
  begin perform public.adopcion_resumen(30); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '3 · solo Dirección');
end $t$;
rollback;
