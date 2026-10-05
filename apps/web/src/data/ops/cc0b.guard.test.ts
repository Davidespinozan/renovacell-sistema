// CC-0B · Guardas de repositorio: la migración cierra lo medido, el rollback existe, las
// edges públicas limitan ANTES del trabajo caro, el assistant tiene techo de costo y
// conserva CC-0A, el CORS `*` desaparece de las funciones tocadas y los webhooks no cambian.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261026120000_cc0b_frontera_publica.sql?raw'
import down from '../../../../../supabase/rollback/cc0b/99_down.sql?raw'
import assistantSrc from '../../../../../supabase/functions/assistant/index.ts?raw'
import captureSrc from '../../../../../supabase/functions/capture-lead/index.ts?raw'
import registerSrc from '../../../../../supabase/functions/register-doctor/index.ts?raw'
import stripeWhSrc from '../../../../../supabase/functions/stripe-webhook/index.ts?raw'
import metaWhSrc from '../../../../../supabase/functions/meta-webhook/index.ts?raw'
import limiteSrc from '../../../../../supabase/functions/_shared/limite.ts?raw'

const edges = import.meta.glob('../../../../../supabase/functions/*/index.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const nombre = (p: string) => p.split('/').slice(-2)[0]
const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('migración CC-0B', () => {
  const c = codigo(mig)
  it('limitador: tabla con RLS, UPSERT atómico en una sentencia, solo service_role, argumentos validados, limpieza acotada por scope', () => {
    expect(c).toMatch(/create table if not exists public\.rate_limit_buckets/)
    expect(c).toMatch(/alter table public\.rate_limit_buckets enable row level security/)
    expect(c).toMatch(/insert into public\.rate_limit_buckets as b[\s\S]*?on conflict \(scope, subject, window_start\)\n\s+do update set count = greatest\(b\.count \+ p_cost, 0\)/)
    expect(c).not.toMatch(/select count\(\*\)[\s\S]{0,200}insert into public\.rate_limit_buckets/)
    expect(c).toMatch(/revoke all on function public\.rate_limit_hit\(text, text, int, int, int\) from public, anon, authenticated;\ngrant execute on function public\.rate_limit_hit\(text, text, int, int, int\) to service_role;/)
    expect(c).toMatch(/RL_ARGUMENTOS/)
    expect(c).toMatch(/delete from public\.rate_limit_buckets\n\s+where scope = p_scope and window_start < v_start - make_interval/)
  })
  it('dedupe indexado con la misma regla (correo en minúsculas / ≥7 dígitos), solo service_role', () => {
    expect(c).toMatch(/create index if not exists idx_prospects_email_lower\n\s+on public\.prospects \(lower\(email\)\)/)
    expect(c).toMatch(/create index if not exists idx_prospects_phone_digits\n\s+on public\.prospects \(regexp_replace\(phone, '\[\^0-9\]', '', 'g'\)\)/)
    expect(c).toMatch(/>= 7/)
    expect(c).toMatch(/grant execute on function public\.buscar_prospecto_duplicado\(text, text\) to service_role/)
  })
  it('higiene: anon solo dos lecturas; vistas sin escritura; T/R/T fuera; escrituras de authenticated solo con política; defaults de anon retirados', () => {
    expect(c).toMatch(/revoke all on all tables in schema public from anon;/)
    expect(c).toMatch(/grant select on public\.catalog_public to anon;\ngrant select on public\.landing_content to anon;/)
    expect(c).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.%I from anon, authenticated/)
    expect(c).toMatch(/revoke truncate, references, trigger on public\.%I from anon, authenticated/)
    expect(c).toMatch(/p\.cmd in \(v_cmd, 'ALL'\)\n\s+and \(p\.roles && array\['authenticated', 'public'\]::name\[\]\)/)
    for (const o of ['tables', 'sequences', 'functions']) expect(c).toContain(`alter default privileges for role postgres in schema public revoke all on ${o} from anon;`)
    expect(c).not.toMatch(/revoke all on all tables in schema public from authenticated/)
    expect(c).not.toMatch(/default privileges[^\n]*from authenticated/)
  })
  it('no toca RLS, funciones de negocio ni CC-0A; verificación final abortante; sin EXCEPTION WHEN OTHERS', () => {
    expect(c).not.toMatch(/create policy|drop policy|alter policy/)
    expect(c).not.toMatch(/function public\.(precio_de|crear_pedido|vender_pos|puede_ver_precio|pedido_visible|profiles_guard)\b/)
    expect(c).toMatch(/raise exception 'CC0B: % privilegios de escritura sobre vistas/)
    expect(c).not.toMatch(/exception when others/i)
  })
  it('rollback retira los objetos y restaura defaults de anon, sin reabrir privilegios', () => {
    const d = codigo(down)
    expect(d).toMatch(/drop function if exists public\.rate_limit_hit/); expect(d).toMatch(/drop table if exists public\.rate_limit_buckets/)
    expect(d).toMatch(/alter default privileges for role postgres in schema public grant all on tables to anon/)
    expect(d).not.toMatch(/grant (insert|update|delete|all) on (all tables|public\.(products_safe|catalog_public|v_))/)
  })
})

describe('assistant · frontera de abuso y costo (CC-0A preservado)', () => {
  const a = codigo(assistantSrc)
  it('A · ráfaga/hora/global ANTES de cargar catálogo y de llamar a Anthropic; techo diario pre-cargado ANTES del fetch; 429/503 sin llamar', () => {
    const limiter = a.indexOf('limitarTodas(limitador, rafaga)'); const cat = a.indexOf("from('products_safe')"); const fetch = a.indexOf("fetch('https://api.anthropic.com")
    const tokens = a.indexOf("scope: 'assistant_tokens_dia', sujeto: 'global', costo: estimado")
    expect(limiter).toBeGreaterThan(a.indexOf('resolverQuien(caller')); expect(cat).toBeGreaterThan(limiter)
    expect(tokens).toBeGreaterThan(cat); expect(fetch).toBeGreaterThan(tokens)
    expect(a).toMatch(/if \(!veredicto\.permitido\) return respuestaLimite\(veredicto\)/)
    expect(a).toMatch(/if \(!costo\.permitido\) return respuestaLimite\(costo\)/)
  })
  it('B · consumo real ajusta la pre-carga (usados − estimado), global y por uid', () => {
    expect(a).toMatch(/const usados = Number\(data\?\.usage\?\.input_tokens \?\? 0\) \+ Number\(data\?\.usage\?\.output_tokens \?\? 0\)/)
    expect(a).toMatch(/limitar\(limitador, 'assistant_tokens_dia', 'global', \{ costo: usados - estimado \}\)/)
  })
  it('E · doctor → uid; landing → IP hasheada + cubo global; sin memoria, sin tools nuevas, catálogo del servidor (CC-0A)', () => {
    expect(a).toMatch(/const sujeto = uid \? sujetoUid\(uid\) : await sujetoPublico\(req\)/)
    expect(a).toMatch(/\{ scope: 'assistant_landing_global', sujeto: 'global' \}/)
    expect(a).not.toMatch(/p\.products/); expect(a).toMatch(/system: systemPrompt\(mode, products\)/)
    expect((a.match(/name: 'save_prospect'/g) ?? []).length).toBe(1)
    expect(a).not.toMatch(/_shared\/observa/)
  })
  it('CORS: sin `*`, envuelto en conCors', () => {
    expect(a).not.toMatch(/'Access-Control-Allow-Origin': '\*'/); expect(a).toMatch(/Deno\.serve\(conCors\(/)
  })
})

describe('capture-lead · límite antes de la base, dedupe indexado', () => {
  const s = codigo(captureSrc)
  it('G · limitar ocurre tras honeypot/validación y ANTES de cualquier lectura/escritura; 429/503', () => {
    const hp = s.indexOf("payload.website"); const lim = s.indexOf('limitarTodas(admin'); const dedupe = s.indexOf("rpc('buscar_prospecto_duplicado'"); const ins = s.indexOf("from('prospects').insert")
    expect(hp).toBeGreaterThan(0); expect(lim).toBeGreaterThan(hp); expect(dedupe).toBeGreaterThan(lim); expect(ins).toBeGreaterThan(dedupe)
    expect(s).toMatch(/if \(!veredicto\.permitido\) return respuestaLimite\(veredicto\)/)
    expect(s).toMatch(/\{ scope: 'capture_lead_global', sujeto: 'global' \}/)
  })
  it('ya no lee toda la tabla; no revela duplicados; conserva asignación y resolutor', () => {
    expect(s).not.toMatch(/from\('prospects'\)\.select\('id, name, email, phone, meta'\)/)
    expect(s).toMatch(/return json\(200, \{ ok: true \}\) \/\/ no revela que ya existía/)
    expect(s).toMatch(/resolve_customer_identity/); expect(s).toMatch(/role_id', 'pos'/)
    expect(s).not.toMatch(/'Access-Control-Allow-Origin': '\*'/); expect(s).toMatch(/Deno\.serve\(conCors\(/)
    expect(s).not.toMatch(/_shared\/observa/)
  })
})

describe('register-doctor · límite antes de Auth/Storage/proveedores', () => {
  const s = codigo(registerSrc)
  it('H · limitar tras honeypot y validación de forma, antes del pre-chequeo de perfiles, SEP, createUser y Storage; con telemetría A3.3', () => {
    const h = s.indexOf('Deno.serve(conCors(')
    const hp = s.indexOf('honeypot', h); const lim = s.indexOf('limitarTodas(admin', h); const dup = s.indexOf(".ilike('email', email)", h); const sep = s.indexOf('lookupSep(', h); const cu = s.indexOf('auth.admin.createUser', h)
    expect(h).toBeGreaterThan(0); expect(hp).toBeGreaterThan(h); expect(lim).toBeGreaterThan(hp)
    for (const x of [dup, sep, cu]) expect(x).toBeGreaterThan(lim)
    // La telemetría A3.3 se inyecta cuando el archivo ya la tiene (A3.3 va en su propio rollout).
    if (/_shared\/observa/.test(s)) expect(s).toMatch(/\{ reportar: obs \}/)
    else expect(s).not.toMatch(/reportar/)
    expect(s).toMatch(/\{ scope: 'register_doctor_global', sujeto: 'global' \}/)
  })
  it('conserva honeypot, verificación humana (nunca verified: true) y la instrumentación A3.3', () => {
    expect(s).toMatch(/honeypot/); expect(s).not.toMatch(/verified: true/)
    if (/_shared\/observa/.test(s)) { expect(s).toMatch(/obs\('sep', 'provider_error'/); expect(s).toMatch(/obs\('crear_cuenta', 'internal_error'/) }
    expect(s).not.toMatch(/'Access-Control-Allow-Origin': '\*'/)
  })
})

describe('CORS · inventario y webhooks', () => {
  it('las funciones con conCors ya no tienen `*`; las demás siguen con `*` (pendiente post-rollout, documentado)', () => {
    const conHelper: string[] = []; const conAsterisco: string[] = []
    for (const [p, src] of Object.entries(edges)) {
      if (/Deno\.serve\(conCors\(/.test(src)) conHelper.push(nombre(p))
      if (/'Access-Control-Allow-Origin': '\*'/.test(src)) conAsterisco.push(nombre(p))
    }
    expect(conHelper.sort()).toEqual(['assistant', 'capture-lead', 'cfdi', 'invite-doctor', 'meta-send', 'register-doctor'])
    for (const f of conHelper) expect(conAsterisco, f).not.toContain(f)
    expect(conAsterisco.sort()).toEqual(['cfdi-cancel', 'cfdi-cancel-status', 'cfdi-download', 'cfdi-send', 'comm-dispatch', 'report-transfer', 'shipping', 'staff-admin', 'stripe-checkout', 'verify-cedula'])
  })
  it('L/M · los webhooks firmados no cambian: sin CORS, sin limitador', () => {
    for (const src of [stripeWhSrc, metaWhSrc]) {
      expect(src).not.toMatch(/Access-Control-Allow-Origin/); expect(src).not.toMatch(/conCors|limitar|_shared\/limite/)
    }
    expect(stripeWhSrc).toMatch(/constructEventAsync/); expect(metaWhSrc).toMatch(/X-Hub-Signature-256|x-hub-signature-256/i)
  })
})

describe('limite.ts · aislamiento', () => {
  it('sin imports (probable desde vitest), sin IP cruda persistida, sin service_role ni Deno en el módulo', () => {
    const l = codigo(limiteSrc)
    expect(l).not.toMatch(/^import /m)
    expect(l).not.toMatch(/SERVICE_ROLE|Deno\.env\.get\(/)
    expect(l).toMatch(/crypto\.subtle/)
    expect(l).toMatch(/'ip:desconocida'/)
  })
})
