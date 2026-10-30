-- INTERÉS PROACTIVO (20270224) · la ficha vista o la búsqueda sin resultados es señal: tras un respiro, la IA le escribe al
-- doctor en su chat con precios reales y su vendedor recibe el aviso; nunca más de uno cada 24 h ni si un asesor atiende.
begin;
do $t$
declare
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); s1 uuid := tests.user('pos'); a uuid := tests.product(1300); cu uuid; cu2 uuid; r jsonb; v_conv uuid; t text;
begin
  perform tests.act_as_owner();
  update public.products set name = 'Nabota 100', show_portal = true where id = a;
  insert into public.product_volume_prices (product_id, min_quantity, price, nivel) values (a, 10, 1170, 'medio'), (a, 50, 800, 'mayoreo');
  cu := tests.cliente(d1);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  cu2 := tests.cliente(d2);

  -- ══ 1 · la señal entra con respiro y se atiende después ══
  perform tests.act_as(d1);
  perform public.cc_registrar_actividad('ficha', a);
  perform tests.act_as_service();
  perform tests.eq(public.cc_interes_despachar(), 0, '1 · durante el respiro no se escribe');
  update public.cc_interes_cola set listo_at = now() - interval '1 second' where profile_id = d1;
  perform tests.eq(public.cc_interes_despachar(), 1, '1 · pasado el respiro, la IA escribe');
  select c.id into v_conv from public.cc_conversations c where c.profile_id = d1 and c.estado = 'abierta';
  select m.content into t from public.cc_messages m where m.conversation_id = v_conv and m.client_message_id like 'tpl:interes:%';
  perform tests.ok(t like '%Nabota 100%' and t like '%pieza $1,300%' and t like '%medio mayoreo desde 10 piezas a $1,170 (puedes juntar%' and t like '%mayoreo desde 50 a $800%todo tu pedido pasa a mayoreo%', '1 · con precios reales y las reglas: ' || coalesce(t, '∅'));
  perform tests.ok(exists (select 1 from public.notifications n where s1 = any (n.user_ids) and n.kind = 'interes' and n.body like '%está viendo Nabota 100%la IA ya le escribió%'), '1 · su vendedor recibe el aviso');

  -- ══ 2 · una vez cada 24 h ══
  perform tests.act_as(d1);
  perform public.cc_registrar_actividad('sin_resultados', null, 'exosomas');
  perform tests.act_as_service();
  update public.cc_interes_cola set listo_at = now() - interval '1 second' where profile_id = d1;
  perform tests.eq(public.cc_interes_despachar(), 0, '2 · otra señal el mismo día no genera otro mensaje');

  -- ══ 3 · búsqueda sin resultados y doctor sin vendedor ══
  perform tests.act_as(d2);
  perform public.cc_registrar_actividad('sin_resultados', null, 'exosomas');
  perform tests.act_as_service();
  update public.cc_interes_cola set listo_at = now() - interval '1 second' where profile_id = d2;
  perform tests.eq(public.cc_interes_despachar(), 1, '3 · búsqueda sin resultados: le escribe');
  perform tests.ok(exists (select 1 from public.cc_messages m join public.cc_conversations c on c.id = m.conversation_id where c.profile_id = d2 and m.content like '%buscaste «exosomas»%'), '3 · ofrece ayudar a encontrarlo');

  -- ══ 4 · con un asesor atendiendo, la IA no interrumpe (solo avisa al vendedor) ══
  perform tests.act_as_owner();
  update public.cc_interes_cola set ultimo_envio_at = null where profile_id = d1;
  update public.cc_conversations set modo = 'human_active', seller_profile_id = s1 where id = v_conv;
  delete from public.notifications where kind = 'interes';
  perform tests.act_as(d1);
  perform public.cc_registrar_actividad('ficha', a);
  perform tests.act_as_service();
  update public.cc_interes_cola set listo_at = now() - interval '1 second', enviado_at = null where profile_id = d1;
  perform tests.eq(public.cc_interes_despachar(), 0, '4 · no escribe la IA');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'interes' and s1 = any (user_ids)), '4 · pero el vendedor sí se entera');

  -- ══ 5 · el vendedor ve el interés en el expediente; Dirección lo apaga ══
  perform tests.act_as(s1);
  r := public.cliente_interes_reciente(cu);
  perform tests.ok(exists (select 1 from jsonb_array_elements(r) e where e ->> 'producto' = 'Nabota 100') and exists (select 1 from jsonb_array_elements(r) e where e ->> 'termino' = 'exosomas'), '5 · el vendedor ve lo que buscó y miró');
  perform tests.throws(format('select public.cliente_interes_reciente(%L)', cu2), 'NO_AUTORIZADO', '5 · no el de clientes ajenos');
  perform tests.act_as(tests.fixture_admin());
  perform tests.eq(public.interes_config_guardar(false, null) ->> 'activo', 'false', '5 · Dirección lo apaga');
  perform tests.act_as_service();
  perform tests.eq(public.cc_interes_despachar(), 0, '5 · apagado no escribe');
end $t$;
rollback;
