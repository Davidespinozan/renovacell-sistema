// IA-VENDEDORA · la IA del portal también vende: cotiza combinaciones con las reglas del pedido, recomienda con motivo y
// recibe las reglas de vendedor solo con el doctor verificado en el portal (nunca en canales ni con visitantes).
import { describe, it, expect } from 'vitest'
import { construirSistema, POLITICA_VENDEDOR, REGLA_ENVIO_GRATIS_PORTAL } from '../../../../../supabase/functions/_shared/ia/politica'
import { validarLlamada, evidenciaDe, herramientasPara } from '../../../../../supabase/functions/_shared/ia/herramientas'
import orquestadorSrc from '../../../../../supabase/functions/_shared/ia/orquestador.ts?raw'

const A = '11111111-1111-4111-8111-111111111111'; const B = '22222222-2222-4222-8222-222222222222'
const doctor = { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }
const visitante = { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }
const base = { intencion: 'PRICE', limiteClinico: false, reglasConocimiento: [], evidencia: [] }

describe('herramientas de venta', () => {
  it('cotizar: solo productos consultados en el turno, cantidades válidas; su resultado autorizado es precio', () => {
    const ctx = { conCuenta: true, idsAutorizados: new Set([A, B]) }
    expect(validarLlamada('cotizar', { lineas: [{ product_id: A, cantidad: 5 }, { product_id: B, cantidad: 5 }] }, ctx)).toMatchObject({ ok: true, ids: [A, B] })
    expect(validarLlamada('cotizar', { lineas: [{ product_id: A, cantidad: 5 }] }, { conCuenta: true, idsAutorizados: new Set() })).toEqual({ ok: false, motivo: 'id_no_autorizado' })
    expect(validarLlamada('cotizar', { lineas: [{ product_id: A, cantidad: 0 }] }, ctx)).toEqual({ ok: false, motivo: 'argumentos' })
    expect(evidenciaDe('cotizar', { autorizado: true })).toEqual(['PRICE_EVIDENCE'])
    expect(evidenciaDe('cotizar', { autorizado: false })).toEqual([])
  })
  it('recomendar_productos: con o sin producto; el producto debe venir del turno', () => {
    expect(validarLlamada('recomendar_productos', {}, { conCuenta: true, idsAutorizados: new Set() })).toMatchObject({ ok: true, args: { product_id: null } })
    expect(validarLlamada('recomendar_productos', { product_id: A }, { conCuenta: true, idsAutorizados: new Set() })).toEqual({ ok: false, motivo: 'id_no_autorizado' })
    expect(herramientasPara(true, 'whatsapp').map((h) => h.name)).toContain('recomendar_productos')   // en canal el servidor no da precio (perfil nulo)
  })
})

describe('reglas de vendedor', () => {
  it('solo con el doctor verificado en el portal', () => {
    expect(construirSistema({ ...base, ctx: doctor })).toContain(POLITICA_VENDEDOR)
    expect(construirSistema({ ...base, ctx: visitante })).not.toContain('TAMBIÉN ERES SU VENDEDOR')
    // E (2 nov 2026) · en canal la base solo entrega contexto de doctor con WhatsApp vinculado: ahí también vende; Instagram/Messenger nunca
    expect(construirSistema({ ...base, ctx: doctor, canal: 'whatsapp' })).toContain('TAMBIÉN ERES SU VENDEDOR')
    expect(construirSistema({ ...base, ctx: doctor, canal: 'instagram' })).not.toContain('TAMBIÉN ERES SU VENDEDOR')
  })
  it('vende con montos del servidor, una sugerencia a la vez y sin insistir', () => {
    expect(POLITICA_VENDEDOR).toMatch(/usa cotizar: nunca calcules montos tú/)
    expect(POLITICA_VENDEDOR).toMatch(/como mucho UNA por mensaje/)
    expect(POLITICA_VENDEDOR).toMatch(/no insistas en esta conversación/)
    expect(REGLA_ENVIO_GRATIS_PORTAL).not.toMatch(/No ofrezcas agregar productos/)
  })
  it('el perfil comercial entra al turno solo en el portal y con precio autorizado', () => {
    expect(orquestadorSrc).toMatch(/if \(\(canal === 'portal' \|\| identificado\) && ctx\.puede_precio && perfilIA\) \{\n    const pc = await rpc\('cc_ia_perfil_comercial'/)
  })
})
