// R4-C10 · Manual de ventas y promociones en la IA del canal: solo lo APROBADO y público, acotado; promociones vigentes con
// nombre, vigencia y productos (sin precios), y esos productos cuentan como autorizados para el validador. Sin red.
import { describe, it, expect } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import { leerNegocio, dependenciasCanal } from '../../../../../supabase/functions/_shared/ia/responder'

const ctx = { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }
const sistema = (n: politica.DatosNegocio) => dependenciasCanal(n).politica.construirSistema({ ctx, intencion: 'UNKNOWN', limiteClinico: false, reglasConocimiento: [], evidencia: [], canal: 'whatsapp' })
const MANUAL = [
  { tema: 'como_comprar', titulo: 'Compra por WhatsApp', contenido: 'Un asesor toma tu pedido por este chat y te envía la liga de pago.' },
  { tema: 'pagos', titulo: 'Transferencia', contenido: 'Aceptamos transferencia bancaria; los datos te los comparte tu asesor.' },
]
const PROMO = [{ nombre: 'Promo Allergan', hasta: '2026-11-15', productos: ['Juvederm Voluma', 'Botox 100 U'] }]

describe('manual de ventas en el prompt del canal', () => {
  it('se incluye por tema y título, con la regla de uso', () => {
    const s = sistema({ manual: MANUAL })
    expect(s).toContain('<<<DATOS manual_de_ventas'); expect(s).toContain('Cómo comprar · Compra por WhatsApp\nUn asesor toma tu pedido')
    expect(s).toContain('Formas de pago · Transferencia'); expect(s).toContain('R4-C10 · MANUAL Y PROMOCIONES')
  })
  it('acotado: lo que no cabe se remite a buscar_conocimiento', () => {
    const largo = Array.from({ length: 6 }, (_, i) => ({ tema: 'empresa', titulo: 'T' + i, contenido: 'x'.repeat(3000) }))
    const t = politica.textoManual({ manual: largo })
    expect(t.length).toBeLessThan(politica.MAX_MANUAL + 200); expect(t).toContain('consúltalos con buscar_conocimiento')
  })
  it('sin manual aprobado no hay bloque', () => expect(sistema({})).not.toContain('<<<DATOS manual_de_ventas'))
})

describe('promociones vigentes', () => {
  it('nombre, vigencia y productos; sin precios', () => {
    expect(politica.textoPromociones({ promociones: PROMO })).toBe('Promo Allergan (vigente hasta el 15 de noviembre): Juvederm Voluma, Botox 100 U.')
    expect(sistema({ promociones: PROMO })).toContain('<<<DATOS promociones_vigentes')
  })
  it('los productos de la promoción cuentan como autorizados (no se bloquean por "producto no consultado")', () => {
    const d = dependenciasCanal({ promociones: PROMO })
    const c = { evidencia: [], nombresAutorizados: [], nombresCatalogo: ['Botox 100 U', 'Nabota 100 UI'], limiteClinico: false }
    expect(d.validacion.validarRespuesta('Tenemos Promo Allergan en Botox 100 U hasta el 15 de noviembre.', c).ok).toBe(true)
    expect(d.validacion.validarRespuesta('También el Nabota 100 UI.', c)).toMatchObject({ ok: false, motivo: 'producto_no_autorizado' })
  })
})

describe('leerNegocio: lee solo lo aprobado y público, y promociones vigentes de hoy (Culiacán) sin precio', () => {
  it('filtros correctos', async () => {
    const filtros: Record<string, Array<[string, unknown[]]>> = {}
    const cadena = (t: string, data: unknown) => {
      const c: Record<string, unknown> = {}; filtros[t] = []
      for (const k of ['select', 'eq', 'order', 'lte', 'gte']) c[k] = (...a: unknown[]) => { filtros[t].push([k, a]); return c }
      c.maybeSingle = async () => ({ data, error: null }); c.then = (r: (x: unknown) => unknown) => Promise.resolve({ data, error: null }).then(r); return c
    }
    const admin = { from: (t: string) => cadena(t, t === 'cc_company_knowledge' ? MANUAL : t === 'promociones' ? [{ nombre: 'Promo Allergan', hasta: '2026-11-15', promocion_lineas: [{ products: { name: 'Botox 100 U' } }, { products: { name: 'Botox 100 U' } }, { products: null }] }] : null) }
    const n = await leerNegocio(admin)
    expect(filtros.cc_company_knowledge).toEqual(expect.arrayContaining([['eq', ['estado', 'approved']], ['eq', ['audiencia', 'public']]]))
    const sel = filtros.promociones.find(([k]) => k === 'select')![1][0] as string
    expect(sel).toBe('nombre, hasta, promocion_lineas(products(name))'); expect(sel).not.toMatch(/precio/)
    expect(filtros.promociones).toEqual(expect.arrayContaining([['eq', ['activa', true]]]))
    const hoy = (filtros.promociones.find(([k]) => k === 'lte')![1] as string[])[1]
    expect(hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(n.manual).toEqual(MANUAL); expect(n.promociones).toEqual([{ nombre: 'Promo Allergan', hasta: '2026-11-15', productos: ['Botox 100 U'] }])
  })
})
