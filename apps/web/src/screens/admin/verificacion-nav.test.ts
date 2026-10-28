// Cableado de la VERIFICACIÓN de doctores (fix de flujo roto).
// Garantiza que: (1) el cockpit de verificación es alcanzable en av_verif; (2) av_doc
// sigue siendo el directorio comercial (customers) read-only; (3) NINGUNA señal
// "por verificar" aterriza ya en el directorio read-only — todas van a av_verif.
import { describe, it, expect } from 'vitest'
import { getNav, getRole, SUBPANTALLAS, GRUPOS, resolverDestino, pantallasAlcanzables } from '../../app/roles'
import registrySrc from '../registry.tsx?raw'
import rolesSrc from '../../app/roles.ts?raw'
import bandejaSrc from '../Bandeja.tsx?raw'
import notifSrc from '../../data/store/notificationsStore.ts?raw'
import doctorsSrc from '../../data/store/doctorsStore.ts?raw'

describe('Verificación de doctores — cockpit reconectado (av_verif)', () => {
  it('el registry monta el cockpit Doctores en av_verif', () => {
    expect(registrySrc).toMatch(/av_verif: \(\) => <Doctores \/>/)
    expect(registrySrc).toMatch(/import \{ Doctores \} from '\.\/admin\/Doctores'/)
  })
  it('av_doc SIGUE siendo el directorio comercial (customers), no el cockpit', () => {
    expect(registrySrc).toMatch(/av_doc: \(\) => <DoctoresDirectorio \/>/)
  })
  it('la navegación admin abre "Por verificar" como pestaña de Clientes (g_clientes)', () => {
    const nav = getNav(getRole('admin'))
    const entry = nav.find((s) => s.key === 'g_clientes')
    expect(entry).toBeTruthy(); expect(entry?.label).toBe('Clientes'); expect(entry?.section).toBe('Clientes')
    expect(SUBPANTALLAS.g_clientes).toEqual([{ key: 'av_doc', label: 'Clientes' }, { key: 'av_verif', label: 'Por verificar' }, { key: 'av_invitar', label: 'Invitar clientes' }])   // INVITA-1
    // un aviso "por verificar" (screen av_verif) abre el grupo con esa pestaña pedida
    expect(resolverDestino(nav, 'av_verif')).toEqual({ screen: 'g_clientes', pestana: 'av_verif' })
    expect(pantallasAlcanzables(nav).has('av_verif')).toBe(true)
  })
  it('roles.ts declara la pestaña av_verif dentro de g_clientes y el registro la monta', () => {
    expect(rolesSrc).toMatch(/g_clientes: \[\{ key: 'av_doc', label: 'Clientes' \}, \{ key: 'av_verif', label: 'Por verificar' \}, \{ key: 'av_invitar', label: 'Invitar clientes' \}\]/)
    expect(registrySrc).toMatch(/g_clientes: \(\) => <Pestanas grupo="g_clientes"[\s\S]*key: 'av_verif', label: 'Por verificar', render: \(\) => <Doctores \/>/)
  })
  it('menú de Dirección: Clientes solo con Clientes; Ventas en Mi trabajo (no con Clientes); Comisiones dentro de Equipo', () => {
    const nav = getNav(getRole('admin'))
    expect(nav.filter((s) => s.section === 'Clientes').map((s) => s.label)).toEqual(['Clientes'])
    expect(nav.find((s) => s.key === 'av_ventas')?.section).toBe('Mi trabajo')
    expect(GRUPOS.g_equipo).toContain('av_comisiones')
    expect(nav.some((s) => s.key === 'av_import')).toBe(false)   // la migración vive en Configuración
    expect(nav.length).toBeLessThanOrEqual(17)   // 31 → 14 módulos (+ Inicio, Avisos, Chat)
  })
})

describe('Ninguna señal "por verificar" apunta al directorio read-only (av_doc)', () => {
  it('la tarea del tablero "Doctores por verificar" va a av_verif', () => {
    expect(bandejaSrc).toMatch(/Doctores por verificar[\s\S]*?screen: 'av_verif'/)
    expect(bandejaSrc).not.toMatch(/Doctores por verificar[\s\S]*?screen: 'av_doc'/)
  })
  it('la notificación semilla de verificación va a av_verif', () => {
    expect(notifSrc).toMatch(/Doctores esperando verificación[\s\S]*?screen: 'av_verif'/)
  })
  it('los avisos del store (convertir) van a av_verif; ya no hay validación automática', () => {
    expect(doctorsSrc).toMatch(/Doctor por verificar[\s\S]*?screen: 'av_verif'/)
    expect(doctorsSrc).not.toMatch(/Validación automática|Verificación a revisión/)
    // Ya no queda ningún aviso de verificación colgando de av_doc.
    expect(doctorsSrc).not.toMatch(/screen: 'av_doc'/)
  })
})
