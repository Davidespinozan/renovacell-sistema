-- PROMO-9 (180) · flyers: las piezas de marketing que el doctor ve en su Inicio. Administración solo Dirección/Facturación;
-- vigencia propia o la de la promoción a la que se liga; por lista; pausar; eliminar; el correo y la tarjeta de la promo
-- llevan su flyer; anónimo y el doctor no tocan la tabla.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor');
  botox uuid; hoy date; r jsonb; pid uuid; fid uuid; fid2 uuid; fid3 uuid; v_may uuid; v_gen uuid;
begin
  hoy := public._promo_hoy();
  perform tests.act_as_service();
  botox := tests.product(4600); update public.products set name = 'Botox 100 UI' where id = botox;
  select id into v_may from public.price_lists where name = 'Mayoreo';
  if v_may is null then insert into public.price_lists (name) values ('Mayoreo') returning id into v_may; end if;
  select id into v_gen from public.price_lists where id <> v_may order by is_default desc nulls last, name limit 1;
  update public.profiles set price_list_id = v_may where id = v_doc2;
  update public.profiles set price_list_id = v_gen where id = v_doc;
  perform tests.act_as_owner();

  -- ══ 1 · permisos ═════════════════════════════════════════════════════════════════════════════════
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.flyer_guardar(%L)', jsonb_build_object('titulo', 'Hoy último día', 'imagen_url', 'https://x.test/f1.jpg')), 'NO_AUTORIZADO', '1 · Ventas no sube flyers');
  perform tests.eq(jsonb_array_length(public.flyers_lista()), 0, '1 · Ventas no ve la administración (vacía)');
  perform tests.act_as_anon();
  perform tests.throws('select public.flyers_vigentes()', 'permission denied', '1 · anónimo no ve flyers');
  perform tests.act_as(v_doc);
  perform tests.throws('select count(*) from public.flyers', 'permission denied', '1 · el doctor no lee la tabla');

  -- ══ 2 · validación ═══════════════════════════════════════════════════════════════════════════════
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.flyer_guardar(%L)', jsonb_build_object('titulo', 'x', 'imagen_url', 'https://x.test/f1.jpg')), 'FLYER_INVALIDO: el título', '2 · título corto');
  perform tests.throws(format('select public.flyer_guardar(%L)', jsonb_build_object('titulo', 'Hoy último día', 'imagen_url', 'data:image/png;base64,xx')), 'FLYER_INVALIDO: falta la imagen', '2 · la imagen debe ser una URL https');
  perform tests.throws(format('select public.flyer_guardar(%L)', jsonb_build_object('titulo', 'Hoy último día', 'imagen_url', 'https://x.test/f1.jpg', 'promocion_id', gen_random_uuid())), 'esa promoción no existe', '2 · promo inexistente');
  perform tests.throws(format('select public.flyer_guardar(%L)', jsonb_build_object('titulo', 'Hoy último día', 'imagen_url', 'https://x.test/f1.jpg', 'desde', hoy, 'hasta', hoy - 1)), 'anterior al inicio', '2 · hasta < desde');

  -- ══ 3 · flyer suelto: hoy vigente, el doctor lo ve ══════════════════════════════════════════════
  r := public.flyer_guardar(jsonb_build_object('titulo', 'Hoy último día · Botox', 'imagen_url', 'https://x.test/f1.jpg', 'product_id', botox));
  fid := (r ->> 'id')::uuid;
  perform tests.ok(r ->> 'estado' = 'vigente' and r ->> 'producto' = 'Botox 100 UI' and (r ->> 'desde')::date = hoy and r -> 'hasta' = 'null'::jsonb, '3 · se guarda vigente desde hoy, sin fecha de término, con el producto');
  perform tests.act_as(v_doc);
  r := public.flyers_vigentes();
  perform tests.ok(jsonb_array_length(r) = 1 and (r -> 0 ->> 'id')::uuid = fid and r -> 0 ->> 'imagen_url' = 'https://x.test/f1.jpg', '3 · el doctor ve el flyer en su Inicio');

  -- ══ 4 · programado / terminado / pausado no se ven ══════════════════════════════════════════════
  perform tests.act_as(v_bill);
  r := public.flyer_guardar(jsonb_build_object('titulo', 'Próxima semana', 'imagen_url', 'https://x.test/f2.jpg', 'desde', hoy + 3));
  perform tests.eq(r ->> 'estado', 'programado', '4 · Facturación también administra; flyer con fecha futura = programado');
  fid2 := (r ->> 'id')::uuid;
  r := public.flyer_guardar(jsonb_build_object('titulo', 'Ya pasó', 'imagen_url', 'https://x.test/f3.jpg', 'desde', hoy - 10, 'hasta', hoy - 1));
  perform tests.eq(r ->> 'estado', 'terminado', '4 · flyer con término pasado = terminado');
  perform tests.act_as(v_doc);
  perform tests.eq(jsonb_array_length(public.flyers_vigentes()), 1, '4 · el doctor solo ve el vigente');
  perform tests.act_as(v_admin);
  perform tests.eq(public.flyer_estado(fid, false) ->> 'estado', 'pausado', '4 · pausar');
  perform tests.act_as(v_doc);
  perform tests.eq(jsonb_array_length(public.flyers_vigentes()), 0, '4 · pausado no se ve');
  perform tests.act_as(v_admin);
  perform tests.eq(public.flyer_estado(fid, true) ->> 'estado', 'vigente', '4 · reactivar');
  perform tests.ok(jsonb_array_length(public.flyers_lista()) = 3 and jsonb_array_length(public.flyers_lista(false)) = 2, '4 · la administración lista todos (3) o solo vigentes y programados (2)');

  -- ══ 5 · por lista de precios ════════════════════════════════════════════════════════════════════
  r := public.flyer_guardar(jsonb_build_object('id', fid, 'titulo', 'Hoy último día · Botox', 'imagen_url', 'https://x.test/f1.jpg', 'listas', jsonb_build_array(v_may)));
  perform tests.ok(r -> 'listas' = jsonb_build_array(v_may), '5 · se limita a Mayoreo');
  perform tests.act_as(v_doc);
  perform tests.eq(jsonb_array_length(public.flyers_vigentes()), 0, '5 · el doctor de lista general no lo ve');
  perform tests.act_as(v_doc2);
  perform tests.eq(jsonb_array_length(public.flyers_vigentes()), 1, '5 · el doctor de Mayoreo sí');
  perform tests.act_as(v_pos);
  perform tests.eq(jsonb_array_length(public.flyers_vigentes()), 1, '5 · el staff ve todos los vigentes');
  perform tests.act_as(v_admin);
  r := public.flyer_guardar(jsonb_build_object('id', fid, 'titulo', 'Hoy último día · Botox', 'imagen_url', 'https://x.test/f1.jpg'));
  perform tests.ok(r -> 'listas' = 'null'::jsonb, '5 · vuelve a todas las listas');

  -- ══ 6 · ligado a una promoción: vive y muere con ella; el correo y la tarjeta lo llevan ══════════
  r := public.promocion_guardar(jsonb_build_object('nombre', 'Promo Allergan', 'desde', hoy - 1, 'hasta', hoy + 1, 'lineas', jsonb_build_array(jsonb_build_object('product_id', botox, 'precio', 4000))));
  pid := (r ->> 'id')::uuid;
  r := public.flyer_guardar(jsonb_build_object('titulo', 'Promo Allergan', 'imagen_url', 'https://x.test/promo.jpg', 'promocion_id', pid));
  fid3 := (r ->> 'id')::uuid;
  perform tests.ok(r ->> 'estado' = 'vigente' and (r ->> 'desde')::date = hoy - 1 and (r ->> 'hasta')::date = hoy + 1 and r ->> 'promocion' = 'Promo Allergan', '6 · toma la vigencia de la promo');
  perform tests.act_as_owner();   -- _promo_texto es interna
  perform tests.eq(public._promo_texto(pid) ->> 'flyer_url', 'https://x.test/promo.jpg', '6 · el texto de la promo (correo) lleva el flyer');
  perform tests.act_as(v_admin);
  r := public.promocion_difusion_previa(pid);
  perform tests.eq(r -> 'datos' ->> 'flyer_url', 'https://x.test/promo.jpg', '6 · la vista previa del envío lo lleva');
  perform tests.act_as(v_doc);
  perform tests.eq(public.promo_tarjeta(pid) ->> 'flyer_url', 'https://x.test/promo.jpg', '6 · la tarjeta del chat del doctor lo lleva');
  perform tests.eq(jsonb_array_length(public.flyers_vigentes()), 2, '6 · el doctor ve los dos flyers');
  perform tests.act_as(v_admin);
  perform public.promocion_estado(pid, false);
  perform tests.eq((select x ->> 'estado' from jsonb_array_elements(public.flyers_lista()) x where (x ->> 'id')::uuid = fid3), 'pausado', '6 · promo pausada → flyer pausado');
  perform tests.act_as(v_doc);
  perform tests.eq(jsonb_array_length(public.flyers_vigentes()), 1, '6 · ya no se ve');
  perform tests.act_as(v_admin);
  perform public.promocion_estado(pid, true);
  perform public.promocion_guardar(jsonb_build_object('id', pid, 'nombre', 'Promo Allergan', 'desde', hoy - 5, 'hasta', hoy - 2, 'lineas', jsonb_build_array(jsonb_build_object('product_id', botox, 'precio', 4000))));
  perform tests.eq((select x ->> 'estado' from jsonb_array_elements(public.flyers_lista()) x where (x ->> 'id')::uuid = fid3), 'terminado', '6 · promo terminada → flyer terminado');
  perform tests.act_as_owner();
  perform tests.ok(public._promo_texto(pid) -> 'flyer_url' = 'null'::jsonb, '6 · la promo terminada ya no lleva flyer');
  perform tests.act_as(v_admin);
  perform public.promocion_eliminar(pid);
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.flyers_lista()) x where (x ->> 'id')::uuid = fid3), '6 · y su flyer se va con ella');

  -- ══ 7 · eliminar y bitácora ═════════════════════════════════════════════════════════════════════
  perform tests.ok(public.flyer_eliminar(fid2), '7 · eliminar');
  perform tests.throws(format('select public.flyer_eliminar(%L)', fid2), 'FLYER_INEXISTENTE', '7 · dos veces no');
  perform tests.ok((select count(*) from public.audit_logs where action in ('Flyer guardado', 'Flyer pausado', 'Flyer activado', 'Flyer eliminado')) >= 8, '7 · bitácora de cada cambio');
  perform tests.act_as_owner();
end $t$;
rollback;
