// @vitest-environment jsdom
// VERSIÓN PUBLICADA · la app abierta detecta que se publicó otra versión y ofrece actualizar (nunca recarga sola).
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { VersionNueva } from './VersionNueva'
import vite from '../../vite.config.ts?raw'
import netlify from '../../../../netlify.toml?raw'

afterEach(cleanup)
describe('Versión nueva publicada', () => {
  it('si el sitio publica otro commit, avisa y "Actualizar" recarga; "Después" lo oculta', async () => {
    const recargar = vi.fn()
    render(<VersionNueva actual="aaa" leer={async () => 'bbb'} recargar={recargar} />)
    fireEvent.click(await screen.findByTestId('version-actualizar'))
    expect(recargar).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Después'))
    expect(screen.queryByTestId('version-nueva')).toBeNull()
  })
  it('misma versión, sitio caído o compilación sin commit: no dice nada', async () => {
    const leer = vi.fn(async () => 'aaa')
    render(<VersionNueva actual="aaa" leer={leer} />)
    await waitFor(() => expect(leer).toHaveBeenCalled())
    expect(screen.queryByTestId('version-nueva')).toBeNull()
    cleanup(); render(<VersionNueva actual="aaa" leer={async () => null} />)
    await new Promise((r) => setTimeout(r, 10)); expect(screen.queryByTestId('version-nueva')).toBeNull()
    const leer2 = vi.fn(async () => 'bbb'); cleanup(); render(<VersionNueva actual="desconocida" leer={leer2} />)
    await new Promise((r) => setTimeout(r, 10)); expect(leer2).not.toHaveBeenCalled()
  })
  it('cada compilación publica /version.json con su commit y el sitio no lo cachea', () => {
    expect(vite).toMatch(/fileName: 'version\.json'/); expect(vite).toMatch(/process\.env\.COMMIT_REF/)
    expect(netlify).toMatch(/for = "\/version\.json"\s*\n\s*\[headers\.values\]\s*\n\s*Cache-Control = "no-store"/)
  })
})
