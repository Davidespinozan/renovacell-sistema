-- W3-C · C4-D — Infraestructura de clasificación fiscal.
--
-- Cierra dos deudas que la auditoría C4-A levantó con evidencia, SIN decidir ni un
-- solo impuesto:
--
--   C-1  Los candidatos se proponían por CATEGORÍA, pero la homogeneidad real del
--        catálogo vive en la FAMILIA. "Péptidos" son 112 productos repartidos en
--        Hidrolizados (46 · $1,000 · vial 8 ml), Implantes (40 · $2,400 · 4.5 ML),
--        Ultrafiltrados (20) y ELITE (6). Una propuesta a nivel categoría los
--        trataría a todos igual.
--
--   C-2  El modelo admitía combinaciones estructuralmente contradictorias, como
--        objeto_imp = '01' (no objeto) junto a tratamiento_iva = 'gravado'.
--
-- Lo que este archivo NO hace, y no debe hacer nunca: decidir qué combinación le
-- toca a un producto de Renovacell. Eso sigue siendo del contador.
--
-- Arquitectura elegida: tabla NUEVA, no extensión de la existente. Es la única
-- opción puramente aditiva: no toca `fiscal_category_defaults`, ni su guard, ni sus
-- constraints, ni sus comandos, ni su rollback, ni sus pruebas — todo eso es de una
-- ola ya cerrada en producción. El costo es repetir ocho columnas; el beneficio es
-- cero riesgo sobre C1.

-- ---------------------------------------------------------------------------
-- 1) C-2 · COHERENCIA ENTRE OBJETO DE IMPUESTO Y TRATAMIENTO.
-- ---------------------------------------------------------------------------
-- Es semántica del SAT, no criterio de Renovacell:
--   '01' = NO objeto de impuesto           → el único tratamiento posible es no_objeto
--   '02' = SÍ objeto                        → gravado, tasa cero o exento
--   '03' = SÍ objeto, sin obligación de desglose → mismas tres opciones
-- Con cualquiera de los dos en nulo no se afirma nada: el producto está incompleto
-- y `_pf_faltantes` ya lo reporta.
create function public._pf_objeto_coherente(p_objeto text, p_trat text) returns boolean
  language sql immutable set search_path = public as
$$
  select p_objeto is null or p_trat is null
      or (p_objeto = '01'            and p_trat = 'no_objeto')
      or (p_objeto in ('02','03')    and p_trat in ('gravado','tasa_cero','exento'));
$$;
comment on function public._pf_objeto_coherente(text, text) is
  'Coherencia estructural SAT entre ObjetoImp y tratamiento de IVA. No decide qué le toca a ningún producto: solo impide guardar una combinación que se contradice a sí misma.';

alter table public.product_fiscal
  add constraint ck_pf_objeto_tratamiento
  check (public._pf_objeto_coherente(objeto_imp, tratamiento_iva));

alter table public.fiscal_category_defaults
  add constraint ck_fcd_objeto_tratamiento
  check (public._pf_objeto_coherente(objeto_imp, tratamiento_iva));

-- ---------------------------------------------------------------------------
-- 2) C-1 · CANDIDATOS POR FAMILIA.
-- ---------------------------------------------------------------------------
create table public.fiscal_family_defaults (
  familia         text primary key,
  clave_prod_serv text,
  clave_unidad    text,
  objeto_imp      text,
  tratamiento_iva text,
  iva_tasa        numeric(8,6),
  notas           text,
  definido_por    uuid references auth.users(id) on delete restrict,
  definido_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_ffd_tratamiento check (
    tratamiento_iva is null or tratamiento_iva in ('gravado','tasa_cero','exento','no_objeto')),
  constraint ck_ffd_objeto check (objeto_imp is null or objeto_imp in ('01','02','03')),
  constraint ck_ffd_clave_prod check (clave_prod_serv is null or clave_prod_serv ~ '^[0-9]{8}$'),
  constraint ck_ffd_clave_unidad check (clave_unidad is null or clave_unidad ~ '^[A-Z0-9]{1,3}$'),
  constraint ck_ffd_tasa check (
    tratamiento_iva is null
    or (tratamiento_iva = 'gravado'   and iva_tasa is not null and iva_tasa > 0)
    or (tratamiento_iva = 'tasa_cero' and iva_tasa is not null and iva_tasa = 0)
    or (tratamiento_iva in ('exento','no_objeto') and iva_tasa is null)),
  constraint ck_ffd_objeto_tratamiento check (public._pf_objeto_coherente(objeto_imp, tratamiento_iva))
);
comment on table public.fiscal_family_defaults is
  'Valores CANDIDATOS por familia comercial. Son una propuesta para no teclear lo mismo muchas veces: jamás son autoridad fiscal y jamás validan un producto.';

create function public.fiscal_family_defaults_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;
  if coalesce(current_setting('app.trusted', true), '') <> 'on' then
    raise exception 'FISCAL_DEFAULTS_SOLO_POR_COMANDO: los valores candidatos por familia los define Dirección con su comando.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_ffd_guard before insert or update or delete on public.fiscal_family_defaults
  for each row execute function public.fiscal_family_defaults_guard();

-- ---------------------------------------------------------------------------
-- 3) COMANDOS. Espejo exacto de los de categoría, incluido lo que NO hacen.
-- ---------------------------------------------------------------------------
create function public.definir_defaults_familia(p_op_id uuid, p_familia text, p_cambios jsonb)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_req jsonb; v_prev jsonb; v_desconocidas text[];
begin
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: solo Dirección define los valores candidatos por familia';
  end if;
  if nullif(btrim(coalesce(p_familia, '')), '') is null then raise exception 'FAMILIA_REQUERIDA'; end if;
  select array_agg(k) into v_desconocidas from jsonb_object_keys(coalesce(p_cambios,'{}'::jsonb)) k
   where k <> all (public._pf_campos_materiales() || array['notas']);
  if v_desconocidas is not null then
    raise exception 'CAMPO_FISCAL_DESCONOCIDO: %', array_to_string(v_desconocidas, ', ');
  end if;

  v_req := jsonb_build_object('familia', btrim(p_familia), 'cambios', p_cambios);
  v_prev := public._w3_op_begin(p_op_id, 'pf_default_familia_definido', v_req);
  if v_prev is not null then return v_prev; end if;

  perform set_config('app.trusted', 'on', true);
  insert into public.fiscal_family_defaults (familia) values (btrim(p_familia))
    on conflict (familia) do nothing;
  update public.fiscal_family_defaults d set
    clave_prod_serv = case when p_cambios ? 'clave_prod_serv' then nullif(btrim(p_cambios->>'clave_prod_serv'),'') else d.clave_prod_serv end,
    clave_unidad    = case when p_cambios ? 'clave_unidad'    then nullif(btrim(upper(p_cambios->>'clave_unidad')),'') else d.clave_unidad end,
    objeto_imp      = case when p_cambios ? 'objeto_imp'      then nullif(btrim(p_cambios->>'objeto_imp'),'') else d.objeto_imp end,
    tratamiento_iva = case when p_cambios ? 'tratamiento_iva' then nullif(btrim(p_cambios->>'tratamiento_iva'),'') else d.tratamiento_iva end,
    iva_tasa        = case when p_cambios ? 'iva_tasa'        then (nullif(btrim(p_cambios->>'iva_tasa'),''))::numeric else d.iva_tasa end,
    notas           = case when p_cambios ? 'notas'           then nullif(btrim(p_cambios->>'notas'),'') else d.notas end,
    definido_por = auth.uid(), definido_at = now()
   where d.familia = btrim(p_familia);
  perform set_config('app.trusted', v_trusted, true);

  return public._w3_op_finish(p_op_id, 'pf_default_familia_definido', v_req,
    jsonb_build_object('status', 'applied', 'familia', btrim(p_familia)));
end;
$$;
comment on function public.definir_defaults_familia(uuid, text, jsonb) is
  'Define los valores CANDIDATOS de una familia comercial. Solo Dirección. No valida ni toca producto alguno.';

create function public.aplicar_defaults_familia(p_op_id uuid, p_familia text)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_role text := public._pf_autorizar();
  v_req jsonb; v_prev jsonb; d public.fiscal_family_defaults; v_n int := 0; r record;
begin
  v_req := jsonb_build_object('familia', btrim(coalesce(p_familia, '')));
  v_prev := public._w3_op_begin(p_op_id, 'pf_default_familia_aplicado', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into d from public.fiscal_family_defaults where familia = btrim(p_familia);
  if not found then
    raise exception 'DEFAULTS_FAMILIA_INEXISTENTES: Dirección todavía no definió valores candidatos para "%"', p_familia;
  end if;

  perform set_config('app.trusted', 'on', true);
  for r in select p.id from public.products p
            where coalesce(p.family, '') = btrim(p_familia) and p.sellable
  loop
    insert into public.product_fiscal (product_id) values (r.id) on conflict (product_id) do nothing;
    -- Mismas dos reglas que en categoría: SOLO rellena huecos y SOLO en productos
    -- NO validados. Un candidato no puede pisar ni invalidar una decisión humana.
    -- `objeto_imp`, `tratamiento_iva` y la tasa forman un PAR indivisible: tomar
    -- uno del candidato y dejar el otro del producto puede fabricar una
    -- combinación contradictoria. Se toman los tres juntos, y solo cuando el
    -- producto no tiene ninguno de los dos.
    update public.product_fiscal pf set
      clave_prod_serv = coalesce(pf.clave_prod_serv, d.clave_prod_serv),
      clave_unidad    = coalesce(pf.clave_unidad,    d.clave_unidad),
      objeto_imp      = case when pf.objeto_imp is null and pf.tratamiento_iva is null then d.objeto_imp      else pf.objeto_imp end,
      tratamiento_iva = case when pf.objeto_imp is null and pf.tratamiento_iva is null then d.tratamiento_iva else pf.tratamiento_iva end,
      iva_tasa        = case when pf.objeto_imp is null and pf.tratamiento_iva is null then d.iva_tasa        else pf.iva_tasa end
     where pf.product_id = r.id and not pf.validado;
    if found then
      v_n := v_n + 1;
      insert into public.product_fiscal_events (product_id, evento, despues, motivo, actor, actor_role, op_id)
      values (r.id, 'default_aplicado', public._pf_snapshot(r.id),
              'candidato pre-llenado desde la familia ' || btrim(p_familia) || ' · NO valida',
              auth.uid(), v_role, p_op_id);
    end if;
  end loop;
  perform set_config('app.trusted', v_trusted, true);

  return public._w3_op_finish(p_op_id, 'pf_default_familia_aplicado', v_req, jsonb_build_object(
    'status', 'applied', 'familia', btrim(p_familia), 'productos_prellenados', v_n,
    'validados_por_esta_operacion', 0));
end;
$$;
comment on function public.aplicar_defaults_familia(uuid, text) is
  'Pre-llena huecos de los productos vendibles NO validados de una familia. Nunca valida, nunca pisa un valor existente y nunca toca un producto ya validado. Devuelve validados_por_esta_operacion = 0 siempre, a propósito.';

-- ---------------------------------------------------------------------------
-- 4) AUTORIDAD. Idéntica a la de C1.
-- ---------------------------------------------------------------------------
alter table public.fiscal_family_defaults enable row level security;
revoke all on public.fiscal_family_defaults from anon, authenticated;
grant select on public.fiscal_family_defaults to authenticated;
create policy ffd_select on public.fiscal_family_defaults
  for select to authenticated using (public.auth_role() = any (array['admin','billing']));

revoke all on function public._pf_objeto_coherente(text, text) from public, anon;
grant execute on function public._pf_objeto_coherente(text, text) to authenticated, service_role;
revoke all on function public.fiscal_family_defaults_guard() from public, anon, authenticated;
revoke all on function public.definir_defaults_familia(uuid, text, jsonb) from public, anon;
revoke all on function public.aplicar_defaults_familia(uuid, text) from public, anon;
grant execute on function public.definir_defaults_familia(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.aplicar_defaults_familia(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) COMPUERTA FISCAL DEL PEDIDO (D6).
-- ---------------------------------------------------------------------------
-- Vender NO exige validación fiscal; FACTURAR sí. Hoy no existe ninguna ruta de
-- emisión real (el adaptador del PAC no lo importa nadie y la Edge Function está
-- contenida), así que esta función no bloquea nada todavía: es la ÚNICA fuente de
-- verdad que el futuro constructor del CFDI deberá consultar, para que la respuesta
-- no se reimplemente en tres lugares distintos.
create function public.pedido_fiscalmente_listo(p_order uuid)
returns table (product_id uuid, sku text, nombre text, faltantes text[])
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._pf_autorizar();
  return query
  select p.id, p.sku, p.name,
         case when pf.product_id is null then array['configuración fiscal sin iniciar']
              else public._pf_faltantes(p.id) end
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join public.product_fiscal pf on pf.product_id = p.id
   where oi.order_id = p_order
     and coalesce(pf.validado, false) = false
   group by p.id, p.sku, p.name, pf.product_id
   order by p.name;
end;
$$;
comment on function public.pedido_fiscalmente_listo(uuid) is
  'Productos del pedido que AÚN NO pueden entrar a un CFDI real por falta de validación fiscal humana. Devuelve cero filas cuando el pedido está listo. Solo lectura.';

revoke all on function public.pedido_fiscalmente_listo(uuid) from public, anon;
grant execute on function public.pedido_fiscalmente_listo(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) REGISTRO DE OPERACIONES. `kind` es vocabulario cerrado desde C1: las dos
--    operaciones nuevas tienen que declararse, o la idempotencia no podría
--    registrarse.
-- ---------------------------------------------------------------------------
alter table public.fiscal_operations drop constraint ck_fiscal_op_kind;
alter table public.fiscal_operations add constraint ck_fiscal_op_kind check (kind in (
  'cfdi_solicitado','cfdi_actualizado','cfdi_descartado',
  'cfdi_reclamado','cfdi_timbrado','cfdi_fallido','cfdi_incierto',
  'cfdi_conciliado','cfdi_cancelado',
  'pf_editado','pf_validado','pf_invalidado','pf_default_definido','pf_default_aplicado',
  'pf_candidato',
  'pf_evidencia_importada',
  -- W3-C · C4-D
  'pf_default_familia_definido','pf_default_familia_aplicado'));

-- ---------------------------------------------------------------------------
-- 7) MISMO ARREGLO PARA EL COMANDO POR CATEGORÍA (C1).
-- ---------------------------------------------------------------------------
-- La coherencia que agrega esta ola vuelve ALCANZABLE un hueco que antes pasaba
-- inadvertido: si el producto ya traía `objeto_imp` pero no `tratamiento_iva`,
-- el candidato rellenaba solo el que faltaba y podía dejar una combinación
-- contradictoria. Se reemplaza la función conservando su firma y su contrato.
create or replace function public.aplicar_defaults_categoria(p_op_id uuid, p_categoria text)
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
    update public.product_fiscal pf set
      clave_prod_serv = coalesce(pf.clave_prod_serv, d.clave_prod_serv),
      clave_unidad    = coalesce(pf.clave_unidad,    d.clave_unidad),
      objeto_imp      = case when pf.objeto_imp is null and pf.tratamiento_iva is null then d.objeto_imp      else pf.objeto_imp end,
      tratamiento_iva = case when pf.objeto_imp is null and pf.tratamiento_iva is null then d.tratamiento_iva else pf.tratamiento_iva end,
      iva_tasa        = case when pf.objeto_imp is null and pf.tratamiento_iva is null then d.iva_tasa        else pf.iva_tasa end
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
