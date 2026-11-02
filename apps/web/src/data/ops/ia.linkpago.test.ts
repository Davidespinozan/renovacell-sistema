// LINK DE PAGO (2 nov 2026) · en WhatsApp, con el doctor vinculado, la IA pide el link a su vendedor; nunca escribe uno.
import { describe, it, expect } from 'vitest'
import { herramientasPara, validarLlamada } from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'

describe('pedir_link_pago', () => {
  it('solo en WhatsApp con vínculo', () => {
    expect(herramientasPara(true, 'whatsapp', false, true).map((h) => h.name)).toContain('pedir_link_pago')
    expect(herramientasPara(true, 'whatsapp').map((h) => h.name)).not.toContain('pedir_link_pago')
    expect(herramientasPara(true, 'portal').map((h) => h.name)).not.toContain('pedir_link_pago')
    expect(validarLlamada('pedir_link_pago', { folio: 's123456' }, { conCuenta: true, idsAutorizados: new Set(), canal: 'whatsapp', identificado: true })).toEqual({ ok: true, nombre: 'pedir_link_pago', args: { folio: 'S123456' }, ids: [] })
    expect(validarLlamada('pedir_link_pago', { folio: '<script>' }, { conCuenta: true, idsAutorizados: new Set(), canal: 'whatsapp', identificado: true })).toEqual({ ok: false, motivo: 'argumentos' })
    expect(validarLlamada('pedir_link_pago', {}, { conCuenta: true, idsAutorizados: new Set(), canal: 'whatsapp' })).toEqual({ ok: false, motivo: 'no_autorizada' })
  })
  it('el prompt: pídelo, no lo escribas', () => {
    const doctor = { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }
    const s = politica.construirSistema({ ctx: doctor, intencion: 'CHECKOUT', limiteClinico: false, reglasConocimiento: [], evidencia: [], canal: 'whatsapp' })
    expect(s).toMatch(/PAGO CON TARJETA/); expect(s).toMatch(/Nunca escribas tú un link de pago/); expect(s).toMatch(/o, si prefiere tarjeta, pedir_link_pago/)
  })
})
