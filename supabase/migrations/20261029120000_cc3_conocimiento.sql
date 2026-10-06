-- ============================================================================
-- CC-3 · CONOCIMIENTO COMERCIAL DE PRODUCTO — autoridad auditable, aprobada y por niveles.
--
-- Lo que Renovacell SABE hoy de sus 192 productos (auditado en producción, read-only):
--   identidad completa (name, sku, family 181, category 190, line, padre/variante 75/117),
--   presentación en `odoo_reference` (161), unidad (128), imagen (63), 8 folletos externos,
--   `metadata.tagline/chips` en 6 productos, textos de marca/certificaciones en la landing.
--   Y NO sabe: descripción (0/192), composición, ficha técnica, indicaciones, protocolos.
--
-- Por eso el modelo NO es un EAV genérico ni duplica la identidad (que sigue en `products`):
--   · `cc_product_knowledge`: bloques narrativos TIPADOS por sección (lista cerrada) con nivel
--     derivado (T0 comercial · T1 técnico · T2 clínico/regulatorio), versión, estado
--     draft→approved→retired, fuente y auditoría. Un solo approved por (producto, sección).
--   · `cc_knowledge_sources`: procedencia (tipo, referencia, documento, versión, captura).
--   · `cc_product_aliases`: términos de descubrimiento (nunca autoridad).
--   · `cc_product_relations`: relaciones CURADAS con tipo explícito (las derivadas —variante/
--     familia— se calculan desde `products`, no se copian). "Relacionado" ≠ "sustituto".
--   · `cc_company_knowledge`: conocimiento de empresa (cómo comprar, verificación, envíos…)
--     separado del de producto y sin duplicar verdades transaccionales.
--   · `cc_claim_rules`: capa SECUNDARIA de claims (la primaria es contenido aprobado).
--   · `cc_knowledge_config`: T2 bloqueado por defecto (decisión del dueño).
--   · `cc_knowledge_events`: bitácora append-only de crear/editar/aprobar/retirar/restaurar/importar.
--
-- Fuera de aquí, SIEMPRE: precio (precio_de), stock (product_stock), costo, fiscal, metadata
-- cruda. Las funciones de lectura jamás los devuelven. Audiencia derivada en el servidor
-- (anon/registrado → public; verificado/personal → verified; Dirección → staff); el campo
-- `p_audiencia` solo lo honra service_role (la Edge de CC-4 lo resolverá).
--
-- Rollback: supabase/rollback/cc3/99_down.sql.
-- ============================================================================

do $pre$
begin
  if to_regclass('public.products') is null then raise exception 'CC3: falta products'; end if;
  if to_regprocedure('public.auth_role()') is null or to_regprocedure('public.is_verified()') is null then raise exception 'CC3: faltan helpers W6-A1'; end if;
  if to_regprocedure('public._cc_append_only()') is null then raise exception 'CC3: falta CC-1 (_cc_append_only)'; end if;
  if to_regclass('public.cc_product_knowledge') is not null then raise exception 'CC3: ya aplicada'; end if;
  if not exists (select 1 from pg_ts_config where cfgname = 'spanish') then raise exception 'CC3: falta la configuración de texto spanish'; end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1) NIVELES Y SECCIONES (lista cerrada; el nivel se deriva de la sección)
-- ---------------------------------------------------------------------------
create or replace function public._cc_nivel_seccion(p_seccion text) returns text
  language sql immutable as
$$
  select case p_seccion
    when 'resumen' then 'T0' when 'presentacion' then 'T0' when 'diferenciadores' then 'T0' when 'caracteristicas' then 'T0'
    when 'uso_comercial' then 'T0' when 'faq' then 'T0' when 'marca' then 'T0' when 'fabricante' then 'T0'
    when 'composicion' then 'T1' when 'tecnologia' then 'T1' when 'certificaciones' then 'T1' when 'ficha_tecnica' then 'T1'
    when 'concentracion' then 'T1' when 'volumen' then 'T1'
    when 'indicaciones' then 'T2' when 'contraindicaciones' then 'T2' when 'protocolo' then 'T2' when 'advertencias' then 'T2'
    else null end
$$;
-- Audiencia mínima por nivel: T0 público; T1 y T2 solo verificados/personal.
create or replace function public._cc_audiencia_minima(p_nivel text) returns text
  language sql immutable as
$$ select case p_nivel when 'T0' then 'public' else 'verified' end $$;
create or replace function public._cc_audiencia_rango(p_aud text) returns int
  language sql immutable as
$$ select case p_aud when 'public' then 0 when 'verified' then 1 when 'staff' then 2 else -1 end $$;

-- ---------------------------------------------------------------------------
-- 2) TABLAS
-- ---------------------------------------------------------------------------
create table public.cc_knowledge_sources (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null,
  referencia    text not null,
  documento_url text,
  version       text,
  captured_at   timestamptz not null default now(),
  notas         text,                         -- STAFF_ONLY
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint ck_cks_tipo check (tipo in ('renovacell', 'fabricante', 'distribuidor', 'ficha_tecnica', 'catalogo_oficial', 'regulatorio', 'carga_manual')),
  constraint ck_cks_ref check (length(referencia) between 1 and 300),
  constraint ck_cks_url check (documento_url is null or documento_url ~ '^https?://')
);
create unique index uq_cks on public.cc_knowledge_sources (tipo, referencia, coalesce(version, ''));
comment on table public.cc_knowledge_sources is 'CC-3 · Procedencia del conocimiento (sin duplicar archivos: la URL apunta al storage o al documento externo).';

create table public.cc_product_knowledge (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products(id) on delete restrict,
  seccion        text not null,
  nivel          text not null,
  version        int  not null,
  rev            int  not null default 1,
  estado         text not null default 'draft',
  audiencia      text not null,
  contenido      text not null,
  datos          jsonb,
  source_id      uuid references public.cc_knowledge_sources(id) on delete restrict,
  importado_de   text,
  created_by     uuid, created_at timestamptz not null default now(),
  updated_by     uuid, updated_at timestamptz not null default now(),
  approved_by    uuid, approved_at timestamptz,
  retired_by     uuid, retired_at timestamptz, retired_reason text,
  constraint ck_cpk_nivel check (nivel = public._cc_nivel_seccion(seccion)),
  constraint ck_cpk_estado check (estado in ('draft', 'approved', 'retired')),
  constraint ck_cpk_aud check (audiencia in ('public', 'verified', 'staff') and public._cc_audiencia_rango(audiencia) >= public._cc_audiencia_rango(public._cc_audiencia_minima(nivel))),
  constraint ck_cpk_contenido check (length(contenido) between 1 and 4000 and btrim(contenido) <> ''),
  constraint ck_cpk_aprobado check (estado <> 'approved' or approved_at is not null),   -- la fecha de aprobación se conserva al retirar
  constraint ck_cpk_retirado check ((estado = 'retired') = (retired_at is not null)),
  unique (product_id, seccion, version)
);
create unique index uq_cpk_approved on public.cc_product_knowledge (product_id, seccion) where estado = 'approved';
create unique index uq_cpk_draft on public.cc_product_knowledge (product_id, seccion) where estado = 'draft';
create index idx_cpk_fts on public.cc_product_knowledge using gin (to_tsvector('spanish', contenido)) where estado = 'approved';
comment on table public.cc_product_knowledge is 'CC-3 · Bloques de conocimiento por producto y sección (lista cerrada). Un approved y un draft por (producto, sección); versiones nunca se sobrescriben.';

create table public.cc_product_aliases (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  alias       text not null,
  alias_norm  text not null,
  tipo        text not null default 'nombre_comercial',
  activo      boolean not null default true,
  created_by  uuid, created_at timestamptz not null default now(),
  constraint ck_cpa_tipo check (tipo in ('nombre_comercial', 'abreviatura', 'erp', 'error_comun')),
  constraint ck_cpa_alias check (length(alias) between 2 and 120),
  constraint uq_cpa unique (alias_norm)
);
comment on table public.cc_product_aliases is 'CC-3 · Términos de DESCUBRIMIENTO (nunca autoridad): resuelven a un product_id canónico.';

create table public.cc_product_relations (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  related_id  uuid not null references public.products(id) on delete cascade,
  tipo        text not null,
  estado      text not null default 'draft',
  source_id   uuid references public.cc_knowledge_sources(id),
  nota        text,
  created_by  uuid, created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  retired_by  uuid, retired_at timestamptz,
  constraint ck_cpr_tipo check (tipo in ('alternativa_comercial', 'complemento', 'reemplazo', 'comparable')),
  constraint ck_cpr_estado check (estado in ('draft', 'approved', 'retired')),
  constraint ck_cpr_distintos check (product_id <> related_id),
  constraint uq_cpr unique (product_id, related_id, tipo)
);
comment on table public.cc_product_relations is 'CC-3 · Relaciones CURADAS con tipo explícito. Variante/familia se derivan de products. Relacionado ≠ sustituto.';

create table public.cc_company_knowledge (
  id          uuid primary key default gen_random_uuid(),
  tema        text not null,
  titulo      text not null,
  contenido   text not null,
  version     int  not null,
  rev         int  not null default 1,
  estado      text not null default 'draft',
  audiencia   text not null default 'public',
  source_id   uuid references public.cc_knowledge_sources(id) on delete restrict,
  importado_de text,
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  retired_by  uuid, retired_at timestamptz, retired_reason text,
  constraint ck_cck_tema check (tema in ('como_comprar', 'verificacion', 'envios', 'pagos', 'facturacion', 'devoluciones', 'atencion', 'politica_comercial', 'empresa', 'tecnologia', 'certificaciones')),
  constraint ck_cck_estado check (estado in ('draft', 'approved', 'retired')),
  constraint ck_cck_aud check (audiencia in ('public', 'verified', 'staff')),
  constraint ck_cck_contenido check (length(contenido) between 1 and 4000 and length(titulo) between 1 and 160),
  constraint ck_cck_aprobado check (estado <> 'approved' or approved_at is not null),
  unique (tema, titulo, version)
);
create unique index uq_cck_approved on public.cc_company_knowledge (tema, titulo) where estado = 'approved';
create unique index uq_cck_draft on public.cc_company_knowledge (tema, titulo) where estado = 'draft';
create index idx_cck_fts on public.cc_company_knowledge using gin (to_tsvector('spanish', titulo || ' ' || contenido)) where estado = 'approved';

create table public.cc_claim_rules (
  id       uuid primary key default gen_random_uuid(),
  patron   text not null,
  tipo     text not null,
  motivo   text not null,
  activo   boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(),
  constraint ck_ccr_tipo check (tipo in ('prohibido', 'requiere_aprobacion', 'disclaimer')),
  constraint uq_ccr unique (patron, tipo)
);
comment on table public.cc_claim_rules is 'CC-3 · Capa secundaria de claims (regex, insensible a mayúsculas). La autoridad primaria es el contenido aprobado.';

create table public.cc_knowledge_config (
  id             text primary key default 'default',
  t2_habilitado  boolean not null default false,
  updated_by     uuid, updated_at timestamptz not null default now(),
  constraint ck_cfg_id check (id = 'default')
);
insert into public.cc_knowledge_config (id) values ('default');

create table public.cc_knowledge_events (
  id               bigint generated always as identity primary key,
  entidad          text not null,
  entidad_id       uuid not null,
  accion           text not null,
  version          int,
  actor_profile_id uuid,
  detalle          jsonb,
  created_at       timestamptz not null default now(),
  constraint ck_cke_entidad check (entidad in ('producto', 'empresa', 'alias', 'relacion', 'fuente', 'config')),
  constraint ck_cke_accion check (accion in ('crear', 'editar', 'aprobar', 'retirar', 'restaurar', 'importar', 'configurar'))
);
create index idx_cke_entidad on public.cc_knowledge_events (entidad, entidad_id, created_at);
create trigger trg_cke_append_only before update or delete on public.cc_knowledge_events for each row execute function public._cc_append_only();

-- Las versiones aprobadas o retiradas no se editan: solo cambian de estado por comando.
create or replace function public._cc_knowledge_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if tg_op = 'DELETE' then raise exception 'CONOCIMIENTO_INMUTABLE: las versiones no se borran; se retiran'; end if;
  if old.estado <> 'draft' and (new.contenido is distinct from old.contenido or new.datos is distinct from old.datos or new.seccion is distinct from old.seccion
       or new.source_id is distinct from old.source_id or new.audiencia is distinct from old.audiencia or new.version is distinct from old.version) then
    raise exception 'CONOCIMIENTO_INMUTABLE: una versión aprobada o retirada no se edita; crea una nueva versión';
  end if;
  return new;
end;
$$;
create trigger trg_cpk_guard before update or delete on public.cc_product_knowledge for each row execute function public._cc_knowledge_guard();
create or replace function public._cc_company_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if tg_op = 'DELETE' then raise exception 'CONOCIMIENTO_INMUTABLE: las versiones no se borran; se retiran'; end if;
  if old.estado <> 'draft' and (new.contenido is distinct from old.contenido or new.titulo is distinct from old.titulo or new.source_id is distinct from old.source_id
       or new.audiencia is distinct from old.audiencia or new.version is distinct from old.version) then
    raise exception 'CONOCIMIENTO_INMUTABLE: una versión aprobada o retirada no se edita; crea una nueva versión';
  end if;
  return new;
end;
$$;
create trigger trg_cck_guard before update or delete on public.cc_company_knowledge for each row execute function public._cc_company_guard();

-- RLS encendida; ningún cliente lee ni escribe directo (todo por RPC). Dirección lee la bitácora.
alter table public.cc_knowledge_sources enable row level security;
alter table public.cc_product_knowledge enable row level security;
alter table public.cc_product_aliases enable row level security;
alter table public.cc_product_relations enable row level security;
alter table public.cc_company_knowledge enable row level security;
alter table public.cc_claim_rules enable row level security;
alter table public.cc_knowledge_config enable row level security;
alter table public.cc_knowledge_events enable row level security;
revoke all on public.cc_knowledge_sources, public.cc_product_knowledge, public.cc_product_aliases, public.cc_product_relations,
  public.cc_company_knowledge, public.cc_claim_rules, public.cc_knowledge_config, public.cc_knowledge_events from public, anon, authenticated;
grant select on public.cc_knowledge_events to authenticated;
create policy cke_select_admin on public.cc_knowledge_events for select to authenticated using (public.auth_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 3) HELPERS
-- ---------------------------------------------------------------------------
-- Normalización para descubrimiento: minúsculas, sin acentos, espacios colapsados.
create or replace function public._cc_norm(p text) returns text
  language sql immutable as
$$
  select nullif(btrim(regexp_replace(lower(translate(coalesce(p, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '\s+', ' ', 'g')), '')
$$;

create or replace function public._cc_es_service() returns boolean
  language sql stable as
$$ select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' $$;

create or replace function public._cc_es_admin() returns boolean
  language sql stable set search_path = public as
$$ select public.auth_role() = 'admin' $$;

-- Audiencia efectiva. service_role (Edge) puede pedirla; todo lo demás se deriva del JWT.
create or replace function public._cc_audiencia(p_solicitada text default null) returns text
  language plpgsql stable set search_path = public as
$$
declare r text;
begin
  if public._cc_es_service() then
    return case when p_solicitada in ('public', 'verified', 'staff') then p_solicitada else 'public' end;
  end if;
  r := public.auth_role();
  if r = '' then return 'public'; end if;
  if r = 'doctor' then return case when public.is_verified() then 'verified' else 'public' end; end if;
  if r = 'admin' then return 'staff'; end if;
  return 'verified';   -- personal: pos, billing, comm, warehouse, packing, driver
end;
$$;
create or replace function public.cc_audiencia_actual() returns text language sql stable security definer set search_path = public as $$ select public._cc_audiencia(null) $$;

-- Revisión de claims (capa secundaria). Devuelve coincidencias por tipo.
create or replace function public.cc_revisar_claims(p_texto text) returns jsonb
  language sql stable set search_path = public as
$$
  select coalesce(jsonb_agg(jsonb_build_object('tipo', r.tipo, 'patron', r.patron, 'motivo', r.motivo) order by r.tipo, r.patron), '[]'::jsonb)
    from public.cc_claim_rules r where r.activo and coalesce(p_texto, '') ~* r.patron
$$;

create or replace function public._cc_evento_k(p_entidad text, p_id uuid, p_accion text, p_version int, p_detalle jsonb default null) returns void
  language sql set search_path = public as
$$ insert into public.cc_knowledge_events (entidad, entidad_id, accion, version, actor_profile_id, detalle) values (p_entidad, p_id, p_accion, p_version, auth.uid(), p_detalle) $$;

create or replace function public._cc_exige_admin() returns void
  language plpgsql stable set search_path = public as
$$ begin if not (public._cc_es_admin() or public._cc_es_service()) then raise exception 'NO_AUTORIZADO: solo Dirección administra el conocimiento' using errcode = 'insufficient_privilege'; end if; end $$;

-- Identidad PÚBLICA del producto: lo único de `products` que el conocimiento expone.
-- (Clasificación: PUBLIC = name/line/category/family/presentación/unidad/imagen/folleto/tagline/chips;
--  VERIFIED = precio y stock SOLO vía sus autoridades; STAFF_ONLY = costos, notas, fuentes internas,
--  fiscal; SYSTEM_ONLY = odoo_identity_key, import_hash, ids internos.)
create or replace function public._cc_identidad(p_product uuid) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object(
    'product_id', p.id, 'nombre', p.name, 'linea', p.line, 'categoria', p.category, 'familia', p.family,
    'presentacion', p.odoo_reference, 'unidad', p.unit, 'imagen_url', p.image_url, 'folleto_url', p.brochure_url,
    'tagline', p.metadata ->> 'tagline', 'chips', p.metadata -> 'chips',
    'es_familia', exists (select 1 from public.products c where c.parent_product_id = p.id),
    'variante_de', (select jsonb_build_object('product_id', pp.id, 'nombre', pp.name) from public.products pp where pp.id = p.parent_product_id),
    'variantes', (select coalesce(jsonb_agg(jsonb_build_object('product_id', c.id, 'nombre', c.name, 'presentacion', c.odoo_reference) order by c.name), '[]'::jsonb)
                  from public.products c where c.parent_product_id = p.id and c.active and c.sellable),
    'misma_familia', (select coalesce(jsonb_agg(jsonb_build_object('product_id', f.id, 'nombre', f.name) order by f.name), '[]'::jsonb)
                      from public.products f where f.family = p.family and f.id <> p.id and f.parent_product_id is null and f.active and p.family is not null))
  from public.products p where p.id = p_product and p.active
$$;

-- ¿Visible para esta audiencia? (público: solo lo que la landing muestra; demás: portal o landing)
create or replace function public._cc_producto_visible(p_product uuid, p_aud text) returns boolean
  language sql stable set search_path = public as
$$
  select exists (select 1 from public.products p where p.id = p_product and p.active and (case when p_aud = 'public' then p.show_landing else (p.show_portal or p.show_landing) end))
$$;

-- ---------------------------------------------------------------------------
-- 4) ADMINISTRACIÓN (Dirección vía RPC; service_role para importación)
-- ---------------------------------------------------------------------------
create or replace function public.cc_fuente_registrar(p_tipo text, p_referencia text, p_documento_url text default null, p_version text default null, p_notas text default null) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid;
begin
  perform public._cc_exige_admin();
  insert into public.cc_knowledge_sources (tipo, referencia, documento_url, version, notas, created_by)
  values (p_tipo, btrim(p_referencia), nullif(btrim(p_documento_url), ''), nullif(btrim(p_version), ''), p_notas, auth.uid())
  on conflict (tipo, referencia, coalesce(version, '')) do update set notas = coalesce(excluded.notas, public.cc_knowledge_sources.notas)
  returning id into v_id;
  perform public._cc_evento_k('fuente', v_id, 'crear', null, jsonb_build_object('tipo', p_tipo));
  return v_id;
end;
$$;

create or replace function public.cc_fuentes_listar() returns table (id uuid, tipo text, referencia text, documento_url text, version text, captured_at timestamptz, notas text)
  language sql stable security definer set search_path = public as
$$ select s.id, s.tipo, s.referencia, s.documento_url, s.version, s.captured_at, case when public._cc_es_admin() or public._cc_es_service() then s.notas end
     from public.cc_knowledge_sources s where public._cc_es_admin() or public._cc_es_service() order by s.captured_at desc $$;

-- Guardar: crea un draft (nueva versión si ya hay approved) o edita el draft con control optimista (rev).
create or replace function public.cc_conocimiento_guardar(p_product uuid, p_seccion text, p_contenido text, p_datos jsonb default null, p_source uuid default null,
                                                           p_audiencia text default null, p_id uuid default null, p_rev int default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_nivel text; v_aud text; r public.cc_product_knowledge%rowtype; v_ver int;
begin
  perform public._cc_exige_admin();
  v_nivel := public._cc_nivel_seccion(p_seccion);
  if v_nivel is null then raise exception 'SECCION_INVALIDA: %', p_seccion using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.products where id = p_product) then raise exception 'PRODUCTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  v_aud := coalesce(p_audiencia, public._cc_audiencia_minima(v_nivel));
  if public._cc_audiencia_rango(v_aud) < public._cc_audiencia_rango(public._cc_audiencia_minima(v_nivel)) then
    raise exception 'AUDIENCIA_INVALIDA: % no puede ser %', v_nivel, v_aud using errcode = 'check_violation';
  end if;
  if p_id is null then
    if exists (select 1 from public.cc_product_knowledge where product_id = p_product and seccion = p_seccion and estado = 'draft') then
      raise exception 'DRAFT_EXISTE: ya hay un borrador de esa sección; edítalo con su id y rev' using errcode = 'unique_violation';
    end if;
    select coalesce(max(version), 0) + 1 into v_ver from public.cc_product_knowledge where product_id = p_product and seccion = p_seccion;
    insert into public.cc_product_knowledge (product_id, seccion, nivel, version, estado, audiencia, contenido, datos, source_id, created_by, updated_by)
    values (p_product, p_seccion, v_nivel, v_ver, 'draft', v_aud, p_contenido, p_datos, p_source, auth.uid(), auth.uid()) returning * into r;
    perform public._cc_evento_k('producto', r.id, 'crear', r.version, jsonb_build_object('product_id', p_product, 'seccion', p_seccion));
  else
    select * into r from public.cc_product_knowledge where id = p_id for update;
    if not found then raise exception 'CONOCIMIENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
    if r.estado <> 'draft' then raise exception 'CONOCIMIENTO_INMUTABLE: solo se edita un borrador' using errcode = 'check_violation'; end if;
    if p_rev is null or p_rev <> r.rev then raise exception 'REV_DESACTUALIZADA: el borrador cambió (rev %)', r.rev using errcode = 'serialization_failure'; end if;
    update public.cc_product_knowledge set contenido = p_contenido, datos = p_datos, source_id = coalesce(p_source, source_id), audiencia = v_aud,
           rev = rev + 1, updated_by = auth.uid(), updated_at = now() where id = p_id returning * into r;
    perform public._cc_evento_k('producto', r.id, 'editar', r.version, jsonb_build_object('rev', r.rev));
  end if;
  return jsonb_build_object('id', r.id, 'version', r.version, 'rev', r.rev, 'estado', r.estado, 'nivel', r.nivel, 'claims', public.cc_revisar_claims(r.contenido));
end;
$$;

-- Aprobar: exige fuente para T1/T2; T2 además requiere el interruptor de Dirección y confirmación
-- explícita; rechaza claims prohibidos; retira atómicamente la versión aprobada anterior.
create or replace function public.cc_conocimiento_aprobar(p_id uuid, p_confirmar_clinico boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cc_product_knowledge%rowtype; v_claims jsonb; v_prev uuid;
begin
  perform public._cc_exige_admin();
  select * into r from public.cc_product_knowledge where id = p_id for update;
  if not found then raise exception 'CONOCIMIENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if r.estado = 'approved' then return jsonb_build_object('id', r.id, 'estado', 'approved', 'idempotente', true); end if;
  if r.estado <> 'draft' then raise exception 'ESTADO_INVALIDO: solo se aprueba un borrador' using errcode = 'check_violation'; end if;
  if r.nivel in ('T1', 'T2') and r.source_id is null then raise exception 'FUENTE_REQUERIDA: % exige procedencia', r.nivel using errcode = 'check_violation'; end if;
  if r.nivel = 'T2' then
    if not (select t2_habilitado from public.cc_knowledge_config where id = 'default') or not coalesce(p_confirmar_clinico, false) then
      raise exception 'T2_BLOQUEADO: el contenido clínico/regulatorio requiere habilitación de Dirección y confirmación explícita' using errcode = 'insufficient_privilege';
    end if;
  end if;
  v_claims := public.cc_revisar_claims(r.contenido);
  if exists (select 1 from jsonb_array_elements(v_claims) c where c ->> 'tipo' = 'prohibido') then
    raise exception 'CLAIM_PROHIBIDO: %', (select string_agg(c ->> 'motivo', '; ') from jsonb_array_elements(v_claims) c where c ->> 'tipo' = 'prohibido') using errcode = 'check_violation';
  end if;
  if r.nivel <> 'T2' and exists (select 1 from jsonb_array_elements(v_claims) c where c ->> 'tipo' = 'requiere_aprobacion') then
    raise exception 'CLAIM_REQUIERE_T2: el texto contiene lenguaje clínico; va en una sección T2' using errcode = 'check_violation';
  end if;
  select id into v_prev from public.cc_product_knowledge where product_id = r.product_id and seccion = r.seccion and estado = 'approved' for update;
  if v_prev is not null then
    update public.cc_product_knowledge set estado = 'retired', retired_by = auth.uid(), retired_at = now(), retired_reason = 'nueva_version' where id = v_prev;
    perform public._cc_evento_k('producto', v_prev, 'retirar', null, jsonb_build_object('motivo', 'nueva_version', 'sustituida_por', r.id));
  end if;
  update public.cc_product_knowledge set estado = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform public._cc_evento_k('producto', r.id, 'aprobar', r.version, jsonb_build_object('nivel', r.nivel, 'claims', v_claims));
  return jsonb_build_object('id', r.id, 'estado', 'approved', 'version', r.version, 'retirada', v_prev, 'claims', v_claims);
end;
$$;

create or replace function public.cc_conocimiento_retirar(p_id uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cc_product_knowledge%rowtype;
begin
  perform public._cc_exige_admin();
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO' using errcode = 'check_violation'; end if;
  select * into r from public.cc_product_knowledge where id = p_id for update;
  if not found then raise exception 'CONOCIMIENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if r.estado = 'retired' then return jsonb_build_object('id', r.id, 'estado', 'retired', 'idempotente', true); end if;
  update public.cc_product_knowledge set estado = 'retired', retired_by = auth.uid(), retired_at = now(), retired_reason = left(p_motivo, 300) where id = p_id;
  perform public._cc_evento_k('producto', r.id, 'retirar', r.version, jsonb_build_object('motivo', left(p_motivo, 300)));
  return jsonb_build_object('id', r.id, 'estado', 'retired', 'idempotente', false);
end;
$$;

-- Restaurar = copiar una versión retirada a un NUEVO borrador (nunca revive la fila vieja).
create or replace function public.cc_conocimiento_restaurar(p_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cc_product_knowledge%rowtype; n public.cc_product_knowledge%rowtype; v_ver int;
begin
  perform public._cc_exige_admin();
  select * into r from public.cc_product_knowledge where id = p_id;
  if not found then raise exception 'CONOCIMIENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if r.estado <> 'retired' then raise exception 'ESTADO_INVALIDO: solo se restaura una versión retirada' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.cc_product_knowledge where product_id = r.product_id and seccion = r.seccion and estado = 'draft') then
    raise exception 'DRAFT_EXISTE: ya hay un borrador de esa sección' using errcode = 'unique_violation';
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.cc_product_knowledge where product_id = r.product_id and seccion = r.seccion;
  insert into public.cc_product_knowledge (product_id, seccion, nivel, version, estado, audiencia, contenido, datos, source_id, importado_de, created_by, updated_by)
  values (r.product_id, r.seccion, r.nivel, v_ver, 'draft', r.audiencia, r.contenido, r.datos, r.source_id, 'restaurado:' || r.id, auth.uid(), auth.uid()) returning * into n;
  perform public._cc_evento_k('producto', n.id, 'restaurar', n.version, jsonb_build_object('desde', r.id));
  return jsonb_build_object('id', n.id, 'version', n.version, 'estado', 'draft');
end;
$$;

create or replace function public.cc_alias_guardar(p_product uuid, p_alias text, p_tipo text default 'nombre_comercial') returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_norm text := public._cc_norm(p_alias); v_dueno uuid;
begin
  perform public._cc_exige_admin();
  if v_norm is null or length(v_norm) < 2 then raise exception 'ALIAS_INVALIDO' using errcode = 'check_violation'; end if;
  select product_id into v_dueno from public.cc_product_aliases where alias_norm = v_norm;
  if v_dueno is not null and v_dueno <> p_product then raise exception 'ALIAS_AMBIGUO: ese término ya apunta a otro producto' using errcode = 'unique_violation'; end if;
  -- El UPSERT solo "gana" si el alias ya era de este producto; si otra sesión lo creó para otro
  -- producto en la misma carrera, no devuelve fila y se rechaza (nunca se reasigna en silencio).
  insert into public.cc_product_aliases (product_id, alias, alias_norm, tipo, created_by) values (p_product, btrim(p_alias), v_norm, p_tipo, auth.uid())
  on conflict (alias_norm) do update set activo = true, tipo = excluded.tipo where public.cc_product_aliases.product_id = excluded.product_id returning id into v_id;
  if v_id is null then raise exception 'ALIAS_AMBIGUO: ese término ya apunta a otro producto' using errcode = 'unique_violation'; end if;
  perform public._cc_evento_k('alias', v_id, 'crear', null, jsonb_build_object('product_id', p_product));
  return v_id;
end;
$$;
create or replace function public.cc_alias_retirar(p_id uuid) returns boolean
  language plpgsql security definer set search_path = public as
$$ begin perform public._cc_exige_admin(); update public.cc_product_aliases set activo = false where id = p_id and activo; if found then perform public._cc_evento_k('alias', p_id, 'retirar', null, null); end if; return found; end $$;

create or replace function public.cc_relacion_guardar(p_product uuid, p_related uuid, p_tipo text, p_source uuid default null, p_nota text default null, p_aprobar boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cc_product_relations%rowtype;
begin
  perform public._cc_exige_admin();
  if p_product = p_related then raise exception 'RELACION_INVALIDA: un producto no se relaciona consigo mismo' using errcode = 'check_violation'; end if;
  insert into public.cc_product_relations (product_id, related_id, tipo, source_id, nota, created_by) values (p_product, p_related, p_tipo, p_source, p_nota, auth.uid())
  on conflict (product_id, related_id, tipo) do update set nota = coalesce(excluded.nota, public.cc_product_relations.nota), source_id = coalesce(excluded.source_id, public.cc_product_relations.source_id),
     estado = case when public.cc_product_relations.estado = 'retired' then 'draft' else public.cc_product_relations.estado end, retired_at = null, retired_by = null
  returning * into r;
  perform public._cc_evento_k('relacion', r.id, case when r.created_at >= now() - interval '1 second' then 'crear' else 'editar' end, null, jsonb_build_object('tipo', p_tipo));
  if p_aprobar and r.estado = 'draft' then
    if r.tipo in ('reemplazo', 'alternativa_comercial') and r.source_id is null then raise exception 'FUENTE_REQUERIDA: % exige procedencia', r.tipo using errcode = 'check_violation'; end if;
    update public.cc_product_relations set estado = 'approved', approved_by = auth.uid(), approved_at = now() where id = r.id returning * into r;
    perform public._cc_evento_k('relacion', r.id, 'aprobar', null, null);
  end if;
  return jsonb_build_object('id', r.id, 'estado', r.estado);
end;
$$;
create or replace function public.cc_relacion_retirar(p_id uuid) returns boolean
  language plpgsql security definer set search_path = public as
$$ begin perform public._cc_exige_admin(); update public.cc_product_relations set estado = 'retired', retired_by = auth.uid(), retired_at = now() where id = p_id and estado <> 'retired'; if found then perform public._cc_evento_k('relacion', p_id, 'retirar', null, null); end if; return found; end $$;

-- Conocimiento de EMPRESA: mismo ciclo de vida.
create or replace function public.cc_empresa_guardar(p_tema text, p_titulo text, p_contenido text, p_source uuid default null, p_audiencia text default 'public', p_id uuid default null, p_rev int default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cc_company_knowledge%rowtype; v_ver int;
begin
  perform public._cc_exige_admin();
  if p_id is null then
    if exists (select 1 from public.cc_company_knowledge where tema = p_tema and titulo = btrim(p_titulo) and estado = 'draft') then raise exception 'DRAFT_EXISTE' using errcode = 'unique_violation'; end if;
    select coalesce(max(version), 0) + 1 into v_ver from public.cc_company_knowledge where tema = p_tema and titulo = btrim(p_titulo);
    insert into public.cc_company_knowledge (tema, titulo, contenido, version, audiencia, source_id, created_by, updated_by)
    values (p_tema, btrim(p_titulo), p_contenido, v_ver, p_audiencia, p_source, auth.uid(), auth.uid()) returning * into r;
    perform public._cc_evento_k('empresa', r.id, 'crear', r.version, jsonb_build_object('tema', p_tema));
  else
    select * into r from public.cc_company_knowledge where id = p_id for update;
    if not found then raise exception 'CONOCIMIENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
    if r.estado <> 'draft' then raise exception 'CONOCIMIENTO_INMUTABLE: solo se edita un borrador' using errcode = 'check_violation'; end if;
    if p_rev is null or p_rev <> r.rev then raise exception 'REV_DESACTUALIZADA: el borrador cambió (rev %)', r.rev using errcode = 'serialization_failure'; end if;
    update public.cc_company_knowledge set contenido = p_contenido, source_id = coalesce(p_source, source_id), audiencia = p_audiencia, rev = rev + 1, updated_by = auth.uid(), updated_at = now() where id = p_id returning * into r;
    perform public._cc_evento_k('empresa', r.id, 'editar', r.version, jsonb_build_object('rev', r.rev));
  end if;
  return jsonb_build_object('id', r.id, 'version', r.version, 'rev', r.rev, 'estado', r.estado, 'claims', public.cc_revisar_claims(r.contenido));
end;
$$;
create or replace function public.cc_empresa_aprobar(p_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cc_company_knowledge%rowtype; v_prev uuid; v_claims jsonb;
begin
  perform public._cc_exige_admin();
  select * into r from public.cc_company_knowledge where id = p_id for update;
  if not found then raise exception 'CONOCIMIENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if r.estado = 'approved' then return jsonb_build_object('id', r.id, 'estado', 'approved', 'idempotente', true); end if;
  if r.estado <> 'draft' then raise exception 'ESTADO_INVALIDO' using errcode = 'check_violation'; end if;
  v_claims := public.cc_revisar_claims(r.titulo || ' ' || r.contenido);
  if exists (select 1 from jsonb_array_elements(v_claims) c where c ->> 'tipo' = 'prohibido') then raise exception 'CLAIM_PROHIBIDO' using errcode = 'check_violation'; end if;
  select id into v_prev from public.cc_company_knowledge where tema = r.tema and titulo = r.titulo and estado = 'approved' for update;
  if v_prev is not null then
    update public.cc_company_knowledge set estado = 'retired', retired_by = auth.uid(), retired_at = now(), retired_reason = 'nueva_version' where id = v_prev;
    perform public._cc_evento_k('empresa', v_prev, 'retirar', null, jsonb_build_object('motivo', 'nueva_version', 'sustituida_por', r.id));
  end if;
  update public.cc_company_knowledge set estado = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform public._cc_evento_k('empresa', r.id, 'aprobar', r.version, jsonb_build_object('claims', v_claims));
  return jsonb_build_object('id', r.id, 'estado', 'approved', 'version', r.version, 'retirada', v_prev);
end;
$$;
create or replace function public.cc_empresa_retirar(p_id uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare r public.cc_company_knowledge%rowtype;
begin
  perform public._cc_exige_admin();
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO' using errcode = 'check_violation'; end if;
  select * into r from public.cc_company_knowledge where id = p_id for update;
  if not found then raise exception 'CONOCIMIENTO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if r.estado = 'retired' then return jsonb_build_object('id', r.id, 'estado', 'retired', 'idempotente', true); end if;
  update public.cc_company_knowledge set estado = 'retired', retired_by = auth.uid(), retired_at = now(), retired_reason = left(p_motivo, 300) where id = p_id;
  perform public._cc_evento_k('empresa', r.id, 'retirar', r.version, jsonb_build_object('motivo', left(p_motivo, 300)));
  return jsonb_build_object('id', r.id, 'estado', 'retired');
end;
$$;

create or replace function public.cc_config_t2(p_habilitado boolean) returns boolean
  language plpgsql security definer set search_path = public as
$$
begin
  if not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección habilita T2' using errcode = 'insufficient_privilege'; end if;
  update public.cc_knowledge_config set t2_habilitado = coalesce(p_habilitado, false), updated_by = auth.uid(), updated_at = now() where id = 'default';
  perform public._cc_evento_k('config', '00000000-0000-0000-0000-000000000000'::uuid, 'configurar', null, jsonb_build_object('t2_habilitado', coalesce(p_habilitado, false)));
  return coalesce(p_habilitado, false);
end;
$$;

-- Cobertura por producto (admin): aprobadas, borradores y lo que falta de T0/T1.
create or replace function public.cc_cobertura() returns table (
  product_id uuid, nombre text, familia text, categoria text, es_padre boolean, aprobadas text[], borradores text[], faltantes_t0 text[], faltantes_t1 text[]
) language sql stable security definer set search_path = public as
$$
  select p.id, p.name, p.family, p.category, p.parent_product_id is null,
         coalesce((select array_agg(k.seccion order by k.seccion) from public.cc_product_knowledge k where k.product_id = p.id and k.estado = 'approved'), '{}'),
         coalesce((select array_agg(k.seccion order by k.seccion) from public.cc_product_knowledge k where k.product_id = p.id and k.estado = 'draft'), '{}'),
         (select array_agg(s order by s) from unnest(array['resumen','presentacion','diferenciadores','caracteristicas','uso_comercial']) s
           where not exists (select 1 from public.cc_product_knowledge k where k.product_id = p.id and k.seccion = s and k.estado = 'approved')),
         (select array_agg(s order by s) from unnest(array['composicion','tecnologia','certificaciones','ficha_tecnica']) s
           where not exists (select 1 from public.cc_product_knowledge k where k.product_id = p.id and k.seccion = s and k.estado = 'approved'))
    from public.products p
   where (public._cc_es_admin() or public._cc_es_service()) and p.active
   order by p.category nulls last, p.family nulls last, p.name
$$;

-- Listado administrativo de las versiones de un producto (todas, con fuente).
create or replace function public.cc_conocimiento_listar(p_product uuid) returns table (
  id uuid, seccion text, nivel text, version int, rev int, estado text, audiencia text, contenido text, datos jsonb, source_id uuid, fuente text, importado_de text,
  created_at timestamptz, approved_at timestamptz, retired_at timestamptz, retired_reason text
) language sql stable security definer set search_path = public as
$$
  select k.id, k.seccion, k.nivel, k.version, k.rev, k.estado, k.audiencia, k.contenido, k.datos, k.source_id,
         (select s.tipo || ' · ' || s.referencia from public.cc_knowledge_sources s where s.id = k.source_id), k.importado_de,
         k.created_at, k.approved_at, k.retired_at, k.retired_reason
    from public.cc_product_knowledge k
   where (public._cc_es_admin() or public._cc_es_service()) and k.product_id = p_product
   order by k.seccion, k.version desc
$$;
create or replace function public.cc_empresa_listar() returns table (id uuid, tema text, titulo text, version int, rev int, estado text, audiencia text, contenido text, source_id uuid, importado_de text, created_at timestamptz, approved_at timestamptz)
  language sql stable security definer set search_path = public as
$$ select c.id, c.tema, c.titulo, c.version, c.rev, c.estado, c.audiencia, c.contenido, c.source_id, c.importado_de, c.created_at, c.approved_at
     from public.cc_company_knowledge c where (public._cc_es_admin() or public._cc_es_service()) order by c.tema, c.titulo, c.version desc $$;

-- IMPORTACIÓN del conocimiento EXISTENTE como BORRADOR (nunca aprobado), idempotente.
--   products.metadata.tagline → resumen · chips → caracteristicas · odoo_reference → presentacion
--   brochure_url → fuente catálogo oficial + ficha_tecnica (enlace) · landing (ciencia/cumplimiento) → empresa
create or replace function public.cc_importar_conocimiento_existente() returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_src_meta uuid; v_src_odoo uuid; v_src_landing uuid; n_res int := 0; n_car int := 0; n_pre int := 0; n_fic int := 0; n_emp int := 0; r record; v_src uuid; c jsonb;
begin
  perform public._cc_exige_admin();
  insert into public.cc_knowledge_sources (tipo, referencia, notas, created_by) values ('renovacell', 'products.metadata (catálogo interno)', 'tagline/chips capturados en el catálogo del sistema', auth.uid())
    on conflict (tipo, referencia, coalesce(version, '')) do update set referencia = excluded.referencia returning id into v_src_meta;
  insert into public.cc_knowledge_sources (tipo, referencia, notas, created_by) values ('catalogo_oficial', 'Odoo · referencia de presentación', 'odoo_reference importado del ERP', auth.uid())
    on conflict (tipo, referencia, coalesce(version, '')) do update set referencia = excluded.referencia returning id into v_src_odoo;
  insert into public.cc_knowledge_sources (tipo, referencia, notas, created_by) values ('renovacell', 'landing_content.main', 'textos de marca y certificaciones del sitio público', auth.uid())
    on conflict (tipo, referencia, coalesce(version, '')) do update set referencia = excluded.referencia returning id into v_src_landing;

  for r in select p.* from public.products p where p.active loop
    if nullif(btrim(r.metadata ->> 'tagline'), '') is not null and not exists (select 1 from public.cc_product_knowledge k where k.product_id = r.id and k.seccion = 'resumen') then
      insert into public.cc_product_knowledge (product_id, seccion, nivel, version, estado, audiencia, contenido, source_id, importado_de, created_by, updated_by)
      values (r.id, 'resumen', 'T0', 1, 'draft', 'public', btrim(r.metadata ->> 'tagline'), v_src_meta, 'products.metadata.tagline', auth.uid(), auth.uid());
      n_res := n_res + 1;
    end if;
    if jsonb_typeof(r.metadata -> 'chips') = 'array' and jsonb_array_length(r.metadata -> 'chips') > 0 and not exists (select 1 from public.cc_product_knowledge k where k.product_id = r.id and k.seccion = 'caracteristicas') then
      insert into public.cc_product_knowledge (product_id, seccion, nivel, version, estado, audiencia, contenido, datos, source_id, importado_de, created_by, updated_by)
      values (r.id, 'caracteristicas', 'T0', 1, 'draft', 'public', (select string_agg(x, ' · ') from jsonb_array_elements_text(r.metadata -> 'chips') x), jsonb_build_object('chips', r.metadata -> 'chips'), v_src_meta, 'products.metadata.chips', auth.uid(), auth.uid());
      n_car := n_car + 1;
    end if;
    if nullif(btrim(r.odoo_reference), '') is not null and not exists (select 1 from public.cc_product_knowledge k where k.product_id = r.id and k.seccion = 'presentacion') then
      insert into public.cc_product_knowledge (product_id, seccion, nivel, version, estado, audiencia, contenido, datos, source_id, importado_de, created_by, updated_by)
      values (r.id, 'presentacion', 'T0', 1, 'draft', 'public', btrim(r.odoo_reference) || case when r.unit is not null then ' · ' || r.unit else '' end, jsonb_build_object('referencia', r.odoo_reference, 'unidad', r.unit), v_src_odoo, 'products.odoo_reference', auth.uid(), auth.uid());
      n_pre := n_pre + 1;
    end if;
    if nullif(btrim(r.brochure_url), '') is not null and not exists (select 1 from public.cc_product_knowledge k where k.product_id = r.id and k.seccion = 'ficha_tecnica') then
      insert into public.cc_knowledge_sources (tipo, referencia, documento_url, created_by) values ('catalogo_oficial', 'Folleto · ' || r.sku, r.brochure_url, auth.uid())
        on conflict (tipo, referencia, coalesce(version, '')) do update set documento_url = excluded.documento_url returning id into v_src;
      insert into public.cc_product_knowledge (product_id, seccion, nivel, version, estado, audiencia, contenido, datos, source_id, importado_de, created_by, updated_by)
      values (r.id, 'ficha_tecnica', 'T1', 1, 'draft', 'verified', 'Folleto oficial del producto disponible (ver documento de la fuente). El contenido del folleto no ha sido transcrito ni validado.', jsonb_build_object('url', r.brochure_url), v_src, 'products.brochure_url', auth.uid(), auth.uid());
      n_fic := n_fic + 1;
    end if;
  end loop;

  select content into c from public.landing_content where id = 'main';
  if c is not null then
    if nullif(btrim(c -> 'ciencia' ->> 'body'), '') is not null and not exists (select 1 from public.cc_company_knowledge where tema = 'tecnologia' and titulo = 'Tecnología S2RM') then
      insert into public.cc_company_knowledge (tema, titulo, contenido, version, estado, audiencia, source_id, importado_de, created_by, updated_by)
      values ('tecnologia', 'Tecnología S2RM', btrim(c -> 'ciencia' ->> 'body'), 1, 'draft', 'public', v_src_landing, 'landing_content.ciencia.body', auth.uid(), auth.uid());
      n_emp := n_emp + 1;
    end if;
    for r in select e.value as cert from jsonb_array_elements(coalesce(c -> 'cumplimiento' -> 'certs', '[]'::jsonb)) e loop
      if nullif(btrim(r.cert ->> 'nombre'), '') is not null and not exists (select 1 from public.cc_company_knowledge where tema = 'certificaciones' and titulo = btrim(r.cert ->> 'nombre')) then
        insert into public.cc_company_knowledge (tema, titulo, contenido, version, estado, audiencia, source_id, importado_de, created_by, updated_by)
        values ('certificaciones', btrim(r.cert ->> 'nombre'), coalesce(r.cert ->> 'texto', '') || case when r.cert ->> 'ref' is not null then ' (ref. ' || (r.cert ->> 'ref') || ')' else '' end, 1, 'draft', 'public', v_src_landing, 'landing_content.cumplimiento.certs', auth.uid(), auth.uid());
        n_emp := n_emp + 1;
      end if;
    end loop;
  end if;
  perform public._cc_evento_k('producto', '00000000-0000-0000-0000-000000000000'::uuid, 'importar', null, jsonb_build_object('resumen', n_res, 'caracteristicas', n_car, 'presentacion', n_pre, 'ficha_tecnica', n_fic, 'empresa', n_emp));
  return jsonb_build_object('resumen', n_res, 'caracteristicas', n_car, 'presentacion', n_pre, 'ficha_tecnica', n_fic, 'empresa', n_emp);
end;
$$;
-- Reglas de claims iniciales (guardarraíl secundario; Dirección las administra).
insert into public.cc_claim_rules (patron, tipo, motivo) values
  ('\mcura(r|n|do|da|tivo)?\M', 'prohibido', 'No se afirma que un producto cura'),
  ('garantiz', 'prohibido', 'No se garantizan resultados'),
  ('100 ?%', 'prohibido', 'No se afirman resultados absolutos'),
  ('sin (efectos|riesgos|contraindicaciones)', 'prohibido', 'No se niega la existencia de efectos o riesgos'),
  ('aprobad[oa] por (la )?fda', 'prohibido', 'No se atribuyen aprobaciones regulatorias no documentadas'),
  ('\m(dosis|posolog|protocolo de aplicaci|contraindicad|indicad[oa] para pacientes)', 'requiere_aprobacion', 'Lenguaje clínico: solo en secciones T2 aprobadas'),
  ('\m(regenera|rejuvenec|antiedad|anti-?aging)', 'disclaimer', 'Uso exclusivo por profesionales de la salud; no sustituye criterio clínico')
on conflict (patron, tipo) do nothing;

-- ---------------------------------------------------------------------------
-- 5) LECTURA AUTORIZADA (anon, authenticated y service_role; la audiencia la decide el servidor)
-- ---------------------------------------------------------------------------
-- Conocimiento aprobado visible de un producto para una audiencia.
create or replace function public._cc_secciones_visibles(p_product uuid, p_aud text) returns jsonb
  language sql stable set search_path = public as
$$
  select coalesce(jsonb_object_agg(k.seccion, jsonb_build_object('nivel', k.nivel, 'contenido', k.contenido, 'datos', k.datos, 'version', k.version,
           'fuente', (select jsonb_build_object('tipo', s.tipo, 'referencia', s.referencia, 'documento_url', s.documento_url, 'version', s.version) from public.cc_knowledge_sources s where s.id = k.source_id))), '{}'::jsonb)
    from public.cc_product_knowledge k
   where k.product_id = p_product and k.estado = 'approved' and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(p_aud)
     and (k.nivel <> 'T2' or (select t2_habilitado from public.cc_knowledge_config where id = 'default'))
$$;

-- FICHA: identidad pública + conocimiento aprobado para la audiencia + relaciones. Sin precio, stock,
-- costo, fiscal ni metadata cruda. Inexistente/no visible → null (no se revela nada).
create or replace function public.cc_ficha_producto(p_product uuid, p_audiencia text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_aud text := public._cc_audiencia(p_audiencia); v_id jsonb;
begin
  if p_product is null or not public._cc_producto_visible(p_product, v_aud) then return null; end if;
  v_id := public._cc_identidad(p_product);
  return v_id || jsonb_build_object(
    'audiencia', v_aud,
    'conocimiento', public._cc_secciones_visibles(p_product, v_aud),
    'relaciones', (select coalesce(jsonb_agg(jsonb_build_object('tipo', r.tipo, 'product_id', r.related_id, 'nombre', q.name) order by r.tipo, q.name), '[]'::jsonb)
                   from public.cc_product_relations r join public.products q on q.id = r.related_id
                   where r.product_id = p_product and r.estado = 'approved' and public._cc_producto_visible(r.related_id, v_aud)),
    'disclaimers', (select coalesce(jsonb_agg(distinct c.motivo), '[]'::jsonb) from public.cc_product_knowledge k, public.cc_claim_rules c
                    where k.product_id = p_product and k.estado = 'approved' and c.activo and c.tipo = 'disclaimer' and k.contenido ~* c.patron
                      and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(v_aud)),
    'niveles_disponibles', (select coalesce(jsonb_agg(distinct k.nivel), '[]'::jsonb) from public.cc_product_knowledge k where k.product_id = p_product and k.estado = 'approved' and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(v_aud)));
end;
$$;

-- BÚSQUEDA determinista de productos: sku exacto → alias exacto → nombre/familia empieza por →
-- nombre/familia/categoría contiene → texto aprobado (FTS). Devuelve CANDIDATOS, nunca autoridad.
create or replace function public.cc_buscar_productos(p_q text, p_limite int default 20, p_audiencia text default null) returns table (
  product_id uuid, nombre text, familia text, categoria text, linea text, presentacion text, es_familia boolean, coincidencia text, puntaje int
) language plpgsql stable security definer set search_path = public as
$$
declare v_aud text := public._cc_audiencia(p_audiencia); q text := public._cc_norm(p_q); lim int := least(greatest(coalesce(p_limite, 20), 1), 50);
begin
  if q is null or length(q) < 2 then return; end if;
  return query
  with vis as (
    select p.* from public.products p where p.active and (case when v_aud = 'public' then p.show_landing else (p.show_portal or p.show_landing) end)
  ), cand as (
    select p.id, 'sku' as via, 100 as pts from vis p where lower(p.sku) = q
    union all
    select a.product_id, 'alias', 95 from public.cc_product_aliases a join vis p on p.id = a.product_id where a.activo and a.alias_norm = q
    union all
    select p.id, 'nombre', 90 from vis p where public._cc_norm(p.name) = q
    union all
    select p.id, 'nombre_inicio', 80 from vis p where public._cc_norm(p.name) like q || '%'
    union all
    select p.id, 'familia', 75 from vis p where public._cc_norm(p.family) = q
    union all
    select a.product_id, 'alias_parcial', 70 from public.cc_product_aliases a join vis p on p.id = a.product_id where a.activo and a.alias_norm like '%' || q || '%'
    union all
    select p.id, 'nombre_contiene', 60 from vis p where public._cc_norm(p.name) like '%' || q || '%'
    union all
    select p.id, 'familia_contiene', 55 from vis p where public._cc_norm(p.family) like '%' || q || '%'
    union all
    select p.id, 'categoria', 40 from vis p where public._cc_norm(p.category) like '%' || q || '%'
    union all
    select k.product_id, 'conocimiento', 30 from public.cc_product_knowledge k join vis p on p.id = k.product_id
     where k.estado = 'approved' and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(v_aud)
       and to_tsvector('spanish', k.contenido) @@ plainto_tsquery('spanish', p_q)
  ), mejor as (
    select c.id, (array_agg(c.via order by c.pts desc))[1] as via, max(c.pts) as pts from cand c group by c.id
  )
  select p.id, p.name, p.family, p.category, p.line, p.odoo_reference, exists (select 1 from public.products x where x.parent_product_id = p.id), m.via, m.pts
    from mejor m join vis p on p.id = m.id
   order by m.pts desc, p.parent_product_id is null desc, p.name
   limit lim;
end;
$$;

-- BÚSQUEDA en conocimiento aprobado (producto + empresa), con fragmento.
create or replace function public.cc_buscar_conocimiento(p_q text, p_limite int default 10, p_audiencia text default null) returns table (
  entidad text, product_id uuid, nombre text, seccion text, nivel text, fragmento text, fuente text, relevancia real
) language plpgsql stable security definer set search_path = public as
$$
declare v_aud text := public._cc_audiencia(p_audiencia); lim int := least(greatest(coalesce(p_limite, 10), 1), 30); tq tsquery;
begin
  if nullif(btrim(coalesce(p_q, '')), '') is null then return; end if;
  tq := plainto_tsquery('spanish', p_q);
  return query
  (select 'producto'::text, k.product_id, p.name, k.seccion, k.nivel,
          ts_headline('spanish', k.contenido, tq, 'MaxFragments=1, MaxWords=40, MinWords=12'),
          (select s.tipo || ' · ' || s.referencia from public.cc_knowledge_sources s where s.id = k.source_id),
          ts_rank(to_tsvector('spanish', k.contenido), tq)
     from public.cc_product_knowledge k join public.products p on p.id = k.product_id
    where k.estado = 'approved' and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(v_aud)
      and (k.nivel <> 'T2' or (select t2_habilitado from public.cc_knowledge_config where id = 'default'))
      and public._cc_producto_visible(k.product_id, v_aud)
      and to_tsvector('spanish', k.contenido) @@ tq)
  union all
  (select 'empresa'::text, null::uuid, c.titulo, c.tema, 'T0',
          ts_headline('spanish', c.contenido, tq, 'MaxFragments=1, MaxWords=40, MinWords=12'),
          (select s.tipo || ' · ' || s.referencia from public.cc_knowledge_sources s where s.id = c.source_id),
          ts_rank(to_tsvector('spanish', c.titulo || ' ' || c.contenido), tq)
     from public.cc_company_knowledge c
    where c.estado = 'approved' and public._cc_audiencia_rango(c.audiencia) <= public._cc_audiencia_rango(v_aud)
      and to_tsvector('spanish', c.titulo || ' ' || c.contenido) @@ tq)
  order by 8 desc, 3
  limit lim;
end;
$$;

-- COMPARAR: fichas lado a lado (máx. 4) + si la comparación está curada como permitida.
create or replace function public.cc_comparar_productos(p_ids uuid[], p_audiencia text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_aud text := public._cc_audiencia(p_audiencia); ids uuid[] := (select array_agg(distinct x) from unnest(coalesce(p_ids, '{}')) x);
begin
  if ids is null or array_length(ids, 1) < 2 then raise exception 'COMPARACION_INVALIDA: se requieren al menos 2 productos' using errcode = 'check_violation'; end if;
  if array_length(ids, 1) > 4 then raise exception 'COMPARACION_INVALIDA: máximo 4 productos' using errcode = 'check_violation'; end if;
  return jsonb_build_object(
    'audiencia', v_aud,
    'productos', (select coalesce(jsonb_agg(f) filter (where f is not null), '[]'::jsonb) from unnest(ids) i, lateral public.cc_ficha_producto(i, p_audiencia) f),
    'comparacion_curada', exists (select 1 from public.cc_product_relations r where r.estado = 'approved' and r.tipo = 'comparable' and r.product_id = any (ids) and r.related_id = any (ids)),
    'misma_familia', (select count(distinct p.family) = 1 and bool_and(p.family is not null) from public.products p where p.id = any (ids)));
end;
$$;

-- CANDIDATOS para recomendación (CC-4 los interpretará; el LLM nunca inventa fuera de aquí):
-- productos visibles y vendibles por categoría/familia/términos en secciones aprobadas.
create or replace function public.cc_candidatos_recomendacion(p_categoria text default null, p_familia text default null, p_terminos text[] default null, p_limite int default 12, p_audiencia text default null) returns table (
  product_id uuid, nombre text, familia text, categoria text, presentacion text, motivo text
) language plpgsql stable security definer set search_path = public as
$$
declare v_aud text := public._cc_audiencia(p_audiencia); lim int := least(greatest(coalesce(p_limite, 12), 1), 30);
begin
  return query
  with vis as (
    select p.* from public.products p
     where p.active and p.sellable and (case when v_aud = 'public' then p.show_landing else (p.show_portal or p.show_landing) end)
  ), por_cat as (
    select p.id, 'categoria' as motivo from vis p where p_categoria is not null and public._cc_norm(p.category) = public._cc_norm(p_categoria)
  ), por_fam as (
    select p.id, 'familia' from vis p where p_familia is not null and public._cc_norm(p.family) = public._cc_norm(p_familia)
  ), por_term as (
    select distinct k.product_id, 'caracteristica' from public.cc_product_knowledge k join vis p on p.id = k.product_id, unnest(coalesce(p_terminos, '{}')) t
     where k.estado = 'approved' and k.seccion in ('caracteristicas', 'uso_comercial', 'diferenciadores', 'resumen')
       and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(v_aud)
       and public._cc_norm(k.contenido) like '%' || public._cc_norm(t) || '%'
  ), todos as (select * from por_cat union all select * from por_fam union all select * from por_term)
  select p.id, p.name, p.family, p.category, p.odoo_reference, string_agg(distinct t.motivo, '+' order by t.motivo)
    from todos t join vis p on p.id = t.id
   group by p.id, p.name, p.family, p.category, p.odoo_reference
   order by count(*) desc, p.name
   limit lim;
end;
$$;

-- CATÁLOGO compacto para la IA (CC-4): identidad pública + resumen aprobado. Sin precio ni stock.
create or replace function public.cc_catalogo_para_ia(p_audiencia text default null, p_limite int default 200) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_aud text := public._cc_audiencia(p_audiencia);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'nombre', p.name, 'familia', p.family, 'categoria', p.category, 'linea', p.line,
                   'presentacion', p.odoo_reference, 'es_familia', exists (select 1 from public.products c where c.parent_product_id = p.id),
                   'resumen', (select k.contenido from public.cc_product_knowledge k where k.product_id = p.id and k.seccion = 'resumen' and k.estado = 'approved'
                                 and public._cc_audiencia_rango(k.audiencia) <= public._cc_audiencia_rango(v_aud)))
                 order by p.category nulls last, p.family nulls last, p.name), '[]'::jsonb)
            from (select * from public.products p where p.active and (case when v_aud = 'public' then p.show_landing else (p.show_portal or p.show_landing) end)
                   order by p.category nulls last, p.family nulls last, p.name limit least(greatest(coalesce(p_limite, 200), 1), 400)) p);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) PRIVILEGIOS
-- ---------------------------------------------------------------------------
-- Lectura autorizada: anon y authenticated (la audiencia se deriva dentro), más service_role.
grant execute on function public.cc_ficha_producto(uuid, text), public.cc_buscar_productos(text, int, text), public.cc_buscar_conocimiento(text, int, text),
  public.cc_comparar_productos(uuid[], text), public.cc_candidatos_recomendacion(text, text, text[], int, text), public.cc_catalogo_para_ia(text, int),
  public.cc_audiencia_actual(), public.cc_revisar_claims(text) to anon, authenticated, service_role;
-- Administración: solo authenticated (Dirección dentro) y service_role.
revoke all on function public.cc_fuente_registrar(text, text, text, text, text), public.cc_fuentes_listar(), public.cc_conocimiento_guardar(uuid, text, text, jsonb, uuid, text, uuid, int),
  public.cc_conocimiento_aprobar(uuid, boolean), public.cc_conocimiento_retirar(uuid, text), public.cc_conocimiento_restaurar(uuid), public.cc_alias_guardar(uuid, text, text), public.cc_alias_retirar(uuid),
  public.cc_relacion_guardar(uuid, uuid, text, uuid, text, boolean), public.cc_relacion_retirar(uuid), public.cc_empresa_guardar(text, text, text, uuid, text, uuid, int), public.cc_empresa_aprobar(uuid),
  public.cc_empresa_retirar(uuid, text), public.cc_config_t2(boolean), public.cc_cobertura(), public.cc_conocimiento_listar(uuid), public.cc_empresa_listar(), public.cc_importar_conocimiento_existente()
  from public, anon;
grant execute on function public.cc_fuente_registrar(text, text, text, text, text), public.cc_fuentes_listar(), public.cc_conocimiento_guardar(uuid, text, text, jsonb, uuid, text, uuid, int),
  public.cc_conocimiento_aprobar(uuid, boolean), public.cc_conocimiento_retirar(uuid, text), public.cc_conocimiento_restaurar(uuid), public.cc_alias_guardar(uuid, text, text), public.cc_alias_retirar(uuid),
  public.cc_relacion_guardar(uuid, uuid, text, uuid, text, boolean), public.cc_relacion_retirar(uuid), public.cc_empresa_guardar(text, text, text, uuid, text, uuid, int), public.cc_empresa_aprobar(uuid),
  public.cc_empresa_retirar(uuid, text), public.cc_config_t2(boolean), public.cc_cobertura(), public.cc_conocimiento_listar(uuid), public.cc_empresa_listar(), public.cc_importar_conocimiento_existente()
  to authenticated, service_role;
revoke all on function public._cc_identidad(uuid), public._cc_secciones_visibles(uuid, text), public._cc_producto_visible(uuid, text), public._cc_audiencia(text), public._cc_evento_k(text, uuid, text, int, jsonb),
  public._cc_exige_admin() from public, anon;

-- ---------------------------------------------------------------------------
-- 7) Verificación final
-- ---------------------------------------------------------------------------
do $post$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and table_name in ('cc_product_knowledge', 'cc_product_aliases', 'cc_product_relations', 'cc_company_knowledge', 'cc_claim_rules', 'cc_knowledge_config', 'cc_knowledge_sources');
  if n <> 0 then raise exception 'CC3: % privilegios de cliente sobre tablas de conocimiento', n; end if;
  if has_function_privilege('anon', 'public.cc_conocimiento_aprobar(uuid,boolean)', 'EXECUTE') then raise exception 'CC3: anon puede aprobar'; end if;
  if not has_function_privilege('anon', 'public.cc_ficha_producto(uuid,text)', 'EXECUTE') then raise exception 'CC3: anon no puede leer fichas públicas'; end if;
  if (select t2_habilitado from public.cc_knowledge_config where id = 'default') then raise exception 'CC3: T2 debe nacer bloqueado'; end if;
  if public._cc_nivel_seccion('indicaciones') <> 'T2' or public._cc_nivel_seccion('resumen') <> 'T0' or public._cc_nivel_seccion('composicion') <> 'T1' then raise exception 'CC3: niveles mal derivados'; end if;
  if (select count(*) from public.cc_claim_rules where activo) < 5 then raise exception 'CC3: faltan reglas de claims'; end if;
end $post$;
