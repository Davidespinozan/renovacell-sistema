// @vitest-environment jsdom
// Búsqueda global / paleta de comandos: además de entidades, indexa PANTALLAS
// ("Ir a") y LOTES por código. Se prueba con el rol admin (default del provider).
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { RoleProvider } from '../auth/RoleContext'
import { useGlobalSearch } from '../data/hooks/useGlobalSearch'

const wrapper = ({ children }: { children: React.ReactNode }) => <RoleProvider>{children}</RoleProvider>

describe('búsqueda global', () => {
  it('indexa pantallas como comandos "Ir a"', () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper })
    const hits = result.current('Doctores')
    expect(hits.some((r) => r.type === 'Ir a' && r.screen === 'av_doc')).toBe(true)
  })

  it('indexa lotes por código de lote', () => {
    const { result } = renderHook(() => useGlobalSearch(), { wrapper })
    const hits = result.current('MGP-90')
    expect(hits.some((r) => r.type === 'Lote')).toBe(true)
  })
})
