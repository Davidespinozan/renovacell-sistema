// COBRO-U (23 nov 2026) · UNA sola forma de cobrar en TODOS los puntos de venta (dueño: "TODOS LOS PUNTOS DE VENTA
// ABSOLUTAMENTE TODOS DEBEN TENER LA POSIBILIDAD DE ELEGIR TODAS LAS FORMAS POSIBLES"; "VENTAS TAMBIÉN DEBE TENER LA
// FACULTAD DE COBRAR"). Caja, Levantar pedido, Enviar o recoger, eventos, chat y la lista de pedidos por cobrar usan
// estas mismas formas; el servidor (cobrar_venta / crear_pedido_con_entrega_y_cobro / vender_pos) las valida.
import { supabase } from '../../lib/supabase'
import { sumarDias } from '../periodo'

export type FormaPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'link' | 'al_recibir' | 'credito'
export interface CobroElegido {
  forma: FormaPago
  /** Efectivo: con cuánto paga el cliente (para el cambio). */
  recibido?: number | null
  /** Transferencia (obligatoria) o tarjeta (voucher, opcional). */
  referencia?: string | null
  /** Crédito: fecha límite de pago (YYYY-MM-DD). */
  vence?: string | null
  motivo?: string | null
  /** Paga al recibir: cómo va a pagar en la puerta (lo ve el chofer). */
  con?: 'efectivo' | 'tarjeta' | 'transferencia' | null
}
/** Dónde se cobra: en mostrador el producto sale en el momento (solo con pago o crédito); en pedido, todas las formas. */
export type ModoCobro = 'mostrador' | 'pedido'

// AL-RECIBIR (23 nov 2026): «Tarjeta (terminal)» se leía como «pagará con terminal al recibir» y se registraba como YA
// pagado. Ahora las formas van en dos grupos que no se confunden: lo que YA pagó y lo que paga DESPUÉS.
export type GrupoForma = 'ya' | 'despues'
export const FORMAS: Array<{ id: FormaPago; texto: string; ayuda: string; grupo: GrupoForma }> = [
  { id: 'efectivo', texto: 'Efectivo', ayuda: 'Ya te lo dio', grupo: 'ya' },
  { id: 'tarjeta', texto: 'Tarjeta', ayuda: 'Ya la pasaste en la terminal', grupo: 'ya' },
  { id: 'transferencia', texto: 'Transferencia', ayuda: 'Ya llegó: escribe la referencia', grupo: 'ya' },
  { id: 'al_recibir', texto: 'Paga al recibir', ayuda: 'Al chofer o al recoger: efectivo, terminal o transferencia', grupo: 'despues' },
  { id: 'link', texto: 'Link de pago', ayuda: 'Le mandas un link de BanBajío', grupo: 'despues' },
  { id: 'credito', texto: 'Crédito', ayuda: 'Paga después, con fecha límite', grupo: 'despues' },
]
export const CON_AL_RECIBIR: Array<{ id: 'efectivo' | 'tarjeta' | 'transferencia'; texto: string }> = [
  { id: 'efectivo', texto: 'Efectivo' }, { id: 'tarjeta', texto: 'Terminal' }, { id: 'transferencia', texto: 'Transferencia' },
]

export const MAX_DIAS_CREDITO = 180

// REF-PAGO (24 nov 2026) · se escribía la cuenta que recibió el dinero ("9474", "cuenta 9474", "Transferencia a 7447",
// "SCOTIABANK RENATO") en vez de la referencia del comprobante. El libro no acepta la misma referencia dos veces, así que
// el segundo cobro del día a esa cuenta tumbaba el pedido completo. La clave de rastreo / referencia del comprobante
// siempre trae al menos 6 números; la terminación de una cuenta, no.
export const MIN_DIGITOS_REFERENCIA = 6
export const REFERENCIA_NO_COMPROBANTE = 'Escribe la clave de rastreo o la referencia que viene en el comprobante de la transferencia (al menos 6 números). No pongas la cuenta que recibió (por ejemplo 9474), el banco ni el nombre del cliente.'
export function referenciaPareceComprobante(ref: string | null | undefined): boolean {
  const r = (ref ?? '').trim()
  if (/^(cuenta|cta\.?|transferencia|transf\.?)\b/i.test(r)) return false
  return (r.match(/\d/g)?.length ?? 0) >= MIN_DIGITOS_REFERENCIA
}

/** ¿Esta forma se puede usar aquí? Devuelve el porqué si no. */
export function formaNoDisponible(forma: FormaPago, modo: ModoCobro, tipoEntrega?: string | null): string | null {
  if (modo === 'mostrador' && (forma === 'link' || forma === 'al_recibir')) return 'En mostrador el producto sale con pago o crédito; para cobrar después usa «Enviar o recoger».'
  if (modo === 'pedido' && forma === 'al_recibir' && tipoEntrega && tipoEntrega !== 'local' && tipoEntrega !== 'recoge') return 'La paquetería no cobra al entregar: elige otra forma.'
  return null
}

/** Qué falta para poder cobrar con esta forma; null si está completa. */
export function faltaEnCobro(c: CobroElegido | null, total: number, modo: ModoCobro, tipoEntrega?: string | null, hoy?: string): string | null {
  if (!c) return 'Elige cómo paga el cliente.'
  const no = formaNoDisponible(c.forma, modo, tipoEntrega)
  if (no) return no
  if (c.forma === 'efectivo' && c.recibido != null && c.recibido < total) return 'El efectivo recibido no alcanza.'
  if (c.forma === 'transferencia' && (c.referencia ?? '').trim().length < 3) return 'Escribe la referencia o clave de rastreo de la transferencia.'
  if (c.forma === 'transferencia' && !referenciaPareceComprobante(c.referencia)) return REFERENCIA_NO_COMPROBANTE
  if (c.forma === 'al_recibir' && !c.con) return '¿Cómo va a pagar al recibir? Efectivo, terminal o transferencia.'
  if (c.forma === 'credito') {
    if (!c.vence) return 'Elige la fecha límite de pago del crédito.'
    if (hoy && c.vence < hoy) return 'La fecha límite no puede ser anterior a hoy.'
    if (hoy && c.vence > sumarDiasISO(hoy, MAX_DIAS_CREDITO)) return `El crédito es de máximo ${MAX_DIAS_CREDITO} días.`
  }
  return null
}

/** Lo que el servidor espera (sin llaves vacías). */
export function cobroParaServidor(c: CobroElegido): Record<string, unknown> {
  const o: Record<string, unknown> = { forma: c.forma }
  if (c.forma === 'efectivo' && c.recibido != null) o.recibido = c.recibido
  if ((c.forma === 'transferencia' || c.forma === 'tarjeta') && c.referencia?.trim()) o.referencia = c.referencia.trim()
  if (c.forma === 'credito') { o.vence = c.vence; if (c.motivo?.trim()) o.motivo = c.motivo.trim() }
  if (c.forma === 'al_recibir' && c.con) o.con = c.con
  return o
}

/** Frase para el aviso de "Pedido creado" según cómo quedó el cobro. */
export function resultadoCobro(c: CobroElegido, vence?: string | null): { pagado: boolean; texto: string } {
  switch (c.forma) {
    case 'efectivo': case 'tarjeta': case 'transferencia':
      return { pagado: true, texto: 'quedó pagado y pasa a Almacén para prepararse.' }
    case 'credito':
      return { pagado: false, texto: `quedó a crédito${vence ? ` (paga a más tardar el ${fechaCorta(vence)})` : ''} y pasa a Almacén para prepararse. Dirección recibió el aviso.` }
    case 'al_recibir': {
      const con = c.con === 'tarjeta' ? ' con terminal' : c.con === 'transferencia' ? ' por transferencia' : c.con === 'efectivo' ? ' en efectivo' : ''
      return { pagado: false, texto: `pasa a Almacén y se cobra${con} al entregarlo (o al recogerlo en sucursal).` }
    }
    case 'link':
      return { pagado: false, texto: 'quedó por cobrar con link de pago: sácalo en la app de BanBajío y pégalo en «Cobrar pedidos». Pasa a Almacén cuando se pague.' }
  }
}

const MENSAJES: Array<[RegExp, string]> = [
  [/REFERENCIA_REQUERIDA/, 'Escribe la referencia o clave de rastreo de la transferencia.'],
  [/VENCIMIENTO_REQUERIDO/, 'Elige la fecha límite de pago del crédito.'],
  [/VENCIMIENTO_PASADO/, 'La fecha límite no puede ser anterior a hoy.'],
  [/VENCIMIENTO_LEJANO/, `El crédito es de máximo ${MAX_DIAS_CREDITO} días.`],
  [/AL_RECIBIR_SOLO_LOCAL/, 'Pagar al recibir es para entrega con chofer o para recoger en sucursal.'],
  [/EFECTIVO_INSUFICIENTE/, 'El efectivo recibido no alcanza.'],
  [/MONTO_MAYOR/, 'El monto es mayor a lo que debe el pedido.'],
  [/YA_PAGADO|SIN_SALDO/, 'Ese pedido ya está pagado.'],
  [/CREDITO_YA_AUTORIZADO/, 'Ese pedido ya tiene crédito.'],
  [/PEDIDO_CANCELADO/, 'Ese pedido está cancelado.'],
  [/FORMA_PAGO_REQUERIDA/, 'Elige cómo paga el cliente.'],
  [/NO_AUTORIZADO|insufficient/i, 'No puedes cobrar este pedido: no es venta tuya ni cliente de tu cartera.'],
]
export const mensajeCobro = (m?: string | null) => MENSAJES.find(([r]) => r.test(m ?? ''))?.[1] ?? null

/** Cobrar un pedido que ya existe (lista de pedidos por cobrar). Idempotente por opId. */
export async function cobrarVenta(orderId: string, c: CobroElegido, opId: string): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('cobrar_venta' as never, { p_op_id: opId, p_order: orderId, p_cobro: cobroParaServidor(c) } as never)
  if (error) return { ok: false, error: mensajeCobro(error.message) ?? 'No se pudo registrar el cobro. Intenta de nuevo.' }
  return { ok: true, data: (data ?? {}) as Record<string, unknown> }
}

/** Días del negocio (hora de Culiacán), con el helper único de fechas. */
export const sumarDiasISO = (dia: string, dias: number): string => sumarDias(dia, dias)
function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}
