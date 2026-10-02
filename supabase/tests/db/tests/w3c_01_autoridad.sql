-- W3-C · C1 — AUTORIDAD, IDEMPOTENCIA, BITÁCORA Y NO-INTERFERENCIA.
-- La configuración fiscal no la escribe ningún cliente, y este archivo prueba además
-- lo que C1 NO debe poder hacer: tocar precios, crear documentos fiscales o consumir folio.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing');
  v_doctor uuid := tests.user('doctor'); v_wh uuid := tests.user('warehouse');
  v_pos uuid := tests.user('pos'); v_p uuid; r record;
begin
  v_p := tests.producto_cat('Medicamentos');
  perform tests.act_as(v_admin);
  perform tests.pf_validado(v_p, 'tasa_cero', 0);

  -- ── Escritura directa: cerrada para todos los roles ───────────────────────
  for r in select * from (values ('admin', v_admin), ('billing', v_bill), ('doctor', v_doctor),
                                 ('warehouse', v_wh), ('pos', v_pos)) as t(rol, uid) loop
    perform tests.act_as(r.uid);
    perform tests.throws_any(format($q$update public.product_fiscal set validado = true where product_id = %L$q$, v_p),
      array['permission denied', 'FISCAL_PRODUCTO_SOLO_POR_COMANDO', 'row-level security'],
      format('el rol %s no se auto-valida escribiendo la tabla', r.rol));
    perform tests.throws_any(format($q$insert into public.product_fiscal (product_id, validado) values (%L, true)$q$, gen_random_uuid()),
      array['permission denied', 'FISCAL_PRODUCTO_SOLO_POR_COMANDO', 'row-level security', 'violates foreign key'],
      format('el rol %s no inserta una configuración validada', r.rol));
    perform tests.throws_any(format($q$delete from public.product_fiscal where product_id = %L$q$, v_p),
      array['permission denied', 'FISCAL_PRODUCTO_NO_SE_BORRA', 'row-level security'],
      format('el rol %s no borra una configuración fiscal', r.rol));
    perform tests.throws_any($q$insert into public.fiscal_category_defaults (categoria) values ('HACK')$q$,
      array['permission denied', 'FISCAL_DEFAULTS_SOLO_POR_COMANDO', 'row-level security'],
      format('el rol %s no inventa candidatos por categoría', r.rol));
    perform tests.throws_any(format($q$insert into public.product_fiscal_events (product_id, evento) values (%L, 'validado')$q$, v_p),
      array['permission denied', 'row-level security'],
      format('el rol %s no fabrica evidencia de validación', r.rol));
    perform tests.throws_any(format($q$delete from public.product_fiscal_events where product_id = %L$q$, v_p),
      array['permission denied', 'LEDGER_APPEND_ONLY', 'row-level security'],
      format('el rol %s no borra la bitácora fiscal del producto', r.rol));
  end loop;

  -- Ni el dueño de la base, fuera del contexto de comando.
  perform tests.act_as_owner();
  perform tests.throws(format('update public.product_fiscal set iva_tasa = 0.08 where product_id = %L', v_p),
    'FISCAL_PRODUCTO_SOLO_POR_COMANDO', 'ni desde la base se edita a mano');

  -- ── Comandos: solo Dirección y Facturación ────────────────────────────────
  for r in select * from (values ('doctor', v_doctor), ('warehouse', v_wh), ('pos', v_pos)) as t(rol, uid) loop
    perform tests.act_as(r.uid);
    perform tests.throws(format($q$select public.editar_fiscal_producto(%L, %L, '{"objeto_imp":"02"}'::jsonb)$q$, gen_random_uuid(), v_p),
      'NO_AUTORIZADO', format('el rol %s no edita datos fiscales', r.rol));
    perform tests.throws(format('select public.validar_fiscal_producto(%L, %L, ''x'')', gen_random_uuid(), v_p),
      'NO_AUTORIZADO', format('el rol %s no valida', r.rol));
    perform tests.throws(format('select public.invalidar_fiscal_producto(%L, %L, ''x'')', gen_random_uuid(), v_p),
      'NO_AUTORIZADO', format('el rol %s no invalida', r.rol));
    perform tests.throws('select public.estado_validacion_fiscal()',
      'NO_AUTORIZADO', format('el rol %s no ve la hoja de revisión fiscal', r.rol));
  end loop;

  -- Facturación SÍ puede las tres: es quien hace el trabajo con el contador.
  perform tests.act_as(v_bill);
  perform tests.lives(format($q$select public.editar_fiscal_producto(%L, %L, '{"notas":"revisado"}'::jsonb)$q$, gen_random_uuid(), v_p),
    'Facturación edita');
  perform tests.lives(format('select public.invalidar_fiscal_producto(%L, %L, ''reclasificación'')', gen_random_uuid(), v_p),
    'Facturación invalida');
  perform tests.lives(format('select public.validar_fiscal_producto(%L, %L, ''contador'')', gen_random_uuid(), v_p),
    'Facturación valida');
  perform tests.ok((select count(*) >= 1 from public.estado_validacion_fiscal()),
    'Facturación lee la hoja de revisión');

  -- ── Internos fuera del alcance ────────────────────────────────────────────
  perform tests.act_as(v_admin);
  perform tests.throws('select public._pf_campos_materiales()', 'permission denied',
    'ni Dirección invoca los internos del catálogo fiscal');
  perform tests.throws(format('select public._pf_faltantes(%L)', v_p), 'permission denied',
    'ni el cálculo de faltantes');

  -- ── Lectura acotada ───────────────────────────────────────────────────────
  perform tests.act_as(v_doctor);
  perform tests.eq((select count(*)::int from public.product_fiscal), 0, 'el doctor no ve la configuración fiscal');
  perform tests.act_as(v_wh);
  perform tests.eq((select count(*)::int from public.product_fiscal_events), 0, 'almacén tampoco');
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.product_fiscal', 'permission denied',
    'anónimo no tiene ni permiso de lectura');
end $t$;
rollback;

-- ── IDEMPOTENCIA y BITÁCORA ─────────────────────────────────────────────────────────────
begin;
do $t$
declare v_admin uuid := tests.user('admin'); v_p uuid; v_op uuid := gen_random_uuid(); v_r jsonb;
begin
  v_p := tests.producto_cat('Vitaminas');
  perform tests.act_as(v_admin);

  v_r := public.editar_fiscal_producto(v_op, v_p, tests.fiscal_completo(v_p));
  perform tests.eq(v_r->>'status', 'applied', 'la primera edición se aplica');
  v_r := public.editar_fiscal_producto(v_op, v_p, tests.fiscal_completo(v_p));
  perform tests.eq(v_r->>'status', 'already_applied', 'el mismo op_id devuelve el resultado ya registrado');
  perform tests.eq((select count(*)::int from public.fiscal_operations where op_id = v_op), 1,
    'una sola operación registrada');
  perform tests.eq((select count(*)::int from public.product_fiscal_events
                     where product_id = v_p and evento = 'editado'), 1,
    'y un solo evento en la bitácora: el reintento no duplica historia');

  perform tests.throws(format($q$select public.editar_fiscal_producto(%L, %L, '{"notas":"otra cosa"}'::jsonb)$q$, v_op, v_p),
    'OP_ID_REUTILIZADO', 'el mismo identificador con otros datos se rechaza');

  -- Idempotencia de validar e invalidar
  v_op := gen_random_uuid();
  perform tests.eq(public.validar_fiscal_producto(v_op, v_p, 'contador')->>'status', 'applied', 'valida');
  perform tests.eq(public.validar_fiscal_producto(v_op, v_p, 'contador')->>'status', 'already_applied',
    'validar es idempotente por op_id');
  perform tests.eq((select count(*)::int from public.product_fiscal_events
                     where product_id = v_p and evento = 'validado'), 1,
    'una sola validación en la bitácora');

  -- La bitácora guarda el ANTES y el DESPUÉS
  perform tests.ok((select antes is not null and despues is not null
                      from public.product_fiscal_events
                     where product_id = v_p and evento = 'editado' limit 1),
    'cada edición guarda el estado anterior y el posterior');
  perform tests.ok((select actor = v_admin and actor_role = 'admin'
                      from public.product_fiscal_events
                     where product_id = v_p and evento = 'validado' limit 1),
    'y quién la hizo, con su rol');
end $t$;
rollback;

-- ── NO-INTERFERENCIA: lo que C1 NO debe poder hacer ─────────────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doctor uuid := tests.user('doctor');
  v_p uuid; v_precio numeric; v_o uuid;
begin
  v_p := tests.producto_cat('Rellenos', 2320);
  perform tests.act_as(v_admin);
  select price into v_precio from public.products where id = v_p;

  -- Ningún comando toca el precio comercial (K-2).
  perform tests.pf_validado(v_p);
  perform public.editar_fiscal_producto(gen_random_uuid(), v_p, jsonb_build_object('notas','x'));
  perform public.invalidar_fiscal_producto(gen_random_uuid(), v_p, 'prueba');
  perform tests.eq((select price from public.products where id = v_p), v_precio,
    'ningún comando fiscal modificó el precio comercial del producto');

  -- Ningún comando crea documentos fiscales ni consume folio.
  perform tests.eq((select count(*)::int from public.fiscal_documents), 0,
    'C1 no creó ningún documento fiscal');
  perform tests.eq((select count(*)::int from public.fiscal_document_events), 0,
    'C1 no tocó la bitácora de documentos fiscales');
  -- El contador de folios no tiene lectura ni para Dirección (cierre más fuerte
  -- de W3-B): se sondea como dueño, igual que tests.sin_efecto.
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.fiscal_folio_domains), 0,
    'C1 no consumió numeración fiscal: el dominio de folios sigue sin existir');
  perform tests.act_as(v_admin);

  -- La emisión real sigue imposible: el timbrado no está habilitado.
  v_o := tests.order(v_doctor, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  perform tests.act_as(v_admin);
  perform tests.ok(not (public.estado_fiscal_pedido(v_o)->>'timbrado_habilitado')::boolean,
    'el timbrado sigue deshabilitado tras C1');

  -- Y C1 no introdujo ninguna bandera capaz de cambiar el significado económico
  -- del catálogo: el precio final es invariante del negocio (K-1).
  perform tests.eq((select count(*)::int from information_schema.columns
                     where table_schema='public' and table_name='company_settings'
                       and column_name ~* 'precio_es_final|precio_incluye'), 0,
    'no existe interruptor que convierta el catálogo en precios sin IVA');
end $t$;
rollback;
