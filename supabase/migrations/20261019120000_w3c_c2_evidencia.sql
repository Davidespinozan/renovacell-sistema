-- ============================================================================
-- W3-C · C2 — EVIDENCIA HISTÓRICA DE PRECIO. Evidencia, no autoridad fiscal.
--
-- Qué se importa: la reconciliación ya hecha entre el Excel comercial histórico y
-- el listado público de México de septiembre 2026. 190 filas analizadas, de las
-- cuales 182 tienen referencia pública directa o a nivel de familia.
--
-- LO QUE ESTAS CLASIFICACIONES SIGNIFICAN — y lo que NO:
--   HISTORICAL_BASE_PLUS_16   el precio histórico × 1.16 ≈ el publicado
--   HISTORICAL_EQUALS_FINAL   el precio histórico = el publicado
--   HISTORICAL_MISMATCH       ninguna de las dos relaciones reconcilia
--   NO_PUBLIC_REFERENCE       sin referencia identificable en el listado público
--
-- Clasifican EVIDENCIA DE PRECIO. No son clasificaciones de impuesto. De ellas
-- NUNCA se deduce ObjetoImp, gravado, tasa cero, exento, no objeto, tasa de IVA,
-- ClaveProdServ ni ClaveUnidad. En particular:
--
--   HISTORICAL_EQUALS_FINAL  ≠  exento
--     La aritmética no distingue "el Excel ya traía el precio final" de "este
--     producto no es gravado al 16%". Ambas explicaciones encajan igual. Eso lo
--     resuelve el contador, no un cálculo.
--   HISTORICAL_BASE_PLUS_16  ≠  tratamiento de IVA al 16% autorizado
--     Que el precio publicado incluya 16% es evidencia sobre el PRECIO, no una
--     autorización fiscal del producto.
--
-- PRINCIPIOS:
--   L-1 La evidencia es SUBORDINADA a la autoridad humana. Importar evidencia
--       sobre un producto ya validado deja su configuración fiscal intacta.
--   L-2 Nada de emparejamiento difuso en tiempo de ejecución. El mapeo de fila
--       origen → producto canónico viene REVISADO en la carga. Lo que no se pudo
--       mapear se conserva como evidencia sin resolver, y se reporta.
--   L-3 La evidencia original NUNCA se pierde: una fila por fila de origen, en
--       una tabla append-only aparte, para no sobrecargar la fila de autoridad.
--   L-4 Se preserva si la evidencia vino de una coincidencia DIRECTA o a nivel de
--       FAMILIA. El listado público trae entradas familiares (Hidrolizados,
--       Implantes, Ultrafiltrados, ELITE, Golden Placenta, Xelaju AH) bajo las
--       que el Excel puede tener varios SKU: no se finge que existía una fila
--       publicada independiente por SKU cuando no existía.
--   L-5 INVARIANTE DURO: tras importar la reconciliación completa,
--       count(product_fiscal where validado) = 0.
--
-- C2 no toca precios comerciales, ni reglas de volumen, ni precio_de(), ni
-- order_items.unit_price. No crea documentos fiscales, no asigna folio, no llama
-- a ningún proveedor y no habilita emisión.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) EVIDENCIA POR FILA DE ORIGEN — append-only (L-3).
--    Una fila aquí = una fila del Excel reconciliado, mapeada o no.
-- ---------------------------------------------------------------------------
create table public.fiscal_price_evidence (
  id                uuid primary key default gen_random_uuid(),
  import_op_id      uuid not null,
  source_ref        text not null,
  source_nombre     text not null,
  source_referencia text,
  precio_historico  numeric,
  precio_publicado  numeric,
  clasificacion     text not null,
  procedencia       text,
  familia_publicada text,
  product_id        uuid references public.products(id) on delete restrict,
  mapeo_estado      text not null,
  mapeo_metodo      text,
  mapeo_motivo      text,
  actor             uuid,
  actor_role        text not null default '',
  created_at        timestamptz not null default clock_timestamp(),

  constraint ck_fpe_clasificacion check (clasificacion in
    ('HISTORICAL_BASE_PLUS_16','HISTORICAL_EQUALS_FINAL','HISTORICAL_MISMATCH','NO_PUBLIC_REFERENCE')),
  constraint ck_fpe_procedencia check (procedencia is null or procedencia in ('DIRECT_MATCH','FAMILY_LEVEL_MATCH')),
  constraint ck_fpe_mapeo check (mapeo_estado in ('MAPEADO','NO_MAPEADO')),
  -- Vocabulario cerrado de métodos deterministas. Un mapeo declara CÓMO se decidió.
  constraint ck_fpe_metodo check (mapeo_metodo is null or mapeo_metodo in
    ('NOMBRE+REFERENCIA','NOMBRE_NORMALIZADO','REFERENCIA_ODOO','AGRUPACION_PUBLICADA','FAMILIA_DETERMINISTA')),
  constraint ck_fpe_metodo_presente check (mapeo_estado <> 'MAPEADO' or mapeo_metodo is not null),
  -- Un mapeo exige producto Y procedencia: no se puede afirmar una coincidencia
  -- sin decir CÓMO se obtuvo (L-4).
  -- `procedencia` describe cómo se relacionó la evidencia con la LISTA PÚBLICA, no cómo
  -- se identificó el producto. Para una fila SIN referencia pública no existe procedencia
  -- aunque el producto sí se haya identificado canónicamente: exigirla obligaría a
  -- declarar una evidencia pública que no existe.
  constraint ck_fpe_mapeo_coherente check (
    (mapeo_estado = 'MAPEADO' and product_id is not null
       and (procedencia is not null or clasificacion = 'NO_PUBLIC_REFERENCE'))
    or (mapeo_estado = 'NO_MAPEADO' and product_id is null)),
  -- Lo que no se mapeó explica por qué.
  constraint ck_fpe_motivo check (mapeo_estado = 'MAPEADO' or nullif(btrim(coalesce(mapeo_motivo,'')),'') is not null),
  -- Una familia solo tiene sentido en una coincidencia familiar.
  constraint ck_fpe_familia check (procedencia <> 'FAMILY_LEVEL_MATCH' or nullif(btrim(coalesce(familia_publicada,'')),'') is not null),
  -- Sin referencia pública no hay precio publicado que comparar.
  constraint ck_fpe_sin_referencia check (clasificacion <> 'NO_PUBLIC_REFERENCE' or precio_publicado is null),
  -- Idempotencia dentro de una misma importación.
  constraint uq_fpe_op_source unique (import_op_id, source_ref)
);
comment on table public.fiscal_price_evidence is
  'Evidencia histórica de PRECIO, una fila por fila de origen reconciliada. Append-only: la evidencia original nunca se pierde ni se reescribe. NO es autoridad fiscal: de estas clasificaciones no se deduce ningún dato de impuesto.';
comment on column public.fiscal_price_evidence.clasificacion is
  'Clasificación de la evidencia de PRECIO. HISTORICAL_EQUALS_FINAL no significa exento; HISTORICAL_BASE_PLUS_16 no autoriza un tratamiento de IVA al 16%.';
comment on column public.fiscal_price_evidence.procedencia is
  'DIRECT_MATCH o FAMILY_LEVEL_MATCH (L-4). El listado público trae entradas familiares bajo las que el Excel puede tener varios SKU; la procedencia evita fingir que había una fila publicada por SKU.';
comment on column public.fiscal_price_evidence.mapeo_metodo is
  'Método determinista con el que se identificó el producto canónico. Es evidencia por derecho propio: permite auditar por qué una fila quedó ligada a un producto, y revisar en bloque los mapeos hechos por el método más débil.';
comment on column public.fiscal_price_evidence.mapeo_estado is
  'MAPEADO solo cuando la carga trae un product_id REVISADO. NO_MAPEADO conserva la evidencia con su motivo: no se inventa un producto.';

create index idx_fpe_product on public.fiscal_price_evidence(product_id) where product_id is not null;
create index idx_fpe_clasificacion on public.fiscal_price_evidence(clasificacion);
create index idx_fpe_sin_mapear on public.fiscal_price_evidence(mapeo_estado) where mapeo_estado = 'NO_MAPEADO';

create trigger trg_fpe_append_only before update or delete on public.fiscal_price_evidence
  for each row execute function public.ledger_append_only();
create trigger trg_fpe_no_truncate before truncate on public.fiscal_price_evidence
  for each statement execute function public.ledger_append_only();

-- ---------------------------------------------------------------------------
-- 2) PROYECCIÓN mínima sobre la fila de autoridad. C1 ya trae evidencia_historica,
--    precio_historico y precio_publicado; solo falta la procedencia, que C3
--    necesita mostrar. El detalle completo vive en la tabla de evidencia.
-- ---------------------------------------------------------------------------
alter table public.product_fiscal add column evidencia_procedencia text;
alter table public.product_fiscal add constraint ck_pf_procedencia
  check (evidencia_procedencia is null or evidencia_procedencia in ('DIRECT_MATCH','FAMILY_LEVEL_MATCH'));
comment on column public.product_fiscal.evidencia_procedencia is
  'Si la evidencia proyectada vino de una coincidencia directa o a nivel de familia. El historial completo está en fiscal_price_evidence.';

-- ---------------------------------------------------------------------------
-- 3) Vocabulario de operaciones y RLS.
-- ---------------------------------------------------------------------------
alter table public.fiscal_operations drop constraint ck_fiscal_op_kind;
alter table public.fiscal_operations add constraint ck_fiscal_op_kind check (kind in (
  'cfdi_solicitado','cfdi_actualizado','cfdi_descartado',
  'cfdi_reclamado','cfdi_timbrado','cfdi_fallido','cfdi_incierto',
  'cfdi_conciliado','cfdi_cancelado',
  'pf_editado','pf_validado','pf_invalidado','pf_default_definido','pf_default_aplicado',
  'pf_candidato',
  -- W3-C · C2
  'pf_evidencia_importada'));

alter table public.fiscal_price_evidence enable row level security;
revoke all on public.fiscal_price_evidence from anon, authenticated;
grant select on public.fiscal_price_evidence to authenticated;
create policy fpe_select on public.fiscal_price_evidence
  for select to authenticated using (public.auth_role() = any (array['admin','billing']));

create function public.fiscal_price_evidence_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;
  if coalesce(current_setting('app.trusted', true), '') <> 'on' then
    raise exception 'FISCAL_EVIDENCIA_SOLO_POR_COMANDO: la evidencia histórica se carga con el comando de importación, no escribiendo la tabla.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_fpe_guard before insert on public.fiscal_price_evidence
  for each row execute function public.fiscal_price_evidence_guard();

-- ---------------------------------------------------------------------------
-- 4) IMPORTACIÓN. No empareja: recibe el mapeo ya revisado (L-2).
-- ---------------------------------------------------------------------------
create function public.importar_evidencia_precios(p_op_id uuid, p_filas jsonb)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_role text; v_req jsonb; v_prev jsonb; f jsonb; v_pid uuid;
  v_desconocidas text[]; v_claves text[] := array[
    'source_ref','source_nombre','source_referencia','precio_historico','precio_publicado',
    'clasificacion','procedencia','familia_publicada','product_id','mapeo_metodo','mapeo_motivo'];
  v_n int := 0; v_map int := 0; v_sin int := 0; v_igual int := 0; v_prod int := 0;
  v_ultima jsonb; v_sin_mapear jsonb := '[]'::jsonb;
  v_clas jsonb := '{}'::jsonb; v_proc jsonb := '{}'::jsonb; v_k text;
begin
  -- Solo Dirección carga evidencia histórica: define el punto de partida del
  -- trabajo fiscal de todo el catálogo.
  if public.auth_role() <> 'admin'
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') <> 'service_role' then
    raise exception 'NO_AUTORIZADO: solo Dirección importa la evidencia histórica de precios';
  end if;
  v_role := coalesce(public.auth_role(), '');

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'EVIDENCIA_VACIA: no hay filas que importar';
  end if;

  v_req := jsonb_build_object('filas', jsonb_array_length(p_filas),
             'huella', md5(p_filas::text));
  v_prev := public._w3_op_begin(p_op_id, 'pf_evidencia_importada', v_req);
  if v_prev is not null then return v_prev; end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    select array_agg(k) into v_desconocidas from jsonb_object_keys(f) k where k <> all (v_claves);
    if v_desconocidas is not null then
      raise exception 'EVIDENCIA_CAMPO_DESCONOCIDO: % en la fila %', array_to_string(v_desconocidas, ', '), coalesce(f->>'source_ref','(sin ref)');
    end if;
    if nullif(btrim(coalesce(f->>'source_ref','')),'') is null
       or nullif(btrim(coalesce(f->>'source_nombre','')),'') is null then
      raise exception 'EVIDENCIA_ORIGEN_REQUERIDO: cada fila lleva su identificador y su nombre histórico';
    end if;

    v_pid := nullif(btrim(coalesce(f->>'product_id','')),'')::uuid;
    if v_pid is not null and not exists (select 1 from public.products where id = v_pid) then
      raise exception 'PRODUCTO_INEXISTENTE: la fila % apunta a un producto que no existe', f->>'source_ref';
    end if;

    -- Re-importación: si la última evidencia de esa fila de origen es idéntica,
    -- no se duplica. Si cambió, se agrega una observación nueva (append-only).
    select to_jsonb(x) into v_ultima from (
      select clasificacion, procedencia, familia_publicada, precio_historico, precio_publicado,
             product_id, mapeo_estado, mapeo_metodo, mapeo_motivo, source_referencia, source_nombre
        from public.fiscal_price_evidence
       where source_ref = f->>'source_ref' order by created_at desc, id desc limit 1) x;

    if v_ultima is not null
       and v_ultima->>'clasificacion'  is not distinct from f->>'clasificacion'
       and v_ultima->>'procedencia'    is not distinct from f->>'procedencia'
       and v_ultima->>'product_id'     is not distinct from f->>'product_id'
       and v_ultima->>'precio_historico' is not distinct from f->>'precio_historico'
       and v_ultima->>'precio_publicado' is not distinct from f->>'precio_publicado' then
      v_igual := v_igual + 1;
      continue;
    end if;

    perform set_config('app.trusted', 'on', true);
    insert into public.fiscal_price_evidence (import_op_id, source_ref, source_nombre, source_referencia,
           precio_historico, precio_publicado, clasificacion, procedencia, familia_publicada,
           product_id, mapeo_estado, mapeo_metodo, mapeo_motivo, actor, actor_role)
    values (p_op_id, btrim(f->>'source_ref'), btrim(f->>'source_nombre'),
            nullif(btrim(coalesce(f->>'source_referencia','')),''),
            (nullif(btrim(coalesce(f->>'precio_historico','')),''))::numeric,
            (nullif(btrim(coalesce(f->>'precio_publicado','')),''))::numeric,
            f->>'clasificacion', nullif(btrim(coalesce(f->>'procedencia','')),''),
            nullif(btrim(coalesce(f->>'familia_publicada','')),''),
            v_pid,
            case when v_pid is null then 'NO_MAPEADO' else 'MAPEADO' end,
            nullif(btrim(coalesce(f->>'mapeo_metodo','')),''),
            nullif(btrim(coalesce(f->>'mapeo_motivo','')),''),
            auth.uid(), v_role);
    perform set_config('app.trusted', v_trusted, true);

    v_n := v_n + 1;
    v_k := f->>'clasificacion';
    v_clas := jsonb_set(v_clas, array[v_k], to_jsonb(coalesce((v_clas->>v_k)::int, 0) + 1), true);

    if v_pid is null then
      v_sin := v_sin + 1;
      v_sin_mapear := v_sin_mapear || jsonb_build_object(
        'source_ref', f->>'source_ref', 'source_nombre', f->>'source_nombre',
        'clasificacion', v_k, 'motivo', f->>'mapeo_motivo');
    else
      v_map := v_map + 1;
      v_k := coalesce(f->>'procedencia', '(sin procedencia)');
      v_proc := jsonb_set(v_proc, array[v_k], to_jsonb(coalesce((v_proc->>v_k)::int, 0) + 1), true);

      -- PROYECCIÓN sobre la fila de autoridad. Crea la fila si no existía, SIEMPRE
      -- con validado = false, y jamás toca un campo fiscal ni una validación humana
      -- (L-1). La evidencia es subordinada: de la aritmética no sale ningún impuesto.
      perform set_config('app.trusted', 'on', true);
      insert into public.product_fiscal (product_id) values (v_pid) on conflict (product_id) do nothing;
      update public.product_fiscal set
        evidencia_historica   = f->>'clasificacion',
        evidencia_procedencia = nullif(btrim(coalesce(f->>'procedencia','')),''),
        precio_historico      = (nullif(btrim(coalesce(f->>'precio_historico','')),''))::numeric,
        precio_publicado      = (nullif(btrim(coalesce(f->>'precio_publicado','')),''))::numeric
       where product_id = v_pid;
      perform set_config('app.trusted', v_trusted, true);
      v_prod := v_prod + 1;

      insert into public.product_fiscal_events (product_id, evento, despues, motivo, actor, actor_role, op_id)
      values (v_pid, 'candidato',
              jsonb_build_object('evidencia', f->>'clasificacion', 'procedencia', f->>'procedencia',
                                 'source_ref', f->>'source_ref'),
              'evidencia histórica de PRECIO importada · NO autoriza ningún tratamiento fiscal',
              auth.uid(), v_role, p_op_id);
    end if;
  end loop;

  return public._w3_op_finish(p_op_id, 'pf_evidencia_importada', v_req, jsonb_build_object(
    'status', 'applied',
    'filas_recibidas', jsonb_array_length(p_filas),
    'filas_registradas', v_n,
    'filas_sin_cambio', v_igual,
    'mapeadas', v_map,
    'sin_mapear', v_sin,
    'productos_afectados', v_prod,
    'por_clasificacion', v_clas,
    'por_procedencia', v_proc,
    'detalle_sin_mapear', v_sin_mapear,
    -- L-5, declarado en el propio resultado de la importación.
    'validados_por_esta_importacion', 0,
    'validados_en_total', (select count(*) from public.product_fiscal where validado)));
end;
$$;
comment on function public.importar_evidencia_precios(uuid, jsonb) is
  'Importa la reconciliación histórica como EVIDENCIA DE PRECIO. No empareja productos: recibe el mapeo ya revisado. Nunca valida, nunca escribe un campo fiscal y nunca pisa una validación humana. Lo que no se pudo mapear se conserva con su motivo y se reporta.';

-- ---------------------------------------------------------------------------
-- 5) LECTURA de las excepciones de mayor revisión, sin enterrarlas en "pendiente".
-- ---------------------------------------------------------------------------
create function public.excepciones_evidencia_fiscal()
returns table (clasificacion text, procedencia text, mapeo_estado text,
               filas bigint, productos bigint, advertencia text)
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._pf_autorizar();
  return query
  select e.clasificacion, coalesce(e.procedencia, '(sin mapeo)'), e.mapeo_estado,
         count(*), count(distinct e.product_id),
         case e.clasificacion
           when 'HISTORICAL_EQUALS_FINAL' then 'el precio histórico coincide con el final: eso NO significa exento, tasa cero ni no objeto. La aritmética no distingue "el Excel ya traía el final" de "no es gravado al 16%"'
           when 'HISTORICAL_MISMATCH'     then 'la evidencia de precio NO reconcilia con el listado publicado: no hay candidato en el que apoyarse'
           when 'NO_PUBLIC_REFERENCE'     then 'sin referencia en el listado público: no hay precio publicado que comparar'
           when 'HISTORICAL_BASE_PLUS_16' then 'el precio publicado parece incluir 16%: es evidencia sobre el PRECIO, no una autorización de tratamiento fiscal'
         end
    from public.fiscal_price_evidence e
   group by e.clasificacion, coalesce(e.procedencia, '(sin mapeo)'), e.mapeo_estado
   order by e.clasificacion, 2, 3;
end;
$$;
comment on function public.excepciones_evidencia_fiscal() is
  'Resumen de la evidencia por clasificación, procedencia y estado de mapeo, con la advertencia que corresponde. Alimenta la pantalla de revisión de C3: las excepciones no quedan enterradas en un estado genérico de "pendiente".';

-- ---------------------------------------------------------------------------
-- 6) AUTORIDAD.
-- ---------------------------------------------------------------------------
revoke all on function public.fiscal_price_evidence_guard() from public, anon, authenticated;
revoke all on function public.importar_evidencia_precios(uuid, jsonb) from public, anon;
revoke all on function public.excepciones_evidencia_fiscal() from public, anon;
grant execute on function public.importar_evidencia_precios(uuid, jsonb) to authenticated, service_role;
grant execute on function public.excepciones_evidencia_fiscal() to authenticated, service_role;
