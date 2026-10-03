-- W3-C · C1 — LA VALIDACIÓN HUMANA ES LA ÚNICA AUTORIDAD FISCAL.
-- El catálogo real es heterogéneo (Medicamentos y Toxinas junto a Sérum y Aparatología),
-- así que aquí no hay valor de respaldo, ni 16% global, ni clave SAT automática:
-- un producto solo se puede facturar si una persona autorizada lo validó.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing');
  v_p uuid; v_r jsonb;
begin
  v_p := tests.producto_cat('Sérum');
  perform tests.act_as(v_admin);

  -- ── Una configuración INCOMPLETA no se puede validar ──────────────────────
  perform tests.throws(format('select public.validar_fiscal_producto(%L, %L, ''contador'')', gen_random_uuid(), v_p),
    'FISCAL_PRODUCTO_SIN_CONFIGURAR', 'sin configuración no hay nada que validar');

  v_r := public.editar_fiscal_producto(gen_random_uuid(), v_p,
           jsonb_build_object('clave_prod_serv', '51241100'));
  perform tests.eq(v_r->>'status', 'applied', 'se puede editar parcialmente');
  perform tests.eq(jsonb_array_length(v_r->'faltantes'), 4,
    'el comando enumera exactamente los 4 datos que faltan');
  perform tests.throws(format('select public.validar_fiscal_producto(%L, %L, ''contador'')', gen_random_uuid(), v_p),
    'FISCAL_CONFIGURACION_INCOMPLETA', 'una configuración a medias NO se valida');
  perform tests.ok(not (select validado from public.product_fiscal where product_id = v_p),
    'y el producto sigue sin validar');

  -- ── Validar exige FUENTE: de dónde salió la decisión es parte de la decisión
  perform public.editar_fiscal_producto(gen_random_uuid(), v_p, tests.fiscal_completo(v_p));
  perform tests.throws(format('select public.validar_fiscal_producto(%L, %L, ''  '')', gen_random_uuid(), v_p),
    'FUENTE_REQUERIDA', 'validar sin fuente se rechaza');

  -- ── Validación completa ───────────────────────────────────────────────────
  v_r := public.validar_fiscal_producto(gen_random_uuid(), v_p, 'criterio del contador oct-2026');
  perform tests.eq((v_r->>'validado')::boolean, true, 'con la configuración completa sí se valida');
  perform tests.ok((select validado and validado_por = v_admin and validado_at is not null
                      from public.product_fiscal where product_id = v_p),
    'queda registrado QUIÉN validó y cuándo');
  perform tests.eq((select fuente from public.product_fiscal where product_id = v_p),
    'criterio del contador oct-2026', 'y con qué fundamento');

  -- ── FORMA de las claves SAT, por constraint ───────────────────────────────
  perform tests.throws(format($q$select public.editar_fiscal_producto(%L, %L, '{"clave_prod_serv":"512411"}'::jsonb)$q$,
      gen_random_uuid(), v_p), 'ck_pf_clave_prod', 'la clave de producto exige 8 dígitos');
  perform tests.throws(format($q$select public.editar_fiscal_producto(%L, %L, '{"clave_unidad":"PIEZAS"}'::jsonb)$q$,
      gen_random_uuid(), v_p), 'ck_pf_clave_unidad', 'la clave de unidad admite hasta 3 caracteres');
  perform tests.throws_any(format($q$select public.editar_fiscal_producto(%L, %L, '{"objeto_imp":"99"}'::jsonb)$q$,
      gen_random_uuid(), v_p), array['ck_pf_objeto', 'ck_pf_objeto_tratamiento'],
    'el objeto de impuesto es un vocabulario cerrado');

  -- ── COHERENCIA tratamiento ↔ tasa: la confusión más común del CFDI ────────
  perform tests.throws(format($q$select public.editar_fiscal_producto(%L, %L, '{"tratamiento_iva":"gravado","iva_tasa":"0"}'::jsonb)$q$,
      gen_random_uuid(), v_p), 'ck_pf_tasa', 'gravado exige tasa mayor a cero');
  perform tests.throws(format($q$select public.editar_fiscal_producto(%L, %L, '{"tratamiento_iva":"exento","iva_tasa":"0.16"}'::jsonb)$q$,
      gen_random_uuid(), v_p), 'ck_pf_tasa', 'exento no lleva tasa');
  perform tests.throws(format($q$select public.editar_fiscal_producto(%L, %L, '{"tratamiento_iva":"tasa_cero","iva_tasa":"0.16"}'::jsonb)$q$,
      gen_random_uuid(), v_p), 'ck_pf_tasa', 'tasa cero exige exactamente 0');
  -- El orden de evaluación entre constraints no está definido: un tratamiento
  -- inventado viola a la vez el vocabulario y la coherencia con la tasa.
  perform tests.throws_any(format($q$select public.editar_fiscal_producto(%L, %L, '{"tratamiento_iva":"inventado","iva_tasa":"0.16"}'::jsonb)$q$,
      gen_random_uuid(), v_p), array['ck_pf_tratamiento', 'ck_pf_tasa', 'ck_pf_objeto_tratamiento'],
    'el tratamiento de IVA es un vocabulario cerrado');

  -- ── Un campo desconocido se RECHAZA, no se ignora ─────────────────────────
  perform tests.throws(format($q$select public.editar_fiscal_producto(%L, %L, '{"clave_prodserv":"51241100"}'::jsonb)$q$,
      gen_random_uuid(), v_p), 'CAMPO_FISCAL_DESCONOCIDO',
    'un error de tecleo no debe parecer un cambio aplicado');
  perform tests.throws(format($q$select public.editar_fiscal_producto(%L, %L, '{"price":"999"}'::jsonb)$q$,
      gen_random_uuid(), v_p), 'CAMPO_FISCAL_DESCONOCIDO',
    'y el precio comercial no es un campo fiscal editable');
end $t$;
rollback;

-- ── INVALIDACIÓN: cambiar el fondo caduca la validación; documentar, no ─────────────────
begin;
do $t$
declare v_admin uuid := tests.user('admin'); v_p uuid; v_r jsonb; v_at timestamptz;
begin
  v_p := tests.producto_cat('Toxinas');
  perform tests.act_as(v_admin);
  perform tests.pf_validado(v_p);
  select validado_at into v_at from public.product_fiscal where product_id = v_p;

  -- MATERIAL → invalida
  v_r := public.editar_fiscal_producto(gen_random_uuid(), v_p,
           jsonb_build_object('tratamiento_iva', 'tasa_cero', 'iva_tasa', 0));
  perform tests.eq((v_r->>'invalidado_por_el_cambio')::boolean, true,
    'cambiar el tratamiento de IVA CADUCA la validación');
  perform tests.ok(not (select validado from public.product_fiscal where product_id = v_p),
    'el producto queda sin validar');
  perform tests.ok((select validado_por is null and validado_at is null
                      from public.product_fiscal where product_id = v_p),
    'y se borra quién lo había validado: ya no respalda esta configuración');
  perform tests.eq((select count(*)::int from public.product_fiscal_events
                     where product_id = v_p and evento = 'invalidado'), 1,
    'la invalidación queda en la bitácora');

  -- Cada campo material invalida por su cuenta
  declare v_cambio jsonb; v_campo text;
  begin
    foreach v_cambio in array array[
        jsonb_build_object('clave_prod_serv','01010101'),
        jsonb_build_object('clave_unidad','E48'),
        -- '03' y no '01': el producto está en tasa_cero, y 01 (no objeto) con
        -- tasa_cero es contradictorio — la base lo rechaza desde C4-D. Lo que aquí
        -- se prueba es que CAMBIAR objeto_imp invalida, no una combinación imposible.
        jsonb_build_object('objeto_imp','03'),
        jsonb_build_object('descripcion_fiscal','otra descripción')] loop
      perform tests.pf_validado(v_p, 'tasa_cero', 0);
      select string_agg(k, ',') into v_campo from jsonb_object_keys(v_cambio) k;
      perform tests.eq((public.editar_fiscal_producto(gen_random_uuid(), v_p, v_cambio)->>'invalidado_por_el_cambio')::boolean,
        true, 'cambiar ' || v_campo || ' invalida la validación');
    end loop;
  end;

  -- NOTAS y FUENTE solo documentan: NO invalidan
  perform tests.pf_validado(v_p, 'tasa_cero', 0);
  v_r := public.editar_fiscal_producto(gen_random_uuid(), v_p,
           jsonb_build_object('notas', 'revisado con el contador', 'fuente', 'oficio 123'));
  perform tests.eq((v_r->>'invalidado_por_el_cambio')::boolean, false,
    'editar notas y fuente NO invalida: documentan, no deciden');
  perform tests.ok((select validado from public.product_fiscal where product_id = v_p),
    'el producto sigue validado');

  -- Invalidar a mano exige motivo
  perform tests.throws(format('select public.invalidar_fiscal_producto(%L, %L, '' '')', gen_random_uuid(), v_p),
    'MOTIVO_REQUERIDO', 'retirar la validación exige explicar por qué');
  perform tests.eq(public.invalidar_fiscal_producto(gen_random_uuid(), v_p,
                     'el contador reclasificó la familia')->>'estaba_validado', 'true',
    'Dirección puede retirar la validación');
  perform tests.ok(not (select validado from public.product_fiscal where product_id = v_p),
    'y queda sin validar');
end $t$;
rollback;

-- ── DEFAULTS POR CATEGORÍA: pre-llenan, NUNCA autorizan ─────────────────────────────────
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing');
  v_p1 uuid; v_p2 uuid; v_r jsonb;
begin
  v_p1 := tests.producto_cat('Peeling');
  v_p2 := tests.producto_cat('Peeling');
  perform tests.act_as(v_admin);

  perform tests.throws(format('select public.aplicar_defaults_categoria(%L, ''Peeling'')', gen_random_uuid()),
    'DEFAULTS_CATEGORIA_INEXISTENTES', 'no se aplican candidatos que nadie definió');

  perform public.definir_defaults_categoria(gen_random_uuid(), 'Peeling', jsonb_build_object(
    'clave_prod_serv', '53131600', 'clave_unidad', 'H87', 'objeto_imp', '02',
    'tratamiento_iva', 'gravado', 'iva_tasa', 0.160000));

  -- Se valida UNO antes de aplicar, para probar que el candidato no lo pisa.
  perform public.editar_fiscal_producto(gen_random_uuid(), v_p2, tests.fiscal_completo(v_p2));
  perform public.validar_fiscal_producto(gen_random_uuid(), v_p2, 'contador');

  v_r := public.aplicar_defaults_categoria(gen_random_uuid(), 'Peeling');
  perform tests.eq((v_r->>'validados_por_esta_operacion')::int, 0,
    'aplicar candidatos valida CERO productos, por diseño');
  perform tests.eq((select count(*)::int from public.product_fiscal
                     where product_id in (v_p1, v_p2) and validado), 1,
    'solo sigue validado el que una persona validó');
  perform tests.eq((select clave_prod_serv from public.product_fiscal where product_id = v_p1), '53131600',
    'el producto sin validar recibió el candidato');
  perform tests.eq((select clave_prod_serv from public.product_fiscal where product_id = v_p2), '51241100',
    'y el ya validado conserva SU valor: un candidato no pisa una decisión humana');
  perform tests.ok(not (select validado from public.product_fiscal where product_id = v_p1),
    'el pre-llenado NO autoriza a facturar');

  -- Cambiar el default NO altera ni invalida lo ya validado
  perform public.definir_defaults_categoria(gen_random_uuid(), 'Peeling',
    jsonb_build_object('clave_prod_serv', '99999999'));
  perform tests.ok((select validado and clave_prod_serv = '51241100'
                      from public.product_fiscal where product_id = v_p2),
    'cambiar un default no deshace una validación ni toca sus valores');

  -- Definir defaults es de Dirección; aplicarlos también lo puede Facturación
  perform tests.act_as(v_bill);
  perform tests.throws(format($q$select public.definir_defaults_categoria(%L, 'Peeling', '{"objeto_imp":"01"}'::jsonb)$q$,
      gen_random_uuid()), 'NO_AUTORIZADO', 'Facturación no define los candidatos por categoría');
  perform tests.lives(format('select public.aplicar_defaults_categoria(%L, ''Peeling'')', gen_random_uuid()),
    'pero sí puede aplicarlos');
end $t$;
rollback;
