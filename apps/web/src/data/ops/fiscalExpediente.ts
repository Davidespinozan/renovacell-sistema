// DATOS FISCALES QUE YA ESTÁN EN EL EXPEDIENTE (27 nov 2026, dueño: «al solicitar factura en los puntos de venta no se
// llena, a pesar de que muchos clientes ya tienen información fiscal en su expediente»).
//
// Por qué salía en blanco: desde la auditoría de seguridad de octubre, Ventas no ve los datos fiscales completos de un
// cliente (en el expediente solo ve el RFC enmascarado). Por eso el formulario del punto de venta arrancaba vacío y la
// vendedora los volvía a teclear en cada venta. Pero el servidor YA sabe usarlos: si la factura se pide sin receptor
// capturado, `solicitar_cfdi` toma el perfil fiscal predeterminado del cliente (`_w3_receptor`).
//
// Aquí se conectan las dos piezas, sin cambiar permisos:
//   · `fiscalDelExpediente` pregunta con la MISMA función del expediente (`cliente_perfiles_fiscales`): a Ventas le
//     llega el RFC enmascarado; a Dirección y Facturación, los datos completos para precargar.
//   · `pedirFacturaConExpediente` pide la factura SIN mandar receptor: el servidor pone el del expediente.
import { ClienteC360, type PerfilFiscal } from './customer360'
import { normalizeFiscalProfile, isFiscalProfileComplete, type FiscalProfile } from './fiscal'
import { solicitarCFDI } from './fiscalIntent'

export interface FiscalEnExpediente {
  perfilId: string
  alias: string
  /** Como lo entrega el servidor a quien pregunta: enmascarado para Ventas, completo para Dirección y Facturación. */
  rfc: string
  /** Los seis datos, solo si el servidor los entregó (Dirección / Facturación) y están completos. */
  completo: FiscalProfile | null
}

type Lector = Pick<ClienteC360, 'perfilesFiscales'>
/** El perfil fiscal PREDETERMINADO del cliente, o null si no tiene, no se pudo leer o no es cliente de quien pregunta. */
export async function fiscalDelExpediente(customerId: string | null | undefined, lector: Lector = new ClienteC360()): Promise<FiscalEnExpediente | null> {
  if (!customerId) return null
  // Cualquier falla (sin permiso, sin red, respuesta rara) es «no hay»: el punto de venta sigue con el formulario en blanco.
  try {
    const r = await lector.perfilesFiscales(customerId)
    if (!r.ok) return null
    const lista = Array.isArray(r.data?.perfiles) ? r.data.perfiles : []
    const p: PerfilFiscal | undefined = lista.find((x) => x && x.es_predeterminado === true)   // el servidor solo usa el predeterminado
    if (!p || typeof p.rfc !== 'string' || !p.rfc || typeof p.id !== 'string') return null
    const f = normalizeFiscalProfile({ rfc: p.rfc, razon_social: p.razon_social ?? '', regimen: p.regimen ?? '', cp: p.cp ?? '', uso_cfdi: p.uso_cfdi ?? '', email_facturacion: p.email_facturacion ?? '' })
    return { perfilId: p.id, alias: typeof p.alias === 'string' ? p.alias : '', rfc: p.rfc, completo: p.razon_social && isFiscalProfileComplete(f) ? f : null }
  } catch { return null }
}

type Solicitar = typeof solicitarCFDI
/** Pide la factura de un pedido ya creado con los datos fiscales del expediente (no viaja receptor: lo pone el servidor). */
export async function pedirFacturaConExpediente(orderId: string, solicitar: Solicitar = solicitarCFDI): Promise<{ ok: true } | { ok: false; error: string }> {
  // Nunca truena: el pedido o la venta YA quedaron, y la pantalla tiene que poder decirlo aunque esto falle.
  try {
    const r = await solicitar(orderId, null)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  } catch { return { ok: false, error: 'No se pudo pedir la factura en este momento.' } }
}
