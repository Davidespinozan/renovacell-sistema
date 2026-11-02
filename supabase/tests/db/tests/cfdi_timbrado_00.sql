-- TIMBRADO REAL (20270310) · cfdi_preparar junta todo lo que el timbrado necesita y dice qué falta: la compuerta es por
-- pedido (productos y envío con configuración fiscal VALIDADA por una persona), pagado, emisor completo y total cuadrado.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); d1 uuid := tests.user('doctor'); s1 uuid := tests.user('pos');
  p1 uuid; p2 uuid; o1 uuid; doc uuid := gen_random_uuid(); r jsonb; ok boolean;
  rec jsonb := '{"rfc":"XAXX010101AB1","razon_social":"CLINICA PRUEBA","regimen":"601","cp":"80000","uso_cfdi":"G03","email_facturacion":"fact@prueba.mx"}';
begin
  perform tests.act_as_owner();
  update public.company_settings set rfc = 'REN160406PSA', razon_social = 'RENOVACELL', regimen_fiscal = '601', cp = '80020' where id = 'default';
  p1 := tests.product(1160); p2 := tests.product(500);
  o1 := tests.order(d1, 'paid', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 2, 'unit_price', 1160), jsonb_build_object('product_id', p2, 'qty', 1, 'unit_price', 500)), 'paid');

  perform tests.act_as(v_admin);
  r := public.solicitar_cfdi(doc, o1, rec);

  -- ══ 1 · sin claves: dice exactamente qué producto y qué falta; no hay folio reservado ══
  r := public.cfdi_preparar(doc);
  perform tests.ok(not (r ->> 'listo')::boolean and jsonb_array_length(r -> 'faltantes') = 2 and (r -> 'faltantes') ->> 0 like '%configuración fiscal sin iniciar%', '1 · sin claves no está listo (los 2 productos)');
  perform tests.ok(jsonb_array_length(r -> 'lineas') = 2 and r -> 'emisor' ->> 'cp' = '80020' and r -> 'cobros' -> 0 ->> 'method' = 'transferencia', '1 · trae renglones, emisor y cobros');
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from public.fiscal_folio_domains), '1 · preparar no reserva folio');
  perform tests.act_as(v_admin);

  -- ══ 2 · capturadas pero sin validar: sigue cerrado; validadas por una persona: listo ══
  perform public.editar_fiscal_producto(gen_random_uuid(), p1, '{"clave_prod_serv":"51182001","clave_unidad":"H87","objeto_imp":"02","tratamiento_iva":"gravado","iva_tasa":"0.16","descripcion_fiscal":"TOXINA BOTULINICA 100 U"}', null);
  perform public.editar_fiscal_producto(gen_random_uuid(), p2, '{"clave_prod_serv":"53131600","clave_unidad":"H87","objeto_imp":"02","tratamiento_iva":"tasa_cero","iva_tasa":"0","descripcion_fiscal":"PRODUCTO TASA CERO"}', null);
  perform tests.ok(not (public.cfdi_preparar(doc) ->> 'listo')::boolean, '2 · capturadas sin validar: no se factura');
  perform public.validar_fiscal_producto(gen_random_uuid(), p1, 'contador');
  perform public.validar_fiscal_producto(gen_random_uuid(), p2, 'contador');
  r := public.cfdi_preparar(doc);
  perform tests.ok((r ->> 'listo')::boolean and jsonb_array_length(r -> 'faltantes') = 0, '2 · validadas: listo para timbrar');

  -- ══ 3 · envío cobrado: hace falta su concepto validado ══
  perform tests.act_as_owner(); perform set_config('app.trusted', 'on', true); update public.orders set shipping_cost = 290, total = total + 290 where id = o1; perform set_config('app.trusted', '', true); perform tests.act_as(v_admin);
  perform tests.ok((public.cfdi_preparar(doc) -> 'faltantes') ->> 0 like 'Envío:%', '3 · el envío sin configurar cierra el pedido');
  perform public.fiscal_envio_guardar('{"clave_prod_serv":"78102203","clave_unidad":"E48","objeto_imp":"02","tratamiento_iva":"gravado","iva_tasa":"0.16","descripcion_fiscal":"SERVICIO DE ENVIO"}');
  perform tests.ok(not (public.cfdi_preparar(doc) ->> 'listo')::boolean, '3 · envío capturado sin validar: cerrado');
  perform public.fiscal_envio_validar('contador');
  perform tests.ok((public.cfdi_preparar(doc) ->> 'listo')::boolean and public.cfdi_preparar(doc) -> 'envio' ->> 'clave_prod_serv' = '78102203', '3 · envío validado: listo');
  perform public.fiscal_envio_guardar('{"iva_tasa":"0.08"}');
  perform tests.ok(not (public.fiscal_envio_ver() ->> 'validado')::boolean, '3 · cambiar un dato del envío lo regresa a "por validar"');
  perform public.fiscal_envio_validar('contador');

  -- ══ 4 · total que no cuadra y pedido sin pagar ══
  perform tests.act_as_owner(); perform set_config('app.trusted', 'on', true); update public.orders set total = total + 10 where id = o1; perform set_config('app.trusted', '', true); perform tests.act_as(v_admin);
  perform tests.ok(exists (select 1 from jsonb_array_elements_text(public.cfdi_preparar(doc) -> 'faltantes') f where f like '%no cuadra%'), '4 · total distinto a renglones + envío: no se factura');
  perform tests.act_as_owner(); perform set_config('app.trusted', 'on', true); update public.orders set total = total - 10 where id = o1; perform set_config('app.trusted', '', true); perform tests.act_as(v_admin);

  -- ══ 5 · permisos: solo Dirección/Facturación; la validación del envío es humana ══
  perform tests.act_as(s1);
  begin perform public.cfdi_preparar(doc); ok := false; exception when others then ok := true; end;
  perform tests.ok(ok, '5 · un vendedor no prepara facturas');
  begin perform public.fiscal_envio_guardar('{"clave_unidad":"E48"}'); ok := false; exception when others then ok := true; end;
  perform tests.ok(ok, '5 · un vendedor no toca la configuración fiscal del envío');
  perform tests.act_as_service();
  begin perform public.fiscal_envio_validar('servidor'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '5 · el servidor no puede validar (validación humana)');
  perform tests.act_as_owner();
  begin update public.fiscal_concepto_envio set validado = false; ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '5 · la tabla solo cambia por sus comandos');
end $t$;
rollback;
