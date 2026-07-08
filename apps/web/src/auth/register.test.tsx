// @vitest-environment jsdom
// Auto-registro del doctor con verificación SEP (modo mock: simulador por último dígito).
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { RoleProvider } from './RoleContext'
import { useAuth } from './useAuth'

const wrapper = ({ children }: { children: React.ReactNode }) => <RoleProvider>{children}</RoleProvider>

describe('auto-registro (verificación SEP, mock)', () => {
  it('AUTO: cédula de médico cuyo nombre coincide → entra (decision auto)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    let r: { decision: string } | undefined
    await act(async () => { r = await result.current.register({ name: 'Dra. Laura Méndez', email: 'laura@clinica.mx', cedula: '1234561', password: 'secret1' }) })
    expect(r?.decision).toBe('auto')
  })

  it('REVIEW: profesión no médica → a revisión (sin cuenta)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    let r: { decision: string } | undefined
    await act(async () => { r = await result.current.register({ name: 'Lic. Ana Torres', email: 'ana@x.mx', cedula: '1234569', password: 'secret1' }) })
    expect(r?.decision).toBe('review')
  })

  it('REJECT: cédula inexistente → rechazo', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    let r: { decision: string } | undefined
    await act(async () => { r = await result.current.register({ name: 'Nombre Apellido', email: 'z@x.mx', cedula: '1234560', password: 'secret1' }) })
    expect(r?.decision).toBe('reject')
  })

  it('valida datos mínimos (contraseña corta)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    let r: { decision: string; error?: string } | undefined
    await act(async () => { r = await result.current.register({ name: 'Dra. X Prueba', email: 'x@x.mx', cedula: '1234561', password: '123' }) })
    expect(r?.decision).toBe('reject')
    expect(r?.error).toBeTruthy()
  })
})
