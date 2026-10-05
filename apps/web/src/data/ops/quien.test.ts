// W6-A1 · Las Edge Functions resuelven al llamante por UN solo camino (`_shared/quien.ts`),
// que niega a la cuenta suspendida; y ninguna vuelve a mirar `role_id` por su cuenta.
import { describe, it, expect } from 'vitest'
import { resolverQuien, tieneRol, CUENTA_SUSPENDIDA } from '../../../../../supabase/functions/_shared/quien'
import staffAdminSrc from '../../../../../supabase/functions/staff-admin/index.ts?raw'

const edges = import.meta.glob('../../../../../supabase/functions/*/index.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const soloCodigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

const caller = (user: { id: string; email?: string } | null) => ({ auth: { getUser: async () => ({ data: { user } }) } })
const admin = (row: Record<string, unknown> | null, error: { message: string } | null = null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }),
})

describe('resolverQuien', () => {
  it('sin sesión → 401', async () => {
    const r = await resolverQuien(caller(null), admin(null))
    expect(r).toMatchObject({ ok: false, status: 401 })
  })
  it('cuenta suspendida → 403 CUENTA_SUSPENDIDA, aunque el rol sea Dirección', async () => {
    const r = await resolverQuien(caller({ id: 'u1' }), admin({ role_id: 'admin', active: false }))
    expect(r).toMatchObject({ ok: false, status: 403, body: { error: CUENTA_SUSPENDIDA } })
  })
  it('cuenta activa → rol y datos del perfil', async () => {
    const r = await resolverQuien(caller({ id: 'u1', email: 'a@x.mx' }), admin({ role_id: 'warehouse', active: true, full_name: 'Ana', meta: { capabilities: ['diseno'] } }))
    expect(r.ok && r.quien).toMatchObject({ uid: 'u1', role: 'warehouse', active: true, full_name: 'Ana', email: 'a@x.mx' })
    expect(r.ok && tieneRol(r.quien, ['admin', 'warehouse'])).toBe(true)
    expect(r.ok && tieneRol(r.quien, ['admin'])).toBe(false)
  })
  it('sin perfil → sesión válida pero sin rol (nunca pasa un filtro de rol)', async () => {
    const r = await resolverQuien(caller({ id: 'u1' }), admin(null))
    expect(r.ok && r.quien.role).toBe('')
    expect(r.ok && tieneRol(r.quien, ['admin', 'doctor', ''])).toBe(false)
  })
  it('si el perfil no se pudo leer, falla cerrado (500), no asume un rol', async () => {
    const r = await resolverQuien(caller({ id: 'u1' }), admin(null, { message: 'boom' }))
    expect(r).toMatchObject({ ok: false, status: 500 })
  })
})

describe('guarda de repositorio: las edges autenticadas pasan por resolverQuien', () => {
  const nombre = (k: string) => k.split('/').slice(-2, -1)[0]
  // comm-dispatch es la excepción documentada: no usa llave de servicio (invariante W4) y
  // delega TODA la autoridad a comm_reclamar con el JWT del llamante, donde auth_role()
  // ya niega al suspendido; solo traduce CUENTA_SUSPENDIDA a 403.
  const autenticadas = Object.entries(edges).filter(([k, s]) => !k.includes('/comm-dispatch/')
    && /Authorization: (req\.headers\.get\('Authorization'\)|authHeader)/.test(soloCodigo(s)))
  it('hay edges autenticadas que auditar', () => { expect(autenticadas.length).toBeGreaterThanOrEqual(13) })
  it('comm-dispatch traduce CUENTA_SUSPENDIDA de la base a 403 sin llave de servicio', () => {
    const c = soloCodigo(edges[Object.keys(edges).find((k) => k.includes('/comm-dispatch/'))!])
    expect(c).toMatch(/CUENTA_SUSPENDIDA/); expect(c).not.toMatch(/SERVICE_ROLE/)
  })
  for (const [k, s] of autenticadas) {
    it(`${nombre(k)} resuelve al llamante con resolverQuien`, () => {
      expect(soloCodigo(s)).toMatch(/resolverQuien\(/)
    })
    it(`${nombre(k)} no vuelve a consultar role_id por su cuenta ni usa auth.getUser() suelto`, () => {
      const c = soloCodigo(s)
      expect(c).not.toMatch(/\.select\('role_id/)
      expect(c).not.toMatch(/auth\.getUser\(\)/)
    })
  }
})

describe('staff-admin: la baja no borra; suspender y reactivar son comandos de la base', () => {
  const c = soloCodigo(staffAdminSrc)
  it('ya no existe deleteUser', () => { expect(c).not.toMatch(/deleteUser/) })
  it('delete = baja por suspender_staff con p_baja: true', () => {
    expect(c).toMatch(/caller\.rpc\('suspender_staff', \{ p_uid: body\.id, p_motivo: motivo, p_baja: baja \}\)/)
    expect(c).toMatch(/const baja = action === 'delete'/)
  })
  it('reactivar pasa por reactivar_staff y readmite en Auth', () => {
    expect(c).toMatch(/caller\.rpc\('reactivar_staff'/)
    expect(c).toMatch(/ban_duration: 'none'/)
  })
  it('la revocación en Auth es best-effort y se reporta, no se promete', () => {
    expect(c).toMatch(/ban_duration: '876000h'/)
    expect(c).toMatch(/sesiones_revocadas/)
  })
  it('los comandos corren con el JWT del llamante (la base decide), no con service_role', () => {
    expect(c).not.toMatch(/admin\.rpc\('suspender_staff'/)
    expect(c).not.toMatch(/admin\.rpc\('reactivar_staff'/)
  })
})
