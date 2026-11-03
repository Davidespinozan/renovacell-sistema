// CHV2-B · Guardas de repositorio: navegación canónica, autoridad del servidor (sin reloj del navegador
// para el SLA), Realtime como señal, sin Web Push / service worker, sin migración nueva.
import { describe, it, expect } from 'vitest'
// @ts-expect-error tipos de node no incluidos en el tsconfig del front (vitest corre en Node)
import { readdirSync, readFileSync } from 'node:fs'
import { getNav, getRole, getEntryScreen, SUBPANTALLAS, resolverDestino } from '../../app/roles'
import comercialSrc from './atencionComercial.ts?raw'
import homeSrc from '../../screens/home/RoleHome.tsx?raw'
import doctorSrc from '../../screens/home/HomeDoctor.tsx?raw'
import alertaSrc from '../../app/AlertaComercial.tsx?raw'
import storeSrc from '../store/atencionStore.ts?raw'
import bandejaSrc from '../../screens/Bandeja.tsx?raw'
import atencionUiSrc from '../../screens/admin/AtencionComercial.tsx?raw'
import asesoriasSrc from '../../screens/chat/Asesorias.tsx?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/|\*)/.test(l)).join('\n')

describe('navegación por rol', () => {
  it('Inicio es la entrada de todos los roles; Avisos/Chat del equipo; Conversaciones con key asesorias', () => {
    for (const r of ['admin', 'pos', 'warehouse', 'driver', 'doctor'] as const) expect(getEntryScreen(getRole(r))).toBe('inicio')
    const admin = getNav(getRole('admin')).map((s) => [s.key, s.label])
    expect(admin).toContainEqual(['comun', 'Avisos del equipo'])
    expect(admin).toContainEqual(['chat', 'Chat del equipo'])
    expect(admin).toContainEqual(['g_conversaciones', 'Conversaciones'])   // MENÚ AGRUPADO · Bandeja · Asignadas · Correos en una entrada
    expect(SUBPANTALLAS.g_conversaciones.map((x) => x.key)).toEqual(['av_atencion', 'asesorias', 'av_mensajes', 'difusiones', 'av_ia'])   // las keys no cambian (avisos y enlaces); IA mejor que el humano (2 nov 2026) agrega Asesora IA; Difusiones para Dirección (2 nov 2026)
    expect(resolverDestino(getNav(getRole('admin')), 'av_atencion')).toEqual({ screen: 'g_conversaciones', pestana: 'av_atencion' })
    expect(resolverDestino(getNav(getRole('admin')), 'bandeja')).toEqual({ screen: 'inicio' })   // Inicio ES la bandeja
    expect(getNav(getRole('doctor')).map((s) => s.key)).toEqual(['inicio', 'catalogo', 'g_pedidosdr', 'chat_cc', 'mi_verificacion'])   // MENÚ · Mis pedidos = En curso · Historial
    expect(resolverDestino(getNav(getRole('doctor')), 'hist')).toEqual({ screen: 'g_pedidosdr', pestana: 'hist' })
    expect(getNav(getRole('doctor')).some((s) => s.key === 'comun' || s.key === 'chat')).toBe(false)
  })
})

describe('autoridad del servidor', () => {
  it('P · ninguna superficie comercial calcula esperas con el reloj del navegador', () => {
    for (const s of [comercialSrc, homeSrc, alertaSrc, atencionUiSrc, asesoriasSrc]) {
      expect(codigo(s)).not.toMatch(/Date\.now\(\)|new Date\(|performance\.now/)
    }
    // El store solo usa Date.now() como marca de frescura del cache (nunca para el SLA).
    expect((codigo(storeSrc).match(/Date\.now\(\)/g) ?? []).length).toBeLessThanOrEqual(3)
    expect(codigo(storeSrc)).not.toMatch(/reloj_sla|espera_|umbral_/)
  })
  it('la alerta relee la verdad antes de presentar y valida accionabilidad', () => {
    const a = codigo(alertaSrc)
    expect(a).toMatch(/void recargarAtencion\(\)\.then\(/)
    expect(a).toMatch(/if \(!alertaAccionable\(s\.kind, s\.conversationId, fuenteDe\(getEstadoAtencion\(\)\)\)\) return/)
    expect(a).not.toMatch(/new Notification|Notification\.requestPermission|serviceWorker|PushManager|Audio\(/)
  })
  it('Inicio y Mi bandeja comparten constructor; la bandeja ya no lee una sola vez al montar', () => {
    expect(codigo(homeSrc)).toMatch(/useBandeja\(\)/)
    expect(codigo(bandejaSrc)).toMatch(/export function useBandeja\(/)
    expect(codigo(bandejaSrc)).not.toMatch(/atencion\.resumen\(\)/)
  })
  it('reasignar la solicitud y cambiar la cartera son RPC distintos', () => {
    const u = codigo(atencionUiSrc)
    expect(u).toMatch(/cliente\.reasignarSolicitud\(p\.conversation_id, v, motivo\.trim\(\)\)/)
    expect(u).toMatch(/cliente\.asignar\(p\.profile_id, v, motivo\.trim\(\) \|\| null\)/)
  })
  it('Atender ahora = comando canónico iniciar; Conversaciones nunca crea conversación ni handoff', () => {
    const s = codigo(asesoriasSrc)
    expect(s).toMatch(/cliente\.iniciar\(c\.conversation_id\)/)
    expect(s).not.toMatch(/cliente\.(abrir|solicitarAsesor|asignar)\(/)
  })
  it('el Inicio del doctor no crea carrito: solo lee el que ya existe', () => {
    expect(codigo(doctorSrc)).toMatch(/clienteCarrito\.ver\(/)
    expect(codigo(doctorSrc)).not.toMatch(/clienteCarrito\.(abrir|agregar|actualizar|vaciar)\(/)
  })
})

describe('alcance', () => {
  it('sin migración 125 ni cambios de Edge/Web Push en CHV2-B', () => {
    const migs = readdirSync(new URL('../../../../../supabase/migrations', import.meta.url)) as string[]
    // CHV2-B fue solo de pantallas: ninguna migración suya. (Antes esta prueba enumeraba a mano TODAS las migraciones
    // posteriores y se rompía con cada una nueva; ensayo 2 nov 2026.)
    expect(migs.filter((m) => /chv2b/i.test(m))).toEqual([])
    const sw = (() => { try { return readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8') as string } catch { return '' } })()
    // AVISOS PUSH (15 oct 2026, autorizado por el dueño): el service worker existe y SOLO muestra avisos; sin caché ni intercepción.
    expect(sw).toMatch(/addEventListener\('push'/); expect(sw).not.toMatch(/addEventListener\('fetch'|caches\./)
  })
})
