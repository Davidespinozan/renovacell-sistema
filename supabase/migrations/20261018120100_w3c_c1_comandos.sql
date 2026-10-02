-- ============================================================================
-- W3-C · C1 (parte 2) — COMANDOS DEL CATÁLOGO FISCAL.
--
-- Editar se recibe como jsonb y no como una lista de parámetros opcionales: con
-- `default null` sería imposible distinguir "no toques este campo" de "ponlo en
-- nulo", y en una configuración fiscal esa diferencia importa. Solo se aplican
-- las claves PRESENTES, y una clave desconocida se rechaza en vez de ignorarse
-- en silencio —un error de tecleo no debe parecer un cambio aplicado.
--
-- Ningún comando de este archivo:
--   · toca precios comerciales ni el maestro de productos
--   · crea o modifica fiscal_documents
--   · asigna folio fiscal
--   · llama a ningún proveedor
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Campos que SÍ deciden (material) y campos que solo documentan.
-- ---------------------------------------------------------------------------
create function public._pf_campos_materiales() returns text[]
  language sql immutable set search_path = public as
$$ select array['clave_prod_serv','clave_unidad','objeto_imp','tratamiento_iva','iva_tasa','descripcion_fiscal'] $$;

create function public._pf_campos_editables() returns text[]
  language sql immutable set search_path = public as
$$ select public._pf_campos_materiales() || array['notas','fuente'] $$;

-- Qué falta para poder validar. Devuelve etiquetas en español, no nombres de columna.
create function public._pf_faltantes(p_product uuid) returns text[]
  language sql stable security definer set search_path = public as
$$
  select coalesce(array_agg(f.etiqueta order by f.orden), array[]::text[])
    from public.product_fiscal pf,
         lateral (values
           (1, 'clave de producto o servicio (SAT)', pf.clave_prod_serv is null),
           (2, 'clave de unidad (SAT)',              pf.clave_unidad is null),
           (3, 'objeto de impuesto',                 pf.objeto_imp is null),
           (4, 'tratamiento de IVA',                 pf.tratamiento_iva is null),
           (5, 'descripción fiscal',                 nullif(btrim(coalesce(pf.descripcion_fiscal,'')),'') is null)
         ) as f(orden, etiqueta, falta)
   where pf.product_id = p_product and f.falta;
$$;

create function public._pf_snapshot(p_product uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select to_jsonb(x) from (
    select clave_prod_serv, clave_unidad, objeto_imp, tratamiento_iva, iva_tasa,
           descripcion_fiscal, notas, fuente, validado
      from public.product_fiscal where product_id = p_product) x;
$$;

-- Autorización común: Dirección y Facturación trabajan el catálogo fiscal.
create function public._pf_autorizar() returns text
  language plpgsql stable security definer set search_path = public as
$$
declare r text := public.auth_role();
begin
  if not (r = any (array['admin','billing'])
          or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role') then
    raise exception 'NO_AUTORIZADO: solo Dirección o Facturación configura los datos fiscales de los productos';
  end if;
  return coalesce(r, '');
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) EDITAR. Crea la fila si no existía. Si el producto estaba validado y
--    cambia algo material, el trigger lo invalida (K-5).
-- ---------------------------------------------------------------------------
create function public.editar_fiscal_producto(
  p_op_id uuid, p_product_id uuid, p_cambios jsonb, p_motivo text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_role text := public._pf_autorizar();
  v_req jsonb; v_prev jsonb; v_antes jsonb; v_despues jsonb;
  v_k text; v_desconocidas text[];
begin
  if p_product_id is null then raise exception 'PRODUCTO_REQUERIDO'; end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' or p_cambios = '{}'::jsonb then
    raise exception 'SIN_CAMBIOS: indica al menos un campo fiscal a modificar';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'PRODUCTO_INEXISTENTE: ese producto no existe en el catálogo';
  end if;

  -- Una clave desconocida se rechaza: un error de tecleo no debe parecer aplicado.
  select array_agg(k) into v_desconocidas
    from jsonb_object_keys(p_cambios) k
   where k <> all (public._pf_campos_editables());
  if v_desconocidas is not null then
    raise exception 'CAMPO_FISCAL_DESCONOCIDO: % no es un dato fiscal editable', array_to_string(v_desconocidas, ', ');
  end if;

  v_req := jsonb_build_object('product', p_product_id, 'cambios', p_cambios, 'motivo', p_motivo);
  v_prev := public._w3_op_begin(p_op_id, 'pf_editado', v_req);
  if v_prev is not null then return v_prev; end if;

  perform set_config('app.trusted', 'on', true);
  insert into public.product_fiscal (product_id) values (p_product_id)
    on conflict (product_id) do nothing;
  v_antes := public._pf_snapshot(p_product_id);

  update public.product_fiscal pf set
    clave_prod_serv    = case when p_cambios ? 'clave_prod_serv'    then nullif(btrim(p_cambios->>'clave_prod_serv'), '')    else pf.clave_prod_serv end,
    clave_unidad       = case when p_cambios ? 'clave_unidad'       then nullif(btrim(upper(p_cambios->>'clave_unidad')), '') else pf.clave_unidad end,
    objeto_imp         = case when p_cambios ? 'objeto_imp'         then nullif(btrim(p_cambios->>'objeto_imp'), '')         else pf.objeto_imp end,
    tratamiento_iva    = case when p_cambios ? 'tratamiento_iva'    then nullif(btrim(p_cambios->>'tratamiento_iva'), '')    else pf.tratamiento_iva end,
    iva_tasa           = case when p_cambios ? 'iva_tasa'           then (nullif(btrim(p_cambios->>'iva_tasa'), ''))::numeric else pf.iva_tasa end,
    descripcion_fiscal = case when p_cambios ? 'descripcion_fiscal' then nullif(btrim(p_cambios->>'descripcion_fiscal'), '') else pf.descripcion_fiscal end,
    notas              = case when p_cambios ? 'notas'              then nullif(btrim(p_cambios->>'notas'), '')              else pf.notas end,
    fuente             = case when p_cambios ? 'fuente'             then nullif(btrim(p_cambios->>'fuente'), '')             else pf.fuente end
   where pf.product_id = p_product_id;
  perform set_config('app.trusted', v_trusted, true);

  v_despues := public._pf_snapshot(p_product_id);
  insert into public.product_fiscal_events (product_id, evento, antes, despues, motivo, actor, actor_role, op_id)
  values (p_product_id, 'editado', v_antes, v_despues, p_motivo, auth.uid(), v_role, p_op_id);

  return public._w3_op_finish(p_op_id, 'pf_editado', v_req, jsonb_build_object(
    'status', 'applied', 'product_id', p_product_id,
    'validado', (v_despues->>'validado')::boolean,
    'invalidado_por_el_cambio', (v_antes->>'validado')::boolean and not (v_despues->>'validado')::boolean,
    'faltantes', public._pf_faltantes(p_product_id)));
end;
$$;
comment on function public.editar_fiscal_producto(uuid, uuid, jsonb, text) is
  'Edita la configuración fiscal de un producto. Solo aplica las claves presentes en p_cambios; una clave desconocida se rechaza. Si el producto estaba validado y cambia un dato material, la validación caduca automáticamente.';

-- ---------------------------------------------------------------------------
-- 2) VALIDAR. El acto humano que materializa la autoridad. Exige fuente: de
--    dónde salió la decisión es parte de la decisión.
-- ---------------------------------------------------------------------------
create function public.validar_fiscal_producto(
  p_op_id uuid, p_product_id uuid, p_fuente text, p_notas text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_role text := public._pf_autorizar();
  v_req jsonb; v_prev jsonb; v_faltan text[]; v_antes jsonb;
begin
  if nullif(btrim(coalesce(p_fuente, '')), '') is null then
    raise exception 'FUENTE_REQUERIDA: indica en qué te basas para validar (criterio del contador, oficio, catálogo SAT)';
  end if;
  v_req := jsonb_build_object('product', p_product_id, 'fuente', btrim(p_fuente), 'notas', p_notas);
  v_prev := public._w3_op_begin(p_op_id, 'pf_validado', v_req);
  if v_prev is not null then return v_prev; end if;

  if not exists (select 1 from public.product_fiscal where product_id = p_product_id) then
    raise exception 'FISCAL_PRODUCTO_SIN_CONFIGURAR: todavía no hay datos fiscales que validar para ese producto';
  end if;

  v_faltan := public._pf_faltantes(p_product_id);
  if array_length(v_faltan, 1) > 0 then
    raise exception 'FISCAL_CONFIGURACION_INCOMPLETA: falta %', array_to_string(v_faltan, ', ');
  end if;

  v_antes := public._pf_snapshot(p_product_id);
  perform set_config('app.trusted', 'on', true);
  update public.product_fiscal
     set validado = true, validado_por = auth.uid(), validado_at = now(),
         fuente = btrim(p_fuente),
         notas = coalesce(nullif(btrim(coalesce(p_notas, '')), ''), notas)
   where product_id = p_product_id;
  perform set_config('app.trusted', v_trusted, true);

  insert into public.product_fiscal_events (product_id, evento, antes, despues, motivo, actor, actor_role, op_id)
  values (p_product_id, 'validado', v_antes, public._pf_snapshot(p_product_id),
          btrim(p_fuente), auth.uid(), v_role, p_op_id);

  return public._w3_op_finish(p_op_id, 'pf_validado', v_req,
    jsonb_build_object('status', 'applied', 'product_id', p_product_id, 'validado', true));
end;
$$;
comment on function public.validar_fiscal_producto(uuid, uuid, text, text) is
  'ÚNICA vía que pone validado=true. Exige configuración completa y una fuente. Es el acto humano que autoriza a facturar ese producto: no existe validación en lote por diseño.';

-- ---------------------------------------------------------------------------
-- 3) INVALIDAR. Cierra la compuerta a mano, con motivo.
-- ---------------------------------------------------------------------------
create function public.invalidar_fiscal_producto(p_op_id uuid, p_product_id uuid, p_motivo text)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_role text := public._pf_autorizar();
  v_req jsonb; v_prev jsonb; v_antes jsonb; v_estaba boolean;
begin
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: explica por qué se retira la validación';
  end if;
  v_req := jsonb_build_object('product', p_product_id, 'motivo', btrim(p_motivo));
  v_prev := public._w3_op_begin(p_op_id, 'pf_invalidado', v_req);
  if v_prev is not null then return v_prev; end if;

  select validado into v_estaba from public.product_fiscal where product_id = p_product_id;
  if v_estaba is null then
    raise exception 'FISCAL_PRODUCTO_SIN_CONFIGURAR: ese producto no tiene configuración fiscal';
  end if;
  v_antes := public._pf_snapshot(p_product_id);

  perform set_config('app.trusted', 'on', true);
  update public.product_fiscal set validado = false, validado_por = null, validado_at = null
   where product_id = p_product_id;
  perform set_config('app.trusted', v_trusted, true);

  insert into public.product_fiscal_events (product_id, evento, antes, despues, motivo, actor, actor_role, op_id)
  values (p_product_id, 'invalidado', v_antes, public._pf_snapshot(p_product_id),
          btrim(p_motivo), auth.uid(), v_role, p_op_id);

  return public._w3_op_finish(p_op_id, 'pf_invalidado', v_req, jsonb_build_object(
    'status', 'applied', 'product_id', p_product_id, 'estaba_validado', v_estaba, 'validado', false));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) DEFAULTS POR CATEGORÍA. Definirlos es de Dirección; aplicarlos solo
--    PRE-LLENA huecos de productos NO validados, y jamás valida (K-3).
-- ---------------------------------------------------------------------------
create function public.definir_defaults_categoria(p_op_id uuid, p_categoria text, p_cambios jsonb)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_req jsonb; v_prev jsonb; v_desconocidas text[];
begin
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: solo Dirección define los valores candidatos por categoría';
  end if;
  if nullif(btrim(coalesce(p_categoria, '')), '') is null then raise exception 'CATEGORIA_REQUERIDA'; end if;
  select array_agg(k) into v_desconocidas from jsonb_object_keys(coalesce(p_cambios,'{}'::jsonb)) k
   where k <> all (public._pf_campos_materiales() || array['notas']);
  if v_desconocidas is not null then
    raise exception 'CAMPO_FISCAL_DESCONOCIDO: %', array_to_string(v_desconocidas, ', ');
  end if;

  v_req := jsonb_build_object('categoria', btrim(p_categoria), 'cambios', p_cambios);
  v_prev := public._w3_op_begin(p_op_id, 'pf_default_definido', v_req);
  if v_prev is not null then return v_prev; end if;

  perform set_config('app.trusted', 'on', true);
  insert into public.fiscal_category_defaults (categoria) values (btrim(p_categoria))
    on conflict (categoria) do nothing;
  update public.fiscal_category_defaults d set
    clave_prod_serv = case when p_cambios ? 'clave_prod_serv' then nullif(btrim(p_cambios->>'clave_prod_serv'),'') else d.clave_prod_serv end,
    clave_unidad    = case when p_cambios ? 'clave_unidad'    then nullif(btrim(upper(p_cambios->>'clave_unidad')),'') else d.clave_unidad end,
    objeto_imp      = case when p_cambios ? 'objeto_imp'      then nullif(btrim(p_cambios->>'objeto_imp'),'') else d.objeto_imp end,
    tratamiento_iva = case when p_cambios ? 'tratamiento_iva' then nullif(btrim(p_cambios->>'tratamiento_iva'),'') else d.tratamiento_iva end,
    iva_tasa        = case when p_cambios ? 'iva_tasa'        then (nullif(btrim(p_cambios->>'iva_tasa'),''))::numeric else d.iva_tasa end,
    notas           = case when p_cambios ? 'notas'           then nullif(btrim(p_cambios->>'notas'),'') else d.notas end,
    definido_por = auth.uid(), definido_at = now()
   where d.categoria = btrim(p_categoria);
  perform set_config('app.trusted', v_trusted, true);

  return public._w3_op_finish(p_op_id, 'pf_default_definido', v_req,
    jsonb_build_object('status', 'applied', 'categoria', btrim(p_categoria)));
end;
$$;

create function public.aplicar_defaults_categoria(p_op_id uuid, p_categoria text)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_role text := public._pf_autorizar();
  v_req jsonb; v_prev jsonb; d public.fiscal_category_defaults; v_n int := 0; r record;
begin
  v_req := jsonb_build_object('categoria', btrim(coalesce(p_categoria, '')));
  v_prev := public._w3_op_begin(p_op_id, 'pf_default_aplicado', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into d from public.fiscal_category_defaults where categoria = btrim(p_categoria);
  if not found then
    raise exception 'DEFAULTS_CATEGORIA_INEXISTENTES: Dirección todavía no definió valores candidatos para "%"', p_categoria;
  end if;

  perform set_config('app.trusted', 'on', true);
  for r in select p.id from public.products p
            where coalesce(p.category, '') = btrim(p_categoria) and p.sellable
  loop
    insert into public.product_fiscal (product_id) values (r.id) on conflict (product_id) do nothing;
    -- SOLO rellena huecos, y SOLO en productos NO validados: un candidato no
    -- puede pisar ni invalidar una decisión humana (K-3).
    update public.product_fiscal pf set
      clave_prod_serv = coalesce(pf.clave_prod_serv, d.clave_prod_serv),
      clave_unidad    = coalesce(pf.clave_unidad,    d.clave_unidad),
      objeto_imp      = coalesce(pf.objeto_imp,      d.objeto_imp),
      tratamiento_iva = coalesce(pf.tratamiento_iva, d.tratamiento_iva),
      iva_tasa        = case when pf.tratamiento_iva is null then d.iva_tasa else pf.iva_tasa end
     where pf.product_id = r.id and not pf.validado;
    if found then
      v_n := v_n + 1;
      insert into public.product_fiscal_events (product_id, evento, despues, motivo, actor, actor_role, op_id)
      values (r.id, 'default_aplicado', public._pf_snapshot(r.id),
              'candidato pre-llenado desde la categoría ' || btrim(p_categoria) || ' · NO valida',
              auth.uid(), v_role, p_op_id);
    end if;
  end loop;
  perform set_config('app.trusted', v_trusted, true);

  return public._w3_op_finish(p_op_id, 'pf_default_aplicado', v_req, jsonb_build_object(
    'status', 'applied', 'categoria', btrim(p_categoria), 'productos_prellenados', v_n,
    'validados_por_esta_operacion', 0));
end;
$$;
comment on function public.aplicar_defaults_categoria(uuid, text) is
  'Pre-llena huecos de los productos vendibles NO validados de una categoría. Nunca valida, nunca pisa un valor existente y nunca toca un producto ya validado. Devuelve validados_por_esta_operacion = 0 siempre, a propósito.';

-- ---------------------------------------------------------------------------
-- 5) LECTURA para la pantalla de revisión (la UI es C3; el dato ya existe).
-- ---------------------------------------------------------------------------
create function public.estado_validacion_fiscal()
returns table (
  product_id uuid, sku text, nombre text, categoria text, unidad_comercial text,
  precio_final numeric, clave_prod_serv text, clave_unidad text, objeto_imp text,
  tratamiento_iva text, iva_tasa numeric, descripcion_fiscal text,
  validado boolean, validado_at timestamptz, validado_por_nombre text,
  evidencia_historica text, precio_historico numeric, precio_publicado numeric,
  faltantes text[], advertencias text[])
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._pf_autorizar();
  return query
  select p.id, p.sku, p.name, p.category, p.unit, p.price,
         pf.clave_prod_serv, pf.clave_unidad, pf.objeto_imp, pf.tratamiento_iva,
         pf.iva_tasa, pf.descripcion_fiscal,
         coalesce(pf.validado, false), pf.validado_at, pr.full_name,
         pf.evidencia_historica, pf.precio_historico, pf.precio_publicado,
         case when pf.product_id is null then array['configuración fiscal sin iniciar']
              else public._pf_faltantes(p.id) end,
         (select coalesce(array_agg(a.texto), array[]::text[]) from (values
            ('sin unidad comercial: no hay de dónde derivar la clave de unidad', p.unit is null),
            ('la evidencia de precio NO reconcilia con la lista publicada',      pf.evidencia_historica = 'HISTORICAL_MISMATCH'),
            ('sin referencia en la lista pública: no hay candidato de precio',   pf.evidencia_historica = 'NO_PUBLIC_REFERENCE'),
            -- K-4: el aviso más importante de la pantalla.
            ('el precio histórico coincide con el final: eso NO significa exento ni tasa cero',
                                                                                 pf.evidencia_historica = 'HISTORICAL_EQUALS_FINAL'),
            ('sin categoría: no hay candidatos por categoría que aplicar',        p.category is null)
          ) as a(texto, aplica) where a.aplica)
    from public.products p
    left join public.product_fiscal pf on pf.product_id = p.id
    left join public.profiles pr on pr.id = pf.validado_por
   where p.sellable
   order by coalesce(pf.validado, false), p.category nulls first, p.name;
end;
$$;
comment on function public.estado_validacion_fiscal() is
  'Hoja de trabajo de la revisión fiscal: estado, faltantes y advertencias por producto vendible. Solo lectura.';

-- ---------------------------------------------------------------------------
-- 6) AUTORIDAD.
-- ---------------------------------------------------------------------------
revoke all on function
  public._pf_campos_materiales(), public._pf_campos_editables(),
  public._pf_faltantes(uuid), public._pf_snapshot(uuid), public._pf_autorizar(),
  public.product_fiscal_guard(), public.fiscal_category_defaults_guard()
  from public, anon, authenticated;

revoke all on function public.editar_fiscal_producto(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.validar_fiscal_producto(uuid, uuid, text, text) from public, anon;
revoke all on function public.invalidar_fiscal_producto(uuid, uuid, text) from public, anon;
revoke all on function public.definir_defaults_categoria(uuid, text, jsonb) from public, anon;
revoke all on function public.aplicar_defaults_categoria(uuid, text) from public, anon;
revoke all on function public.estado_validacion_fiscal() from public, anon;

grant execute on function public.editar_fiscal_producto(uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.validar_fiscal_producto(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.invalidar_fiscal_producto(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.definir_defaults_categoria(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.aplicar_defaults_categoria(uuid, text) to authenticated, service_role;
grant execute on function public.estado_validacion_fiscal() to authenticated, service_role;
