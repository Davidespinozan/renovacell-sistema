-- CRM · EMBUDO (20270321) · avance automático (mensaje → nuevo; ligar ficha → calificado; cotización → propuesta;
-- pago → ganado), movimiento manual con motivo para Perdido, permisos (vendedor lo suyo; Dirección/jefe todo), totales.
begin;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); jefe uuid := tests.user('pos'); v_bill uuid := tests.user('billing');
  c uuid; cu uuid; cu2 uuid; p uuid; o uuid; r jsonb; op jsonb; v_id uuid; ok boolean; n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (s1, s2);
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","jefe_ventas"]}' where id = jefe;
  insert into public.customers (full_name, phone, source, active) values ('LOURDES CRM', '6670004444', 'odoo', true) returning id into cu;
  insert into public.customers (full_name, phone, source, active) values ('OTRO CRM', '6670005555', 'odoo', true) returning id into cu2;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id, motivo) values (cu, s1, 'Odoo'), (cu2, s2, 'Odoo');
  p := tests.producto_fam('Toxinas', 'Dysport', 1000); perform tests.stock(p, 'CRM-L', 50);
  perform tests.act_as_owner();
  alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = false, envio_pausado = false where id;
  perform tests.act_as_service();

  -- ══ 1 · escribe por WhatsApp → NUEVO (una sola aunque mande más mensajes) ══
  r := public.cc_wa_entrante('5216670004444', 'Lourdes', 'wamid.CRM.1', 'Hola, ¿tienen Dysport?', false); c := (r ->> 'conversation_id')::uuid;
  perform public.cc_wa_entrante('5216670004444', 'Lourdes', 'wamid.CRM.2', '¿A cómo?', false);
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 and bool_and(etapa = 'nuevo' and origen = 'whatsapp') from public.crm_oportunidades where conversation_id = c), '1 · un mensaje por WhatsApp abre UNA oportunidad en Nuevo');

  -- ══ 2 · se liga a su ficha → CALIFICADO ══
  perform tests.act_as_service(); perform public.cc_asignar_asesor(c, v_admin, s1);
  perform tests.act_as(s1); perform public.cc_vincular_cliente(c, cu, false);
  perform tests.act_as_owner();
  perform tests.ok((select etapa = 'calificado' and customer_id = cu and seller_profile_id = s1 from public.crm_oportunidades where conversation_id = c), '2 · ligado a su ficha: Calificado, con su vendedor');

  -- ══ 3 · cotización → PROPUESTA con monto ══
  perform tests.act_as(s1);
  r := public.cc_cotizacion_crear(cu, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 3)), 'cotización CRM', c);
  perform tests.act_as_owner();
  perform tests.ok((select etapa = 'propuesta' and monto_estimado = 3000 and cotizacion_id is not null from public.crm_oportunidades where conversation_id = c), '3 · cotización: Propuesta con su monto');

  -- ══ 4 · pedido y pago → GANADO ══
  perform tests.act_as(s1);
  o := (public.crear_pedido(gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 3)), null, false, cu) ->> 'order_id')::uuid;
  set constraints all immediate; set constraints all deferred;
  perform tests.act_as_owner();
  perform tests.ok((select etapa = 'propuesta' and order_id = o from public.crm_oportunidades where conversation_id = c), '4 · pedido levantado: sigue en Propuesta, ligado al pedido');
  perform tests.act_as(v_bill); perform public.registrar_cobro(gen_random_uuid(), o, 'transferencia', 3000, null, 'SPEI-CRM');
  perform tests.act_as_owner();
  perform tests.ok((select etapa = 'ganado' and cerrada_at is not null and monto_estimado = 3000 from public.crm_oportunidades where conversation_id = c), '4 · pagado: Ganado');
  perform tests.ok((select count(*) = 4 from public.crm_oportunidad_eventos e join public.crm_oportunidades x on x.id = e.oportunidad_id where x.conversation_id = c), '4 · historial: nuevo → calificado → propuesta → ganado');

  -- ══ 5 · manual: crear, mover, Perdido con motivo; permisos ══
  perform tests.act_as(s2);
  op := public.crm_crear(cu2, 'Reposición mensual', 12000);
  v_id := (op ->> 'id')::uuid;
  perform tests.ok(op ->> 'etapa' = 'nuevo' and (op ->> 'monto')::numeric = 12000 and (op ->> 'vendedor_id')::uuid = s2, '5 · el vendedor crea su oportunidad');
  begin perform public.crm_crear(cu2); ok := false; exception when check_violation then ok := sqlerrm like 'YA_ABIERTA%'; end;
  perform tests.ok(ok, '5 · una abierta por cliente');
  begin perform public.crm_mover(v_id, 'perdido', ''); ok := false; exception when check_violation then ok := sqlerrm like 'MOTIVO_REQUERIDO%'; end;
  perform tests.ok(ok, '5 · Perdido exige motivo');
  perform tests.act_as(s1);
  begin perform public.crm_mover(v_id, 'calificado'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '5 · otro vendedor no mueve una oportunidad ajena');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.crm_embudo()) x where (x ->> 'id')::uuid = v_id), '5 · ni la ve en su embudo');
  perform tests.act_as(jefe);
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.crm_embudo()) x where (x ->> 'id')::uuid = v_id), '5 · el jefe de ventas ve todo');
  perform tests.ok((public.crm_mover(v_id, 'perdido', 'compró con otro proveedor') ->> 'etapa') = 'perdido', '5 · el jefe la marca perdida con motivo');
  perform tests.act_as(v_admin);
  r := public.crm_resumen(30);
  perform tests.ok((r -> 'por_etapa' -> 'ganado' ->> 'n')::int >= 1 and (r -> 'por_etapa' -> 'perdido' ->> 'n')::int >= 1 and (r ->> 'conversion')::numeric = 50, '5 · Dirección ve totales y conversión (1 ganada de 2 cerradas = 50%)');
  perform tests.act_as(s1);
  begin perform public.crm_resumen(30); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '5 · un vendedor no ve los totales de todos');

  -- ══ 6 · venta de mostrador a un cliente sin oportunidad: se registra Ganada (el embudo cuenta todas las ventas) ══
  perform tests.act_as_owner();
  n := (select count(*) from public.crm_oportunidades where etapa = 'ganado');
  o := gen_random_uuid();
  insert into public.orders (id, external_ref, customer_id, total, status, payment_method, payment_status) values (o, 'SCRM6', cu2, 1000, 'pending_payment', 'transferencia', 'pending');
  insert into public.order_items (order_id, product_id, qty, unit_price) values (o, p, 1, 1000);
  set constraints all immediate; set constraints all deferred;
  perform tests.act_as(v_bill); perform public.registrar_cobro(gen_random_uuid(), o, 'efectivo', 1000);
  perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.crm_oportunidades where etapa = 'ganado') = n + 1 and exists (select 1 from public.crm_oportunidades where order_id = o and origen = 'pedido'), '6 · venta sin oportunidad: queda Ganada');
  perform tests.ok(not has_table_privilege('authenticated', 'public.crm_oportunidades', 'SELECT'), '6 · la tabla solo se lee por los comandos');
end $t$;
rollback;
