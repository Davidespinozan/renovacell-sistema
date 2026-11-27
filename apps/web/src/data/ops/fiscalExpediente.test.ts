// DATOS FISCALES DEL EXPEDIENTE (27 nov 2026) · lectura (enmascarada para Ventas) y solicitud sin receptor.
import { describe, it, expect, vi } from 'vitest'
import { fiscalDelExpediente, pedirFacturaConExpediente } from './fiscalExpediente'

const lector = (data: unknown, ok = true) => ({ perfilesFiscales: vi.fn(async () => (ok ? { ok: true as const, data: data as never } : { ok: false as const, error: 'No tienes permiso para esta acción sobre este cliente.' })) })
const ID = '11111111-1111-4111-8111-111111111111'

describe('fiscalDelExpediente', () => {
  it('a Ventas le llega solo el RFC enmascarado: sabe que existe, no los datos', async () => {
    const l = lector({ customer_id: ID, puede_editar: false, perfiles: [{ id: 'PF-1', alias: 'Consultorio', rfc: 'GAP*******5K2', es_predeterminado: true }] })
    expect(await fiscalDelExpediente(ID, l)).toEqual({ perfilId: 'PF-1', alias: 'Consultorio', rfc: 'GAP*******5K2', completo: null })
    expect(l.perfilesFiscales).toHaveBeenCalledWith(ID)
  })
  it('a Dirección y Facturación les llegan los seis datos, listos para precargar', async () => {
    const completo = { rfc: 'GAPE8001015K2', razon_social: 'PATRICIA ELENA GASTELUM', regimen: '612', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'p@correo.mx' }
    const r = await fiscalDelExpediente(ID, lector({ customer_id: ID, puede_editar: true, perfiles: [{ id: 'PF-1', alias: '', ...completo, es_predeterminado: true }] }))
    expect(r?.completo).toEqual(completo)
  })
  it('solo cuenta el perfil PREDETERMINADO (es el único que usa el servidor)', async () => {
    expect(await fiscalDelExpediente(ID, lector({ perfiles: [{ id: 'PF-2', alias: 'Otro', rfc: 'XAX*******000', es_predeterminado: false }] }))).toBeNull()
  })
  it('sin cliente, sin permiso, sin perfiles o con una respuesta rara: null, y nunca truena', async () => {
    expect(await fiscalDelExpediente(null, lector({}))).toBeNull()
    expect(await fiscalDelExpediente(ID, lector(null, false))).toBeNull()
    expect(await fiscalDelExpediente(ID, lector({ perfiles: [] }))).toBeNull()
    expect(await fiscalDelExpediente(ID, lector(null))).toBeNull()
    expect(await fiscalDelExpediente(ID, lector({ perfiles: 'x' }))).toBeNull()
    expect(await fiscalDelExpediente(ID, { perfilesFiscales: async () => { throw new Error('red') } })).toBeNull()
  })
})

describe('pedirFacturaConExpediente', () => {
  it('pide la factura SIN mandar receptor: lo pone el servidor desde el expediente', async () => {
    const solicitar = vi.fn(async () => ({ ok: true as const, data: { status: 'applied' } }))
    expect(await pedirFacturaConExpediente('O-1', solicitar)).toEqual({ ok: true })
    expect(solicitar).toHaveBeenCalledWith('O-1', null)
  })
  it('si pedirla truena, no revienta: la venta ya quedó y la pantalla tiene que poder decirlo', async () => {
    expect(await pedirFacturaConExpediente('O-1', async () => { throw new Error('red') })).toEqual({ ok: false, error: 'No se pudo pedir la factura en este momento.' })
  })
  it('si el servidor no pudo, devuelve su motivo en palabras', async () => {
    const solicitar = vi.fn(async () => ({ ok: false as const, error: 'Faltan datos fiscales completos del cliente.' }))
    expect(await pedirFacturaConExpediente('O-1', solicitar)).toEqual({ ok: false, error: 'Faltan datos fiscales completos del cliente.' })
  })
})
