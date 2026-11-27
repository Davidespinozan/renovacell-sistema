// AUTOFACTURA (27 nov 2026, dueño: «un QR en su recibo para que el cliente se genere su factura, con la regla de antes de
// que acabe el mes y después público en general»).
//
// El recibo y la remisión llevan un QR con un enlace propio de ESA compra. Quien tiene el papel tiene la llave: abre una
// página sin sesión, captura sus datos fiscales y la factura queda pedida. Aquí vive lo que se puede probar sin red:
// la llave del enlace, la fecha límite y el estado que ve el cliente. Sin dependencias de Deno.
//
// Reglas (las mismas del resto del sistema; aquí solo se LEEN para explicarlas, la base es quien las impone):
//   · La factura se pide a más tardar el ÚLTIMO DÍA del mes de la venta (día de Culiacán).
//   · Después, la venta va en la factura global del mes a público en general y ya no se factura a su nombre.
//   · Una solicitud hecha a tiempo se puede corregir mientras no se haya timbrado.

export const URL_SISTEMA = 'https://sistema.renovacell.mx'
export const ZONA_NEGOCIO = 'America/Mazatlan'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LLAVE = /^[A-Za-z0-9_-]{22}$/

const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Llave del enlace de una compra: HMAC-SHA256(secreto, 'autofactura:v1:<pedido>'), 22 caracteres (~128 bits).
 *  No se guarda en ningún lado: se recalcula. Sin el secreto del servidor no se puede fabricar. */
export async function llaveDePedido(pedidoId: string, secreto: string): Promise<string> {
  if (!UUID.test(pedidoId) || secreto.length < 16) throw new Error('llave: datos inválidos')
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`autofactura:v1:${pedidoId.toLowerCase()}`)))
  return b64url(firma).slice(0, 22)
}

/** ¿La llave corresponde a ese pedido? Comparación de tiempo constante. */
export async function llaveValida(pedidoId: string, llave: string, secreto: string): Promise<boolean> {
  if (!UUID.test(pedidoId) || !LLAVE.test(llave)) return false
  const buena = await llaveDePedido(pedidoId, secreto)
  let d = 0
  for (let i = 0; i < buena.length; i++) d |= buena.charCodeAt(i) ^ llave.charCodeAt(i)
  return d === 0
}

/** El enlace lleva el pedido y la llave en el FRAGMENTO (#): el navegador no lo manda a ningún servidor ni queda en bitácoras. */
export function enlaceFactura(pedidoId: string, llave: string, base: string = URL_SISTEMA): string {
  return `${base.replace(/\/+$/, '')}/factura#${pedidoId.toLowerCase()}.${llave}`
}
export function leerEnlace(fragmento: string | null | undefined): { pedido: string; llave: string } | null {
  const m = /^#?([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/i.exec((fragmento ?? '').trim())
  return m && UUID.test(m[1]) ? { pedido: m[1].toLowerCase(), llave: m[2] } : null
}

/** Día del negocio (Culiacán) de un instante, como YYYY-MM-DD. */
export function diaNegocio(instante: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_NEGOCIO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instante))
}
/** Último día para pedir la factura: el último del mes de la venta (día de Culiacán). */
export function fechaLimite(ventaISO: string | Date): string {
  const [a, m] = diaNegocio(ventaISO).split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()   // día 0 del mes siguiente = último de este
  return `${a}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «30 de noviembre de 2026» */
export function fechaLarga(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  return `${d} de ${MESES[m - 1]} de ${a}`
}

export type EstadoAutofactura = 'disponible' | 'solicitada' | 'en_proceso' | 'facturada' | 'fuera_de_mes' | 'en_global' | 'cancelada'

/** Qué ve el cliente al abrir su enlace. El orden importa: lo ya hecho manda sobre la fecha. */
export function estadoAutofactura(x: {
  status_pedido: string | null; venta: string; hoy: string
  fiscal_status: string | null; timbrada: boolean; en_global: boolean
}): EstadoAutofactura {
  if (x.status_pedido === 'cancelled') return 'cancelada'
  if (x.timbrada || x.fiscal_status === 'timbrado') return 'facturada'
  if (x.fiscal_status === 'en_proceso' || x.fiscal_status === 'incierto') return 'en_proceso'
  if (x.fiscal_status === 'pendiente') return 'solicitada'       // pedida a tiempo: se puede corregir aunque ya cambió el mes
  if (x.en_global) return 'en_global'
  if (x.hoy > fechaLimite(x.venta)) return 'fuera_de_mes'
  return 'disponible'
}

export const MENSAJE_ESTADO: Record<EstadoAutofactura, string> = {
  disponible: 'Captura tus datos fiscales para pedir tu factura.',
  solicitada: 'Ya recibimos tus datos. Te enviaremos la factura a tu correo.',
  en_proceso: 'Tu factura se está emitiendo. Te la enviaremos a tu correo.',
  facturada: 'Tu factura ya fue emitida y se envió a tu correo. También puedes descargarla aquí.',
  fuera_de_mes: 'El plazo para facturar esta compra terminó. Ya forma parte de la factura global del mes a público en general y no puede facturarse a tu nombre.',
  en_global: 'Esta compra ya forma parte de la factura global del mes a público en general y no puede facturarse a tu nombre.',
  cancelada: 'Esta compra fue cancelada: no se factura.',
}

export interface Receptor { rfc: string; razon_social: string; regimen: string; cp: string; uso_cfdi: string; email_facturacion: string }
const txt = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').trim().slice(0, max)
/** Deja solo los seis datos fiscales, recortados. La base vuelve a validar y a limpiar (es la autoridad). */
export function limpiarReceptor(r: unknown): Receptor {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
  return {
    rfc: txt(o.rfc, 13).toUpperCase().replace(/\s+/g, ''), razon_social: txt(o.razon_social, 300), regimen: txt(o.regimen, 3),
    cp: txt(o.cp, 5), uso_cfdi: txt(o.uso_cfdi, 4).toUpperCase(), email_facturacion: txt(o.email_facturacion, 200).toLowerCase(),
  }
}
/** Primer dato que falta o está mal, en palabras del cliente; null si están completos. Mismas reglas que `_fiscal_error`. */
export function faltaEnReceptor(r: Receptor): string | null {
  if (!r.rfc) return 'Escribe tu RFC.'
  if (r.rfc.length !== 12 && r.rfc.length !== 13) return 'El RFC debe tener 12 letras y números (empresa) o 13 (persona).'
  if (!/^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/.test(r.rfc)) return 'Ese RFC no tiene el formato correcto.'
  if (!r.razon_social) return 'Escribe tu nombre o razón social, tal como aparece en tu constancia fiscal.'
  if (!r.regimen) return 'Elige tu régimen fiscal.'
  if (!/^[0-9]{5}$/.test(r.cp)) return 'El código postal fiscal debe tener 5 números.'
  if (!r.uso_cfdi) return 'Elige el uso de la factura.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email_facturacion)) return 'Escribe un correo válido: ahí te llega la factura.'
  return null
}

/** Los errores de la base, en palabras del cliente. Nunca se le muestra el texto interno. */
export function mensajeDeError(m: string | null | undefined): { estado: EstadoAutofactura | 'error'; mensaje: string } {
  const t = m ?? ''
  if (/FACTURA_FUERA_DE_MES/.test(t)) return { estado: 'fuera_de_mes', mensaje: MENSAJE_ESTADO.fuera_de_mes }
  if (/FACTURA_EN_GLOBAL/.test(t)) return { estado: 'en_global', mensaje: MENSAJE_ESTADO.en_global }
  if (/PEDIDO_CANCELADO/.test(t)) return { estado: 'cancelada', mensaje: MENSAJE_ESTADO.cancelada }
  if (/CFDI_EN_PROCESO|CFDI_INCIERTO/.test(t)) return { estado: 'en_proceso', mensaje: MENSAJE_ESTADO.en_proceso }
  if (/DATOS_FISCALES_REQUERIDOS|FISCAL_INVALIDO/.test(t)) return { estado: 'error', mensaje: 'Revisa tus datos fiscales: alguno falta o no tiene el formato correcto.' }
  if (/ESPERA|SOBRE_PEDIDO/.test(t)) return { estado: 'error', mensaje: 'Tu compra todavía no se surte por completo. Podrás pedir la factura cuando recibas tu producto.' }
  return { estado: 'error', mensaje: 'No se pudo registrar tu solicitud. Intenta de nuevo en unos minutos o pídela a tu asesor.' }
}

/** ¿Es el mismo RFC? Sin espacios ni diferencias de mayúsculas. Vacío nunca coincide.
 *  Se pide para DESCARGAR la factura: quien trae el recibo además debe saber a qué RFC se facturó. */
export function rfcIgual(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (x: string | null | undefined) => (x ?? '').toUpperCase().replace(/[^A-Z0-9Ñ&]/g, '')
  const x = n(a); const y = n(b)
  if (x.length < 12 || x.length !== y.length) return false
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return d === 0
}

/** j•••@dominio.mx — para confirmar a dónde llegará sin mostrar el correo completo. */
export function correoEnmascarado(correo: string | null | undefined): string | null {
  const m = /^([^@\s])[^@\s]*(@[^@\s]+)$/.exec((correo ?? '').trim())
  return m ? `${m[1]}•••${m[2]}` : null
}
