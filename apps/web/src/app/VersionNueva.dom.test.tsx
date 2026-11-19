// @vitest-environment jsdom
// VERSIÓN PUBLICADA · la app abierta detecta que se publicó otra versión y se actualiza sola en un momento seguro.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { VersionNueva, hayTrabajoAbierto } from './VersionNueva'
import vite from '../../vite.config.ts?raw'
import netlify from '../../../../netlify.toml?raw'

afterEach(cleanup)
describe('Versión nueva publicada', () => {
  it('si el sitio publica otro commit, avisa y "Actualizar ahora" recarga; "Ocultar" lo oculta', async () => {
    const recargar = vi.fn()
    render(<VersionNueva actual="aaa" leer={async () => 'bbb'} recargar={recargar} trabajoAbierto={() => true} />)
    fireEvent.click(await screen.findByTestId('version-actualizar'))
    expect(recargar).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Ocultar'))
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
  it('se actualiza SOLA al volver a la app si no dejó nada a medio hacer; si está trabajando, espera', async () => {
    const recargar = vi.fn(); let ocupado = true
    render(<VersionNueva actual="aaa" leer={async () => 'bbb'} recargar={recargar} trabajoAbierto={() => ocupado} />)
    await screen.findByTestId('version-nueva')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(recargar).not.toHaveBeenCalled()          // tiene algo a medio escribir: no recarga
    ocupado = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(recargar).toHaveBeenCalledTimes(1)        // ya no: recarga al volver
  })
  it('se actualiza SOLA tras un rato sin tocar nada', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const recargar = vi.fn()
    render(<VersionNueva actual="aaa" leer={async () => 'bbb'} recargar={recargar} quietoMs={1000} trabajoAbierto={() => false} />)
    await screen.findByTestId('version-nueva')
    await vi.advanceTimersByTimeAsync(16_000)
    expect(recargar).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
  it('detecta trabajo abierto: ventana abierta o texto escrito (los buscadores no cuentan)', () => {
    document.body.innerHTML = '<input placeholder="Buscar cliente" value="ana">'
    expect(hayTrabajoAbierto()).toBe(false)
    document.body.innerHTML = '<textarea>hola doctora</textarea>'
    expect(hayTrabajoAbierto()).toBe(true)
    document.body.innerHTML = '<div class="overlay"></div>'
    expect(hayTrabajoAbierto()).toBe(true)
    document.body.innerHTML = ''
  })
  it('cada compilación publica /version.json con su commit y el sitio no lo cachea', () => {
    expect(vite).toMatch(/fileName: 'version\.json'/); expect(vite).toMatch(/process\.env\.COMMIT_REF/)
    expect(netlify).toMatch(/for = "\/version\.json"\s*\n\s*\[headers\.values\]\s*\n\s*Cache-Control = "no-store"/)
  })
})
