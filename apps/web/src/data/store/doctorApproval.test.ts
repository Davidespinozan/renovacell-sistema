// Fase 1 — revisión humana de doctores: aprobar (con customer)/rechazar/revocar en
// modo mock (sin backend), y guards de texto contra copy falso y flujo de acceso.
import { describe, it, expect } from 'vitest'
import { addDoctor, approveDoctor, rejectDoctor, revokeDoctor, getSnapshot } from './doctorsStore'
import { deriveVerificationStatus } from '../ops/verification'

// Fuentes para guards de copy/flujo (?raw).
import doctoresSrc from '../../screens/admin/Doctores.tsx?raw'
import loginSrc from '../../screens/Login.tsx?raw'
import reviewPendingSrc from '../../screens/ReviewPending.tsx?raw'
import appSrc from '../../App.tsx?raw'
import doctorsStoreSrc from './doctorsStore.ts?raw'
import hardeningSrc from '../../../../../supabase/migrations/20260706194143_security_hardening.sql?raw'

const find = (id: string) => getSnapshot().find((d) => d.id === id)

describe('approveDoctor — exige resolver customer + marca verified/estado', () => {
  it('sin elegir customer → error (no aprueba)', async () => {
    const doc = addDoctor({ full_name: 'Dra. Test A', email: 'a@test.mx', organization: null })
    const r = await approveDoctor(doc.id, {})
    expect(r.ok).toBe(false)
    expect(find(doc.id)?.verified).toBe(false)
  })
  it('aprobar creando customer nuevo → verified + status verified', async () => {
    const doc = addDoctor({ full_name: 'Dra. Test B', email: 'b@test.mx', organization: null })
    const r = await approveDoctor(doc.id, { newCustomer: { full_name: 'Dra. Test B', email: 'b@test.mx' } as never })
    expect(r.ok).toBe(true)
    const d = find(doc.id)!
    expect(d.verified).toBe(true)
    expect(deriveVerificationStatus(d)).toBe('verified')
  })
  it('aprobar con customer seleccionado → verified', async () => {
    const doc = addDoctor({ full_name: 'Dra. Test C', email: 'c@test.mx', organization: null })
    const r = await approveDoctor(doc.id, { customerId: 'cust-123' })
    expect(r.ok).toBe(true)
    expect(find(doc.id)?.verified).toBe(true)
  })
  it('aprobación idempotente (dos veces) deja verified', async () => {
    const doc = addDoctor({ full_name: 'Dra. Test D', email: 'd@test.mx', organization: null })
    await approveDoctor(doc.id, { customerId: 'cust-1' })
    const r2 = await approveDoctor(doc.id, { customerId: 'cust-1' })
    expect(r2.ok).toBe(true)
    expect(find(doc.id)?.verified).toBe(true)
  })
})

describe('rejectDoctor / revokeDoctor — estado sin borrar cuenta', () => {
  it('rechazar → verified=false + status rejected + razón', () => {
    const doc = addDoctor({ full_name: 'Dra. Test E', email: 'e@test.mx', organization: null })
    rejectDoctor(doc.id, 'cédula no válida')
    const d = find(doc.id)!
    expect(d.verified).toBe(false)
    expect(deriveVerificationStatus(d)).toBe('rejected')
    expect((d.meta as { verification?: { reason?: string } }).verification?.reason).toBe('cédula no válida')
    // NO se borró: sigue en el store.
    expect(find(doc.id)).toBeTruthy()
  })
  it('revocar → verified=false + status revoked', () => {
    const doc = addDoctor({ full_name: 'Dra. Test F', email: 'f@test.mx', organization: null })
    revokeDoctor(doc.id)
    const d = find(doc.id)!
    expect(d.verified).toBe(false)
    expect(deriveVerificationStatus(d)).toBe('revoked')
  })
})

describe('copy — sin afirmaciones falsas de envío', () => {
  it('cockpit Doctores ya NO dice "Acceso enviado" / "se le envió acceso"', () => {
    expect(doctoresSrc).not.toMatch(/Acceso enviado/)
    expect(doctoresSrc).not.toMatch(/se le envió acceso/)
    // y sí ofrece aprobar/rechazar
    expect(doctoresSrc).toMatch(/Aprobar doctor/)
    expect(doctoresSrc).toMatch(/Rechazar/)
  })
  it('doctorsStore inviteDoctor ya NO afirma "acceso enviado / ya puedes iniciar sesión"', () => {
    expect(doctorsStoreSrc).not.toMatch(/Tu acceso al portal Renovacell está listo/)
    expect(doctorsStoreSrc).not.toMatch(/Acceso al Portal enviado/)
  })
  it('Login/ReviewPending: "te avisaremos" del doctor en revisión eliminado', () => {
    expect(reviewPendingSrc).not.toMatch(/Te avisaremos/)
    expect(loginSrc).not.toMatch(/te avisaremos/)
  })
})

describe('flujo/seguridad — gates server-side intactos', () => {
  it('el portal gatea doctor no verificado → ReviewPending', () => {
    expect(appSrc).toMatch(/role === 'doctor' && !verified/)
    expect(appSrc).toMatch(/ReviewPending/)
  })
  it('is_verified sigue gateando catálogo/pedidos (no se debilitó)', () => {
    expect(hardeningSrc).toMatch(/is_verified/)
    expect(hardeningSrc).toMatch(/products_safe/)
  })
})
