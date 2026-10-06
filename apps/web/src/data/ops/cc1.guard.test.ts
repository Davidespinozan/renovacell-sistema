// CC-1 · Guardas de repositorio: la migración sostiene los invariantes por base; la edge
// `visitor` deriva el perfil del JWT y nunca persiste el token; las edges públicas ligan por
// posesión (no por correo); el portal y la landing canónica integran de forma silenciosa.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261027120000_cc1_visitante.sql?raw'
import down from '../../../../../supabase/rollback/cc1/99_down.sql?raw'
import visitorSrc from '../../../../../supabase/functions/visitor/index.ts?raw'
import visitanteSrc from '../../../../../supabase/functions/_shared/visitante.ts?raw'
import limiteSrc from '../../../../../supabase/functions/_shared/limite.ts?raw'
import captureSrc from '../../../../../supabase/functions/capture-lead/index.ts?raw'
import registerSrc from '../../../../../supabase/functions/register-doctor/index.ts?raw'
import roleSrc from '../../auth/RoleContext.tsx?raw'
import useAuthSrc from '../../auth/useAuth.ts?raw'
import opsSrc from './visitante.ts?raw'
import landingSrc from '../../../public/landing/index.html?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('migración CC-1', () => {
  const c = codigo(mig)
  it('V1–V5 · cc_visitors guarda solo hash hex de 64 (único), estados cerrados, sin IP ni user-agent', () => {
    expect(c).toMatch(/token_hash\s+text not null unique/)
    expect(c).toMatch(/ck_ccv_hash\s+check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
    expect(c).toMatch(/ck_ccv_estado\s+check \(estado in \('activo', 'adoptado', 'revocado'\)\)/)
    expect(c).not.toMatch(/ip_address|user_agent|ip text|fingerprint/i)
    const tabla = c.slice(c.indexOf('create table public.cc_visitors ('), c.indexOf('create index idx_ccv_adopted'))
    expect(tabla).not.toMatch(/email|phone|telefono|correo/i)   // el visitante no tiene columnas de contacto
  })
  it('V6/V7/V10/V11 · adoptar: perfil requerido y activo, posesión (hash) o vínculo del registro; conflicto si pertenece a otro; idempotente; rota el token', () => {
    expect(c).toMatch(/if not prof\.active then raise exception 'CUENTA_SUSPENDIDA'/)
    expect(c).toMatch(/raise exception 'SESION_INVALIDA'/)
    expect(c).toMatch(/return jsonb_build_object\('estado', 'ajeno', 'adoptados', 0\)/)
    expect(c).toMatch(/return jsonb_build_object\('estado', 'ya_adoptado'/)
    expect(c).toMatch(/token_hash = encode\(extensions\.digest\(id::text \|\| clock_timestamp\(\)::text \|\| random\(\)::text, 'sha256'\), 'hex'\)/)
    expect(c).toMatch(/where pending_profile_id = p_profile and estado = 'activo' order by created_at for update/)
  })
  it('V8/V9 · first_touch solo si es null; last_touch solo si la visita es atribuible y distinta', () => {
    expect(c).toMatch(/first_touch\s+= case when first_touch is null and attr <> '\{\}'::jsonb then attr else first_touch end/)
    expect(c).toMatch(/last_touch\s+= case when public\._cc_atribuible\(attr\) and attr is distinct from last_touch then attr else last_touch end/)
    expect(c).toMatch(/renovacell\\\.mx\|netlify\\\.app/)
  })
  it('V15/V16 · el vendedor se resuelve desde un código opaco activo y un vendedor activo; solo Dirección crea/revoca códigos', () => {
    expect(c).toMatch(/where c\.code = v_code and c\.activo and s\.active and s\.role_id = 'pos'/)
    expect(c).toMatch(/if public\.auth_role\(\) <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección crea códigos/)
    expect(c).toMatch(/ck_ccrc_code check \(code ~ '\^\[A-Z2-7\]\{8\}\$'\)/)
  })
  it('V17 · no toca verified, precio, dinero, inventario ni pedidos; V12 · dominios distintos (solo prospects.visitor_id aditivo)', () => {
    expect(c).not.toMatch(/set verified|update public\.orders|update public\.customers|products\b|payment_entries|lots\b/)
    expect(c).toMatch(/alter table public\.prospects add column if not exists visitor_id uuid references public\.cc_visitors\(id\) on delete set null/)
  })
  it('U · RLS en las 3 tablas, sin políticas, sin privilegios de cliente; comandos solo service_role; referidos vía RPC para Dirección', () => {
    for (const t of ['cc_visitors', 'cc_visitor_events', 'cc_referral_codes']) expect(c).toContain(`alter table public.${t} enable row level security`)
    expect(c).not.toMatch(/create policy/)
    expect(c).toMatch(/revoke all on public\.cc_visitors, public\.cc_visitor_events, public\.cc_referral_codes from public, anon, authenticated/)
    expect(c).toMatch(/grant execute on function public\.cc_visitante_abrir\(text, text, jsonb, text\), public\.cc_visitante_vincular_registro\(text, uuid\),\n\s+public\.cc_visitante_prospecto\(text, uuid\), public\.cc_visitante_adoptar\(text, uuid\), public\.cc_visitantes_purgar\(int\) to service_role/)
    expect(c).toMatch(/grant execute on function public\.cc_codigo_referido_crear\(uuid\), public\.cc_codigo_referido_revocar\(text\) to authenticated, service_role/)
  })
  it('T · retención: purga solo anónimos no vinculados, mínimo 30 días, sin cron', () => {
    expect(c).toMatch(/la retención mínima es 30 días/)
    expect(c).toMatch(/v\.estado = 'activo' and v\.adopted_profile_id is null and v\.pending_profile_id is null/)
    expect(c).not.toMatch(/cron\.schedule/)
  })
  it('L · norm_telefono_mx: MX a 10 dígitos, internacional íntegro, < 7 nulo; dedupe lo usa en ambos lados', () => {
    expect(c).toMatch(/when length\(d\) = 12 and left\(d, 2\) = '52' then right\(d, 10\)/)
    expect(c).toMatch(/when length\(d\) = 13 and left\(d, 3\) = '521' then right\(d, 10\)/)
    expect(c).toMatch(/else d end/)
    expect(c).toMatch(/public\.norm_telefono_mx\(p\.phone\) = public\.norm_telefono_mx\(p_phone\)/)
  })
  it('rollback: retira todo y restaura el dedupe CC-0B', () => {
    const d = codigo(down)
    expect(d).toMatch(/drop table if exists public\.cc_visitors/); expect(d).toMatch(/drop column if exists visitor_id/)
    expect(d).toMatch(/>= 7/); expect(d).not.toMatch(/norm_telefono_mx\(p\./)
  })
})

describe('edge visitor + módulo compartido', () => {
  const v = codigo(visitorSrc); const sh = codigo(visitanteSrc)
  it('F · el perfil viene del JWT (resolverQuien); el cliente nunca manda profile_id/visitor_id como autoridad', () => {
    expect(v).toMatch(/p_profile: q\.quien\.uid/)
    expect(v).not.toMatch(/p\.profile_id|p\.visitor_id|p_profile: p\./)
  })
  it('V2/V3/P · el token se hashea antes de la base; solo viaja al cliente cuando se acaba de crear; no se registra', () => {
    expect(v).toMatch(/const hash = await hashToken\(p\.token\)/)
    expect(v).toMatch(/r\.nuevo \? \{ visitor_id: r\.visitor_id, nuevo: true, token: nuevoToken \} : \{ visitor_id: r\.visitor_id, nuevo: false \}/)
    expect(v).not.toMatch(/console\.(log|error|warn)/)
    expect(v).not.toMatch(/p_token\b|token: p\.token/)
    expect(sh).toMatch(/crypto\.getRandomValues\(new Uint8Array\(n\)\)/); expect(sh).toMatch(/SHA-256/)
    expect(sh).not.toMatch(/^import /m)
  })
  it('S · limitador CC-0B en abrir (IP + global) y en adoptar (uid); scopes definidos; CORS por lista blanca', () => {
    expect(v).toMatch(/\{ scope: 'visitor_abrir', sujeto \}, \{ scope: 'visitor_abrir_global', sujeto: 'global' \}/)
    expect(v).toMatch(/\{ scope: 'visitor_adoptar', sujeto: sujetoUid\(q\.quien\.uid\) \}/)
    for (const s of ['visitor_abrir', 'visitor_abrir_global', 'visitor_adoptar']) expect(codigo(limiteSrc)).toContain(`${s}:`)
    expect(v).toMatch(/Deno\.serve\(conCors\(/); expect(v).not.toMatch(/'Access-Control-Allow-Origin': '\*'/)
    expect(v).not.toMatch(/_shared\/observa/)
  })
  it('errores de adopción mapeados (sin SQL); abrir falla cerrado con 503', () => {
    expect(v).toMatch(/mapearErrorAdopcion\(error\.message\)/); expect(v).toMatch(/estado === 'ajeno'\) \{ const e = mapearErrorAdopcion\('VISITANTE_AJENO'\)/)
    expect(v).toMatch(/return json\(503, \{ error: 'no_disponible'/)
  })
})

describe('capture-lead / register-doctor · posesión, no correo', () => {
  it('capture-lead liga SOLO el prospecto nuevo por hash del token; el duplicado no se re-liga', () => {
    const s = codigo(captureSrc)
    expect(s).toMatch(/const visitorHash = await hashToken\(payload\.visitor_token\)/)
    const dup = s.indexOf('return json(200, { ok: true }) // no revela que ya existía'); const liga = s.indexOf("rpc('cc_visitante_prospecto'")
    expect(liga).toBeGreaterThan(dup)
    expect(s).toMatch(/\.select\('id'\)\.single\(\)/)
  })
  it('register-doctor: liga prospectos por posesión y deja el vínculo del registro con el uid creado; sin tocar verified ni SEP', () => {
    const s = codigo(registerSrc)
    expect(s).toMatch(/cc_visitante_vincular_registro', \{ p_hash: visitorHash, p_profile: uid \}/)
    expect((s.match(/await ligarProspecto\(pr\?\.id\)/g) ?? []).length).toBe(2)
    expect(s).toMatch(/verified: false/); expect(s).not.toMatch(/verified: true/)
    expect(s).not.toMatch(/p_profile: p\.|p_profile: email/)
  })
})

describe('frontend · integración silenciosa', () => {
  it('RoleContext: sin sesión abre, con sesión adopta; SIGNED_IN adopta', () => {
    const r = codigo(roleSrc)
    expect(r).toMatch(/if \(active\) void \(s \? adoptarVisitante\(\) : abrirVisitante\(\)\)/)
    expect(r).toMatch(/else if \(event === 'SIGNED_IN'\) void adoptarVisitante\(\)/)
  })
  it('useAuth.register manda visitor_token (posesión), no un visitor_id', () => {
    const u = codigo(useAuthSrc)
    expect(u).toMatch(/visitor_token: leerTokenVisitante\(\)/); expect(u).not.toMatch(/visitor_id/)
  })
  it('ops: nunca manda profile_id/visitor_id; usa localStorage con la llave rc_visitor', () => {
    const o = codigo(opsSrc)
    expect(o).toMatch(/LLAVE_VISITANTE = 'rc_visitor'/)
    expect(o).not.toMatch(/profile_id|visitor_id:/)
  })
  it('landing canónica (mirror en /): abre visitante, guarda el token solo si es nuevo, lo manda a capture-lead y al registro', () => {
    expect(landingSrc).toMatch(/\/functions\/v1\/visitor/)
    expect(landingSrc).toMatch(/if\(d&&d\.nuevo&&d\.token\)/)
    expect(landingSrc).toMatch(/channel:'Landing · Asistente',interest:L\.interest\|\|'',visitor_token:window\.__rncVisitorToken\|\|null/)
    expect(landingSrc).toMatch(/body:JSON\.stringify\(Object\.assign\(\{\},d,\{visitor_token:window\.__rncVisitorToken\|\|null\}\)\)/)
    expect(landingSrc).not.toMatch(/__rncVisitorToken=.{0,40}@/)
  })
})
