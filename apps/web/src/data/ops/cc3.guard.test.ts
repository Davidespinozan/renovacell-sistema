// CC-3 · Guardas de repositorio: la migración sostiene las invariantes por base (lista cerrada,
// nivel derivado, un approved por sección, inmutabilidad, T2 bloqueado, fuente en T1/T2, nada
// de precio/stock en las lecturas, clientes sin tablas); la costura compartida no importa nada;
// la UI solo administra por RPC y vive fuera de Comercial; el rollback retira todo sin tocar products.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261029120000_cc3_conocimiento.sql?raw'
import down from '../../../../../supabase/rollback/cc3/99_down.sql?raw'
import seam from '../../../../../supabase/functions/_shared/conocimiento.ts?raw'
import opsSrc from './conocimiento.ts?raw'
import pantallaSrc from '../../screens/admin/Conocimiento.tsx?raw'
import rolesSrc from '../../app/roles.ts?raw'
import registrySrc from '../../screens/registry.tsx?raw'
import assistantSrc from '../../../../../supabase/functions/assistant/index.ts?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('migración CC-3', () => {
  const c = codigo(mig)
  it('5/6 · no es un EAV: tablas tipadas, sección en lista cerrada y nivel DERIVADO por constraint; products sigue siendo la identidad', () => {
    expect(c).toMatch(/create table public\.cc_product_knowledge/)
    expect(c).toMatch(/constraint ck_cpk_nivel check \(nivel = public\._cc_nivel_seccion\(seccion\)\)/)
    expect(c).not.toMatch(/attribute_key|attr_key|eav|entity_attribute/i)
    expect(c).not.toMatch(/alter table public\.products add column/)
    expect(c).toMatch(/'presentacion', p\.odoo_reference/)
  })
  it('7/8 · un approved y un draft por (producto, sección); versiones únicas e inmutables; audiencia mínima por nivel', () => {
    expect(c).toMatch(/create unique index uq_cpk_approved on public\.cc_product_knowledge \(product_id, seccion\) where estado = 'approved'/)
    expect(c).toMatch(/create unique index uq_cpk_draft on public\.cc_product_knowledge \(product_id, seccion\) where estado = 'draft'/)
    expect(c).toMatch(/unique \(product_id, seccion, version\)/)
    expect(c).toMatch(/raise exception 'CONOCIMIENTO_INMUTABLE: las versiones no se borran; se retiran'/)
    expect(c).toMatch(/public\._cc_audiencia_rango\(audiencia\) >= public\._cc_audiencia_rango\(public\._cc_audiencia_minima\(nivel\)\)/)
  })
  it('12/13 · T1/T2 exigen fuente; T2 bloqueado por defecto y con confirmación; claims prohibidos bloquean aprobación', () => {
    expect(c).toMatch(/t2_habilitado\s+boolean not null default false/)
    expect(c).toMatch(/if r\.nivel in \('T1', 'T2'\) and r\.source_id is null then raise exception 'FUENTE_REQUERIDA/)
    expect(c).toMatch(/raise exception 'T2_BLOQUEADO/)
    expect(c).toMatch(/raise exception 'CLAIM_PROHIBIDO/)
    expect(c).toMatch(/if not public\._cc_es_admin\(\) then raise exception 'NO_AUTORIZADO: solo Dirección habilita T2'/)
  })
  it('9/10 · la audiencia la decide el servidor (service_role puede fijarla; el resto desde el JWT); fail-closed a public', () => {
    expect(c).toMatch(/if public\._cc_es_service\(\) then\n\s+return case when p_solicitada in \('public', 'verified', 'staff'\) then p_solicitada else 'public' end;/)
    expect(c).toMatch(/if r = 'doctor' then return case when public\.is_verified\(\) then 'verified' else 'public' end; end if;/)
    expect(c).toMatch(/revoke all on function public\._cc_identidad\(uuid\)[\s\S]*public\._cc_audiencia\(text\)[\s\S]*from public, anon/)
  })
  it('15/19 · ninguna lectura devuelve precio/stock/costo/fiscal; la identidad pública es una lista blanca', () => {
    const lectura = c.slice(c.indexOf('create or replace function public._cc_identidad'), c.indexOf('-- 6) PRIVILEGIOS'))
    expect(lectura).not.toMatch(/\bp\.price\b|\.cost\b|unit_cost|product_stock|product_fiscal|product_costs|fiscal_price|precio_de|v_stock/)
    expect(lectura).not.toMatch(/'metadata', p\.metadata/)
    expect(lectura).toMatch(/'tagline', p\.metadata ->> 'tagline', 'chips', p\.metadata -> 'chips'/)
  })
  it('20 · RLS en 8 tablas; clientes sin SELECT directo salvo bitácora (Dirección); comandos admin sin anon; lecturas con anon', () => {
    for (const t of ['cc_knowledge_sources', 'cc_product_knowledge', 'cc_product_aliases', 'cc_product_relations', 'cc_company_knowledge', 'cc_claim_rules', 'cc_knowledge_config', 'cc_knowledge_events']) expect(c).toContain(`alter table public.${t} enable row level security`)
    expect(c).toMatch(/revoke all on public\.cc_knowledge_sources, public\.cc_product_knowledge[\s\S]*from public, anon, authenticated/)
    expect(c).toMatch(/grant select on public\.cc_knowledge_events to authenticated/)
    expect(c).not.toMatch(/grant (select|insert|update|delete)[^\n]*cc_product_knowledge/)
    expect(c).toMatch(/grant execute on function public\.cc_ficha_producto\(uuid, text\)[\s\S]*to anon, authenticated, service_role/)
    expect(c).toMatch(/revoke all on function public\.cc_fuente_registrar[\s\S]*cc_importar_conocimiento_existente\(\)\n\s+from public, anon/)
  })
  it('22 · relaciones curadas con tipo cerrado; variante/familia derivadas; alias es descubrimiento con dueño único', () => {
    expect(c).toMatch(/constraint ck_cpr_tipo check \(tipo in \('alternativa_comercial', 'complemento', 'reemplazo', 'comparable'\)\)/)
    expect(c).toMatch(/'misma_familia', \(select coalesce\(jsonb_agg/)
    expect(c).toMatch(/constraint uq_cpa unique \(alias_norm\)/)
    expect(c).toMatch(/where public\.cc_product_aliases\.product_id = excluded\.product_id returning id into v_id;\n\s+if v_id is null then raise exception 'ALIAS_AMBIGUO/)
  })
  it('26 · importación = SOLO borradores, con procedencia; no toca products; eventos append-only', () => {
    const imp = c.slice(c.indexOf('create or replace function public.cc_importar_conocimiento_existente'), c.indexOf('insert into public.cc_claim_rules (patron, tipo, motivo) values'))
    expect(imp).not.toMatch(/'approved'/)
    expect(imp).not.toMatch(/update public\.products/)
    expect(imp).toMatch(/'products\.odoo_reference'/); expect(imp).toMatch(/'products\.metadata\.tagline'/); expect(imp).toMatch(/'products\.brochure_url'/); expect(imp).toMatch(/'landing_content\.ciencia\.body'/)
    expect(c).toMatch(/create trigger trg_cke_append_only before update or delete on public\.cc_knowledge_events for each row execute function public\._cc_append_only\(\)/)
  })
  it('búsqueda determinista sin extensiones: FTS spanish + normalización; sin pg_trgm ni vectores', () => {
    expect(c).toMatch(/to_tsvector\('spanish', k\.contenido\) @@ plainto_tsquery\('spanish', p_q\)/)
    expect(c).toMatch(/translate\(coalesce\(p, ''\), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'\)/)
    expect(c).not.toMatch(/pg_trgm|pgvector|embedding|create extension/i)
  })
  it('rollback: retira las 8 tablas y las funciones sin tocar products ni CC-1/CC-2', () => {
    const d = codigo(down)
    for (const t of ['cc_knowledge_events', 'cc_product_knowledge', 'cc_knowledge_sources', 'cc_company_knowledge']) expect(d).toContain(`drop table if exists public.${t}`)
    expect(d).not.toMatch(/products|cc_visitors|cc_conversations/)
  })
})

describe('costura compartida y frontend', () => {
  it('_shared/conocimiento.ts no importa nada y filtra claves prohibidas; espeja _cc_audiencia', () => {
    const s = codigo(seam)
    expect(s).not.toMatch(/^import /m)
    expect(s).toMatch(/const PROHIBIDAS = \/\^\(price\|precio\|pvp\|cost\|costo\|unit_cost\|margin\|margen\|stock/)
    expect(s).toMatch(/if \(quien\.role === 'admin'\) return 'staff'/)
  })
  it('la UI administra solo por RPC (sin .from(), sin tablas), no manda nivel/estado/audiencia, y está en Sistema (no Comercial)', () => {
    const o = codigo(opsSrc)
    expect(o).not.toMatch(/\.from\(/)
    expect(o).toMatch(/p_audiencia: null/)
    expect(o).not.toMatch(/p_nivel|p_estado:/)
    expect(codigo(pantallaSrc)).not.toMatch(/\bprice\b|unit_cost|product_stock|supabase\.|\.from\(/)   // la pantalla solo habla por el cliente RPC
    expect(codigo(rolesSrc)).toMatch(/\{ key: 'av_conocimiento', label: 'Conocimiento de producto', icon: 'grid', section: 'Sistema' \}/)
    expect(codigo(registrySrc)).toMatch(/av_conocimiento: \(\) => <Conocimiento \/>/)
  })
  it('T2 e importación exigen confirmación explícita en la UI', () => {
    const p = codigo(pantallaSrc)
    expect(p).toMatch(/window\.confirm\('Contenido clínico\/regulatorio \(T2\)/)
    expect(p).toMatch(/window\.confirm\('Habilitar T2/)
    expect(p).toMatch(/window\.confirm\('Importa como BORRADOR/)
  })
  it('la Edge assistant legacy NO fue tocada por CC-3 (CC-4 la sustituirá; una sola arquitectura)', () => {
    expect(assistantSrc).not.toMatch(/cc_ficha_producto|cc_buscar|_shared\/conocimiento/)
  })
})
