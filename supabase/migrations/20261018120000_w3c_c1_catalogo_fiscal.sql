-- ============================================================================
-- W3-C · C1 — CATÁLOGO FISCAL DEL PRODUCTO: editable, auditable y validado por
--             una persona.
--
-- Punto de partida verificado en producción: el maestro de productos NO tiene
-- ningún dato fiscal. 192 productos, 181 vendibles, 11 categorías, y `metadata`
-- solo contiene `chips` y `tagline`. Cero claves SAT, cero tasas, y 60 de los
-- 181 vendibles no tienen ni unidad comercial.
--
-- Y el catálogo es fiscalmente HETEROGÉNEO: Medicamentos, Toxinas y Anestésicos
-- conviven con Sérum, Peeling y Aparatología. Asumir una sola tasa para todo
-- sería un error fiscal material, así que aquí no se asume ninguna.
--
-- PRINCIPIOS (decisiones del dueño, incorporadas):
--   K-1 El precio comercial del catálogo ES el precio FINAL que paga el cliente.
--       Invariante del negocio, NO un interruptor: no existe aquí ninguna
--       bandera capaz de cambiar el significado económico del catálogo.
--   K-2 La autoridad fiscal vive APARTE del maestro comercial, como product_costs.
--       Ningún comando de este archivo toca precios comerciales.
--   K-3 Los defaults por categoría PRE-LLENAN candidatos. Nunca autorizan.
--       La autoridad se materializa por producto, con nombre y fecha de quien validó.
--   K-4 La evidencia histórica es evidencia de PRECIO, nunca de impuesto.
--       HISTORICAL_EQUALS_FINAL no significa exento, tasa cero ni no objeto:
--       la aritmética no distingue "el Excel ya traía el final" de "este producto
--       no es gravado al 16%". Eso lo resuelve el contador, no un cálculo.
--   K-5 Cambiar un campo fiscal MATERIAL invalida la validación. Automáticamente,
--       por trigger, para que ningún comando futuro pueda olvidarlo.
--   K-6 Un producto sin configuración fiscal validada no puede construir un CFDI.
--       Esa compuerta se implementa en C4; C1 solo establece la autoridad.
--
-- INVARIANTE QUE C4 DEBERÁ RESPETAR (se documenta aquí para que no se pierda):
--   el renglón económico es  importe_final_renglon = cantidad × precio_unitario,
--   y la descomposición fiscal se hace contra ESE importe, nunca contra una sola
--   unidad. El precio unitario congelado en order_items.unit_price ya incorpora
--   los ajustes comerciales (reglas de volumen); NO se recalcula desde el catálogo
--   actual. Mientras el contador no apruebe la regla de redondeo, C4 falla cerrado
--   en vez de inventar una política de centavos.
--
-- Este archivo NO: importa la evidencia de 190 filas · toca solicitar_cfdi ni
-- reclamar_cfdi · crea fiscal_document_lines · descompone importes · asigna
-- folios · habilita emisión. La emisión real sigue imposible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) AUTORIDAD FISCAL POR PRODUCTO.
-- ---------------------------------------------------------------------------
create table public.product_fiscal (
  product_id          uuid primary key references public.products(id) on delete restrict,

  -- Configuración que irá al CFDI.
  clave_prod_serv     text,
  clave_unidad        text,
  objeto_imp          text,
  tratamiento_iva     text,
  iva_tasa            numeric(8,6),
  descripcion_fiscal  text,

  -- Validación HUMANA: la única autoridad.
  validado            boolean not null default false,
  validado_por        uuid references auth.users(id) on delete restrict,
  validado_at         timestamptz,
  fuente              text,
  notas               text,

  -- Evidencia histórica de PRECIO (K-4). Se llena en C2; aquí solo existe el hueco.
  evidencia_historica text,
  precio_historico    numeric,
  precio_publicado    numeric,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.product_fiscal is
  'Configuración fiscal por producto, separada del maestro comercial. Un producto solo puede facturarse cuando una persona autorizada validó explícitamente esta fila. Ningún comando de aquí modifica precios comerciales.';
comment on column public.product_fiscal.tratamiento_iva is
  'gravado · tasa_cero · exento · no_objeto. tasa_cero y exento NO son lo mismo en el CFDI: tasa cero declara un traslado con tasa 0, exento no declara traslado.';
comment on column public.product_fiscal.evidencia_historica is
  'Clasificación de la evidencia de PRECIO, no del impuesto (K-4). HISTORICAL_EQUALS_FINAL no autoriza tratar el producto como exento, tasa cero ni no objeto.';
comment on column public.product_fiscal.validado is
  'Solo lo pone en true validar_fiscal_producto(). Cambiar un campo fiscal material lo regresa a false automáticamente (K-5).';

create index idx_product_fiscal_pendientes on public.product_fiscal(validado) where not validado;
create index idx_product_fiscal_evidencia  on public.product_fiscal(evidencia_historica)
  where evidencia_historica is not null;

-- ---------------------------------------------------------------------------
-- 2) CONSTRAINTS. Lo que hace imposible una configuración incoherente.
-- ---------------------------------------------------------------------------
alter table public.product_fiscal
  add constraint ck_pf_tratamiento check (
    tratamiento_iva is null
    or tratamiento_iva in ('gravado','tasa_cero','exento','no_objeto')),
  add constraint ck_pf_objeto check (objeto_imp is null or objeto_imp in ('01','02','03')),
  -- Claves SAT: 8 dígitos (ClaveProdServ) y hasta 3 alfanuméricos (ClaveUnidad).
  add constraint ck_pf_clave_prod check (clave_prod_serv is null or clave_prod_serv ~ '^[0-9]{8}$'),
  add constraint ck_pf_clave_unidad check (clave_unidad is null or clave_unidad ~ '^[A-Z0-9]{1,3}$'),
  -- Coherencia tratamiento ↔ tasa.
  add constraint ck_pf_tasa check (
    tratamiento_iva is null
    or (tratamiento_iva = 'gravado'   and iva_tasa is not null and iva_tasa > 0)
    or (tratamiento_iva = 'tasa_cero' and iva_tasa is not null and iva_tasa = 0)
    or (tratamiento_iva in ('exento','no_objeto') and iva_tasa is null)),
  -- LA constraint central: no existe un producto validado a medias.
  add constraint ck_pf_validado_completo check (
    not validado
    or (clave_prod_serv is not null and clave_unidad is not null
        and objeto_imp is not null and tratamiento_iva is not null
        and nullif(btrim(coalesce(descripcion_fiscal, '')), '') is not null
        and validado_por is not null and validado_at is not null)),
  add constraint ck_pf_validacion_coherente check (
    (validado_por is null) = (validado_at is null));

comment on constraint ck_pf_validado_completo on public.product_fiscal is
  'W3-C · K-3: un producto validado tiene SIEMPRE clave de producto, clave de unidad, objeto de impuesto, tratamiento de IVA, descripción fiscal, y el nombre y la fecha de quien validó. No hay validación parcial, ni por error de código ni a mano.';
comment on constraint ck_pf_tasa on public.product_fiscal is
  'W3-C: gravado exige tasa mayor a cero; tasa_cero exige exactamente 0; exento y no objeto no llevan tasa. Impide la confusión más común entre tasa cero y exento.';

-- ---------------------------------------------------------------------------
-- 3) DEFAULTS POR CATEGORÍA — candidatos, nunca autoridad (K-3).
-- ---------------------------------------------------------------------------
create table public.fiscal_category_defaults (
  categoria       text primary key,
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
  constraint ck_fcd_tratamiento check (
    tratamiento_iva is null or tratamiento_iva in ('gravado','tasa_cero','exento','no_objeto')),
  constraint ck_fcd_objeto check (objeto_imp is null or objeto_imp in ('01','02','03')),
  constraint ck_fcd_clave_prod check (clave_prod_serv is null or clave_prod_serv ~ '^[0-9]{8}$'),
  constraint ck_fcd_clave_unidad check (clave_unidad is null or clave_unidad ~ '^[A-Z0-9]{1,3}$'),
  constraint ck_fcd_tasa check (
    tratamiento_iva is null
    or (tratamiento_iva = 'gravado'   and iva_tasa is not null and iva_tasa > 0)
    or (tratamiento_iva = 'tasa_cero' and iva_tasa is not null and iva_tasa = 0)
    or (tratamiento_iva in ('exento','no_objeto') and iva_tasa is null))
);
comment on table public.fiscal_category_defaults is
  'Valores candidatos por categoría para PRE-LLENAR productos sin configurar. Jamás autorizan un producto para CFDI: la autoridad se materializa por producto. Cambiar un default NO altera ni invalida un producto ya validado.';

-- ---------------------------------------------------------------------------
-- 4) BITÁCORA append-only de todo cambio fiscal.
-- ---------------------------------------------------------------------------
create table public.product_fiscal_events (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete restrict,
  evento      text not null,
  campo       text,
  antes       jsonb,
  despues     jsonb,
  motivo      text,
  actor       uuid,
  actor_role  text not null default '',
  op_id       uuid,
  created_at  timestamptz not null default clock_timestamp(),
  constraint ck_pfe_evento check (evento in
    ('candidato','editado','validado','invalidado','default_aplicado','default_definido'))
);
comment on table public.product_fiscal_events is
  'Historia completa de la configuración fiscal: quién la cambió, cuándo y qué. Append-only. Sin esto, "validado por una persona" sería una afirmación sin respaldo.';

create index idx_pfe_product on public.product_fiscal_events(product_id, created_at);

create trigger trg_pfe_append_only before update or delete on public.product_fiscal_events
  for each row execute function public.ledger_append_only();
create trigger trg_pfe_no_truncate before truncate on public.product_fiscal_events
  for each statement execute function public.ledger_append_only();

-- ---------------------------------------------------------------------------
-- 5) GUARDA. Solo comandos, y la invalidación automática (K-5) vive aquí para
--    que ningún comando futuro pueda olvidarla.
-- ---------------------------------------------------------------------------
create function public.product_fiscal_guard() returns trigger
  language plpgsql set search_path = public as
$$
declare v_material boolean;
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;

  if coalesce(current_setting('app.trusted', true), '') <> 'on' then
    raise exception 'FISCAL_PRODUCTO_SOLO_POR_COMANDO: la configuración fiscal se edita y se valida con los comandos del servidor, no escribiendo la tabla.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'FISCAL_PRODUCTO_NO_SE_BORRA: la configuración fiscal no se elimina; se invalida con motivo.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.product_id <> old.product_id then
      raise exception 'FISCAL_PRODUCTO_INMUTABLE: una configuración fiscal no cambia de producto.'
        using errcode = 'check_violation';
    end if;

    -- K-5 · ¿cambió algo MATERIAL? `notas` y `fuente` no lo son: documentan, no deciden.
    v_material :=
         new.clave_prod_serv    is distinct from old.clave_prod_serv
      or new.clave_unidad       is distinct from old.clave_unidad
      or new.objeto_imp         is distinct from old.objeto_imp
      or new.tratamiento_iva    is distinct from old.tratamiento_iva
      or new.iva_tasa           is distinct from old.iva_tasa
      or new.descripcion_fiscal is distinct from old.descripcion_fiscal;

    -- Si estaba validado y cambia el fondo, la validación CADUCA. Lo hace el
    -- trigger y no el comando: así es imposible saltárselo.
    if v_material and old.validado and new.validado then
      new.validado     := false;
      new.validado_por := null;
      new.validado_at  := null;
      insert into public.product_fiscal_events (product_id, evento, motivo, actor, actor_role)
      values (new.product_id, 'invalidado',
              'cambió un dato fiscal material: requiere validación humana de nuevo',
              auth.uid(), coalesce(public.auth_role(), ''));
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;
create trigger trg_product_fiscal_guard before insert or update or delete on public.product_fiscal
  for each row execute function public.product_fiscal_guard();

create function public.fiscal_category_defaults_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;
  if coalesce(current_setting('app.trusted', true), '') <> 'on' then
    raise exception 'FISCAL_DEFAULTS_SOLO_POR_COMANDO: los valores candidatos por categoría los define Dirección con su comando.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_fcd_guard before insert or update or delete on public.fiscal_category_defaults
  for each row execute function public.fiscal_category_defaults_guard();

-- ---------------------------------------------------------------------------
-- 6) IDEMPOTENCIA. Se reutiliza el registro de W3 (fiscal_operations) y sus
--    helpers _w3_op_begin/_w3_op_finish en vez de duplicar la maquinaria: es el
--    mismo dominio fiscal. Solo se amplía el vocabulario de `kind`.
-- ---------------------------------------------------------------------------
alter table public.fiscal_operations drop constraint fiscal_operations_kind_check;
alter table public.fiscal_operations add constraint ck_fiscal_op_kind check (kind in (
  'cfdi_solicitado','cfdi_actualizado','cfdi_descartado',
  'cfdi_reclamado','cfdi_timbrado','cfdi_fallido','cfdi_incierto',
  'cfdi_conciliado','cfdi_cancelado',
  -- W3-C · catálogo fiscal
  'pf_editado','pf_validado','pf_invalidado','pf_default_definido','pf_default_aplicado',
  'pf_candidato'));

-- ---------------------------------------------------------------------------
-- 7) RLS. Lectura para Dirección y Facturación; escritura para nadie.
-- ---------------------------------------------------------------------------
alter table public.product_fiscal          enable row level security;
alter table public.fiscal_category_defaults enable row level security;
alter table public.product_fiscal_events   enable row level security;

revoke all on public.product_fiscal, public.fiscal_category_defaults, public.product_fiscal_events
  from anon, authenticated;
grant select on public.product_fiscal, public.fiscal_category_defaults, public.product_fiscal_events
  to authenticated;

create policy product_fiscal_select on public.product_fiscal
  for select to authenticated using (public.auth_role() = any (array['admin','billing']));
create policy fcd_select on public.fiscal_category_defaults
  for select to authenticated using (public.auth_role() = any (array['admin','billing']));
create policy pfe_select on public.product_fiscal_events
  for select to authenticated using (public.auth_role() = any (array['admin','billing']));
