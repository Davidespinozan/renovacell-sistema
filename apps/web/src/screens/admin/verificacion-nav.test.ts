// Cableado de la VERIFICACIÓN de doctores (fix de flujo roto).
// Garantiza que: (1) el cockpit de verificación es alcanzable en av_verif; (2) av_doc
// sigue siendo el directorio comercial (customers) read-only; (3) NINGUNA señal
// "por verificar" aterriza ya en el directorio read-only — todas van a av_verif.
import { describe, it, expect } from 'vitest'
import { getNav, getRole } from '../../app/roles'
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
  it('la navegación admin incluye "Por verificar" en Comercial', () => {
    const nav = getNav(getRole('admin'))
    const entry = nav.find((s) => s.key === 'av_verif')
    expect(entry).toBeTruthy()
    expect(entry?.label).toBe('Por verificar')
    expect(entry?.section).toBe('Comercial')
    // y el directorio "Doctores" (av_doc) se conserva como entrada aparte
    expect(nav.some((s) => s.key === 'av_doc' && s.label === 'Doctores')).toBe(true)
  })
  it('roles.ts declara la entrada av_verif', () => {
    expect(rolesSrc).toMatch(/key: 'av_verif'.*label: 'Por verificar'.*section: 'Comercial'/)
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
  it('los avisos del store (convertir / auto-verificar / a revisión) van a av_verif', () => {
    expect(doctorsSrc).toMatch(/Doctor por verificar[\s\S]*?screen: 'av_verif'/)
    expect(doctorsSrc).toMatch(/Doctor auto-verificado[\s\S]*?screen: 'av_verif'/)
    expect(doctorsSrc).toMatch(/Verificación a revisión[\s\S]*?screen: 'av_verif'/)
    // Ya no queda ningún aviso de verificación colgando de av_doc.
    expect(doctorsSrc).not.toMatch(/screen: 'av_doc'/)
  })
})
