import { describe, it, expect } from 'vitest'
import { deriveVerificationStatus, buildVerificationMeta, VERIF_LABEL } from './verification'

describe('deriveVerificationStatus — verified es la autoridad de acceso', () => {
  it('verified=true → "verified" aunque meta diga otra cosa', () => {
    expect(deriveVerificationStatus({ verified: true, meta: {} })).toBe('verified')
    expect(deriveVerificationStatus({ verified: true, meta: { verification: { status: 'revoked' } } })).toBe('verified')
  })
  it('verified=false sin meta → "pending"', () => {
    expect(deriveVerificationStatus({ verified: false, meta: {} })).toBe('pending')
    expect(deriveVerificationStatus({ verified: false })).toBe('pending')
  })
  it('verified=false lee meta.verification.status (rejected/revoked/pending)', () => {
    expect(deriveVerificationStatus({ verified: false, meta: { verification: { status: 'rejected' } } })).toBe('rejected')
    expect(deriveVerificationStatus({ verified: false, meta: { verification: { status: 'revoked' } } })).toBe('revoked')
    expect(deriveVerificationStatus({ verified: false, meta: { verification: { status: 'pending' } } })).toBe('pending')
  })
  it('meta "verified" obsoleto con verified=false NO reporta acceso → "pending"', () => {
    expect(deriveVerificationStatus({ verified: false, meta: { verification: { status: 'verified' } } })).toBe('pending')
  })
  it('hay etiqueta legible para cada estado', () => {
    ;(['pending', 'verified', 'rejected', 'revoked'] as const).forEach((s) => expect(VERIF_LABEL[s]).toBeTruthy())
  })
})

describe('buildVerificationMeta', () => {
  it('incluye status y reviewed_at; reason solo si se pasa', () => {
    const a = buildVerificationMeta('rejected', 'admin-1', 'cédula inválida')
    expect(a.status).toBe('rejected')
    expect(a.reviewed_by).toBe('admin-1')
    expect(a.reason).toBe('cédula inválida')
    expect(a.reviewed_at).toBeTruthy()
    const b = buildVerificationMeta('verified', 'admin-1')
    expect(b.reason).toBeUndefined()
  })
})
