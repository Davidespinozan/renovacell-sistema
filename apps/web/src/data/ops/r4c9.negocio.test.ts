// R4-C9 · Datos del negocio en el canal: salen del ERP (company_settings, cc_horario_semanal, entrega_config) en cada turno.
// La IA puede decir dirección, horario, teléfono, recoger y envíos CON montos de envío; cualquier otra cifra sigue exigiendo
// evidencia de precio. Sin red ni base real.
import { describe, it, expect } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { leerNegocio, dependenciasCanal } from '../../../../../supabase/functions/_shared/ia/responder'

// Datos con la forma real del ERP (27 oct 2026)
const ERP: politica.DatosNegocio = {
  empresa: { razon_social: 'Renovacell', direccion: 'Boulevard Pedro Infante 2911 Desarrollo Urbano Tres Rios', cp: '80020', ciudad: 'Culiacan', estado: 'Sinaloa', telefono: '667 531 0910' },
  horario: [1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abierto: true, abre: '10:00:00', cierra: '18:00:00' })).concat([{ dia: 7, abierto: false, abre: null as never, cierra: null as never }]),
  entrega: { recoge_lugar: 'Sucursal Renovacell, Culiacán', recoge_horario: 'Lunes a sábado de 10:00 a 18:00', cp_local_desde: '80000', cp_local_hasta: '80299', dias_chofer: [1, 2, 3, 4, 5, 6], local_mismo_dia: true, corte: '15:30:00',
    local_gratis_desde: 500, local_costo: 0, dias_paqueteria: [1, 2, 3, 4, 5], dhl_transito_min: 1, dhl_transito_max: 3, foraneo_costo: 600, foraneo_gratis_desde: 5000 },
}
const ctxVal = { evidencia: [] as string[], nombresAutorizados: [] as string[], nombresCatalogo: [] as string[], limiteClinico: false }

describe('texto del negocio desde el ERP', () => {
  const t = politica.textoNegocio(ERP)
  it('dirección, ciudad y C.P. del ERP', () => expect(t).toContain('Dirección: Boulevard Pedro Infante 2911 Desarrollo Urbano Tres Rios, C.P. 80020, Culiacan, Sinaloa.'))
  it('horario agrupado y domingo cerrado', () => expect(t).toContain('Horario de atención (hora de Culiacán): lunes a sábado de 10:00 a 18:00; domingo cerrado.'))
  it('teléfono para llamadas y mensajes por este chat', () => expect(t).toContain('Teléfono para llamadas: 667 531 0910. Por mensaje se atiende en este mismo chat.'))
  it('recoger, entrega local (mismo día, corte, gratis desde) y foránea (días, tránsito, costo y gratis desde)', () => {
    expect(t).toContain('Recoger pedidos: Sucursal Renovacell, Culiacán, lunes a sábado de 10:00 a 18:00.')
    expect(t).toContain('Entregas en Culiacán (C.P. 80000 a 80299): con chofer de lunes a sábado; el mismo día si el pedido se confirma antes de las 15:30; envío gratis en compras desde $500 (en compras menores se recoge en sucursal).')
    expect(t).toContain('Envíos al resto del país: por paquetería de lunes a viernes; 1 a 3 días hábiles de tránsito; costo de envío $600, gratis en compras desde $5,000.')
  })
  it('lo que falta en el ERP no se inventa', () => {
    expect(politica.textoNegocio({})).toBe('')
    const sin = politica.textoNegocio({ empresa: { ciudad: 'Culiacan', estado: 'Sinaloa' } })
    expect(sin).toContain('Culiacan, Sinaloa'); expect(sin).not.toMatch(/Dirección|Teléfono|Horario|Envíos/)
  })
  it('montos de envío publicables', () => expect(politica.montosEnvio(ERP).sort((a, b) => a - b)).toEqual([500, 600, 5000]))
})

describe('validación: montos de envío sí, precios no', () => {
  const m = politica.montosEnvio(ERP)
  const ok = (t: string) => validacion.validarRespuesta(validacion.sinMontosDeEnvio(t, m), ctxVal).ok
  it('frases de envío con los montos del ERP pasan', () => {
    for (const t of ['El envío a otras ciudades cuesta $600 y es gratis en compras desde $5,000.', 'En Culiacán la entrega es gratis desde $500.', 'El envío es gratis desde 5 mil pesos.', 'Envío foráneo: 600 pesos.'])
      expect(ok(t), t).toBe(true)
  })
  it('un precio de producto sigue bloqueado, aunque coincida con un monto de envío', () => {
    for (const t of ['Nabota cuesta $600.', 'La pieza sale en $5,000.', 'El envío cuesta $4,000.', 'Envío gratis y el Nabota en $500.'])
      expect(ok(t), t).toBe(false)
  })
})

describe('dependencias del canal por turno', () => {
  it('el sistema lleva el bloque DATOS "negocio" y el validador devuelve el texto original', () => {
    const d = dependenciasCanal(ERP)
    const ctx = { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }
    const sys = d.politica.construirSistema({ ctx, intencion: 'UNKNOWN', limiteClinico: false, reglasConocimiento: [], evidencia: [], canal: 'whatsapp' })
    expect(sys).toContain('<<<DATOS negocio'); expect(sys).toContain('Boulevard Pedro Infante 2911')
    expect(sys).toContain('R4-C9 · NEGOCIO'); expect(sys).toContain('No cierres cada mensaje con una pregunta genérica')
    const v = d.validacion.validarRespuesta('Estamos en Culiacán. El envío foráneo cuesta $600.', ctxVal)
    expect(v).toEqual({ ok: true, texto: 'Estamos en Culiacán. El envío foráneo cuesta $600.' })
  })
  it('sin datos del ERP no se añade bloque', () => {
    const ctx = { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }
    expect(dependenciasCanal({}).politica.construirSistema({ ctx, intencion: 'UNKNOWN', limiteClinico: false, reglasConocimiento: [], evidencia: [], canal: 'whatsapp' })).not.toContain('DATOS negocio')
  })
  it('leerNegocio lee las tres fuentes del ERP y tolera fallos', async () => {
    const tablas: string[] = []
    const cadena = (tabla: string, data: unknown) => { tablas.push(tabla); const c: Record<string, unknown> = {}; for (const k of ['select', 'eq', 'order', 'lte', 'gte']) c[k] = () => c; c.maybeSingle = async () => ({ data, error: null }); c.then = (r: (x: unknown) => unknown, j: (e: unknown) => unknown) => Promise.resolve({ data, error: null }).then(r, j); return c }
    const admin = { from: (t: string) => cadena(t, t === 'company_settings' ? ERP.empresa : t === 'cc_horario_semanal' ? ERP.horario : t === 'entrega_config' ? ERP.entrega : []) }
    const n = await leerNegocio(admin)
    expect(tablas.sort()).toEqual(['cc_company_knowledge', 'cc_horario_semanal', 'company_settings', 'entrega_config', 'promociones'])   // R4-C10: + manual y promociones
    expect(politica.textoNegocio(n)).toBe(politica.textoNegocio(ERP))
    const roto = { from: () => { const c: Record<string, unknown> = {}; for (const k of ['select', 'eq', 'order', 'lte', 'gte']) c[k] = () => c; c.maybeSingle = async () => ({ data: null, error: { message: 'x' } }); c.then = (r: (x: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'x' } }).then(r); return c } }
    expect(politica.textoNegocio(await leerNegocio(roto))).toBe('')
  })
})
