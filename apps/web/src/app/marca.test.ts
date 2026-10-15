// MARCA · decisión del dueño (15 oct 2026): "Sistema operativo" solo lo ve el equipo dentro del ERP. Lo que puede ver
// un doctor (inicio de sesión, restablecer contraseña, pestaña, app instalada) lleva la marca del negocio.
import { describe, it, expect } from 'vitest'
import { tituloPestana } from './AppShell'
import login from '../screens/Login.tsx?raw'
import reset from '../screens/ResetPassword.tsx?raw'
import index from '../../index.html?raw'
import manifest from '../../public/manifest.webmanifest?raw'

describe('"Sistema operativo" solo dentro del ERP', () => {
  it('la pestaña dice "Sistema operativo" solo al equipo', () => {
    expect(tituloPestana('admin')).toBe('Renovacell · Sistema operativo')
    expect(tituloPestana('pos')).toBe('Renovacell · Sistema operativo')
    expect(tituloPestana('doctor')).toBe('Renovacell · Tecnologías Antiedad')
    expect(tituloPestana(null)).toBe('Renovacell · Tecnologías Antiedad')
  })
  it('las pantallas y archivos que ve cualquiera no lo mencionan', () => {
    for (const f of [login, reset, index, manifest]) expect(f).not.toMatch(/sistema operativo/i)
  })
})
