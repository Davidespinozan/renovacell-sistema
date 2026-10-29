-- VINCULAR-CLIENTE (20270206) · caso real: clienta de Odoo de la cartera de un vendedor escribe por WhatsApp desde OTRO
-- número y da su nombre en el chat. El sistema la sugiere, el personal la vincula, su número queda en la ficha y la
-- conversación llega a SU vendedor. Autoridad, privacidad (vincular a un cliente ajeno no da su expediente) y cartera.
begin;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql
do $t$
declare v_admin uuid := tests.fixture_admin(); v_rob uuid := tests.user('pos'); v_ale uuid := tests.user('pos'); v_otro uuid := tests.user('pos');
  cu uuid; cu2 uuid; c uuid; c2 uuid; r jsonb; sug jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (v_rob, v_ale, v_otro);
  perform tests.act_as_owner();
  alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = false, envio_pausado = false where id;
  insert into public.customers (full_name, phone, city, active) values ('LOURDES VELAZQUEZ NAVARRETE', '5512342562', 'Tlalnepantla', true) returning id into cu;
  insert into public.customers (full_name, phone, city, active) values ('CLINICA SIN VENDEDOR', '6670009999', 'Culiacán', true) returning id into cu2;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id, motivo) values (cu, v_rob, 'Odoo');
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5215511111262', '.', 'wamid.VC.1', 'Hola buenas tardes, me podría dar el costo de Dysport 500?', false);
  c := (r ->> 'conversation_id')::uuid;
  perform public.cc_wa_entrante('5215511111262', '.', 'wamid.VC.2', 'Maria de Lourdes Velazquez Navarrete', false);

  -- 1 · la solicitud no se reconoció: espera asesor sin vendedor (otro número que el de su ficha)
  perform tests.act_as_owner();
  perform tests.eq((select modo from public.cc_conversations where id = c), 'human_requested', '1 · pidió asesor');
  perform tests.ok((select customer_id is null from public.cc_conversations where id = c), '1 · aún sin ficha');

  -- 2 · autoridad: un vendedor sin la conversación no ve sugerencias ni vincula; Dirección sí
  perform tests.act_as(v_otro);
  perform tests.throws(format('select public.cc_cliente_sugerencias(%L)', c), 'NO_AUTORIZADO', '2 · un vendedor ajeno no ve sugerencias');
  perform tests.throws(format('select public.cc_vincular_cliente(%L, %L)', c, cu), 'NO_AUTORIZADO', '2 · ni vincula');
  perform tests.act_as(v_admin);
  sug := public.cc_cliente_sugerencias(c);
  perform tests.ok(sug @> jsonb_build_array(jsonb_build_object('customer_id', cu, 'motivo', 'nombre')), '2 · la sugiere por el nombre que escribió');
  perform tests.ok((sug -> 0 ->> 'telefono') = '••••2562' and not (sug::text like '%5512342562%'), '2 · teléfono enmascarado, nunca completo');
  perform tests.ok(not (sug @> jsonb_build_array(jsonb_build_object('customer_id', cu2))), '2 · no sugiere a quien no coincide');

  -- 3 · Dirección la vincula: número a la ficha y la conversación va a SU vendedor
  r := public.cc_vincular_cliente(c, cu);
  perform tests.ok((r ->> 'numero_guardado')::boolean and (r ->> 'reasignada')::boolean and (r ->> 'vendedor')::uuid = v_rob, '3 · número guardado y reasignada a su vendedor');
  perform tests.act_as_owner();
  perform tests.ok((select customer_id = cu and seller_profile_id = v_rob and modo = 'human_assigned' from public.cc_conversations where id = c), '3 · ligada y asignada a Roberto');
  perform tests.ok(exists (select 1 from public.customer_phones p where p.customer_id = cu and p.numero_norm = '5511111262' and p.etiqueta = 'whatsapp' and p.activo), '3 · el número de WhatsApp quedó en su ficha');
  perform tests.ok(exists (select 1 from public.cc_conversacion_cliente_hist h where h.conversation_id = c and h.customer_nuevo = cu and h.actor_profile_id = v_admin), '3 · historial del vínculo');
  perform tests.ok(public._cc_nombre_dueno(c) like 'LOURDES VELAZQUEZ NAVARRETE%', '3 · el nombre del dueño ya es el de la clienta');
  perform tests.act_as(v_admin);
  r := public.cc_vincular_cliente(c, cu);
  perform tests.ok((r ->> 'idempotente')::boolean, '3 · repetirlo no hace nada');

  -- 4 · ficha: completa para su vendedor; la próxima vez el número la reconoce
  perform tests.act_as(v_rob);
  r := public.cc_cliente_de_conversacion(c);
  perform tests.ok((r ->> 'es_tuyo')::boolean and (r ->> 'vinculado')::boolean and r ? 'pedidos' and (r ->> 'tiene_cuenta')::boolean = false, '4 · su vendedor ve la ficha completa');
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5215511111262', '.', 'wamid.VC.3', 'Hola otra vez', false);
  perform tests.act_as(v_rob);
  perform tests.ok((public.cc_cliente_sugerencias(c) @> jsonb_build_array(jsonb_build_object('customer_id', cu, 'motivo', 'telefono'))), '4 · ahora la reconoce por el teléfono');

  -- 5 · cliente SIN vendedor: el vendedor que la vincula la toma (cartera), como en el reparto
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216671112233', 'Clinica', 'wamid.VC.4', 'Quiero información', false);
  c2 := (r ->> 'conversation_id')::uuid;
  perform public.cc_asignar_asesor(c2, v_admin, v_ale);   -- (lo llama la Edge chat con el JWT de Dirección)
  perform tests.act_as(v_ale);
  r := public.cc_vincular_cliente(c2, cu2, false);
  perform tests.ok((r ->> 'cartera_asignada')::boolean and not (r ->> 'numero_guardado')::boolean, '5 · sin vendedor: la toma quien la vincula; sin guardar número si no se pide');
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id = v_ale from public.cc_cartera_clientes where customer_id = cu2), '5 · queda en su cartera (con historial)');
  perform tests.ok(exists (select 1 from public.cc_cartera_clientes_historial where customer_id = cu2 and seller_nuevo = v_ale), '5 · historial de cartera');

  -- 6 · privacidad: vincular a una clienta de OTRO vendedor no da su expediente; la conversación pasa a su vendedor
  perform tests.act_as(v_ale);
  r := public.cc_vincular_cliente(c2, cu);
  perform tests.ok((r ->> 'reasignada')::boolean and (r ->> 'vendedor')::uuid = v_rob, '6 · pasa al vendedor de su cartera');
  perform tests.throws(format('select public.cc_cliente_de_conversacion(%L)', c2), 'NO_AUTORIZADO', '6 · quien la vinculó ya no la trabaja ni ve su ficha');
  perform tests.act_as(v_rob);
  perform tests.ok((public.cc_cliente_de_conversacion(c2) ->> 'customer_id')::uuid = cu, '6 · su vendedor sí');

  -- 7 · desvincular; inactiva no se vincula
  perform tests.act_as(v_rob);
  r := public.cc_desvincular_cliente(c2);
  perform tests.ok(not (r ->> 'idempotente')::boolean and (select customer_id is null from public.cc_conversations where id = c2), '7 · desvincular');
  perform tests.act_as_owner(); update public.customers set active = false where id = cu2;
  perform tests.act_as(v_rob);
  perform tests.throws(format('select public.cc_vincular_cliente(%L, %L)', c2, cu2), 'CLIENTE_INACTIVO', '7 · inactiva no se vincula');
end $t$;
rollback;
