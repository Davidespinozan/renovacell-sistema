// Datos de ENTREGA que la paquetería exige y el pedido no siempre trae estructurados (pedidos cuyo domicilio se
// capturó como texto libre: el C.P. queda dentro de "ciudad" y el teléfono como "—"). Empaque los completa SOLO para
// la guía: no se inventan (el C.P. detectado en el texto es una sugerencia que el operador confirma) y no cambian el
// domicilio guardado en el pedido.
import type { Receiver } from './model'

export interface AjusteEntrega { cp: string; phone: string }

const digitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
export const cpValido = (v: unknown): boolean => /^\d{5}$/.test(String(v ?? '').trim())
// Un teléfono utilizable para la paquetería: al menos 10 dígitos ("—", "s/n" o vacío no lo son).
export const telefonoValido = (v: unknown): boolean => digitos(v).length >= 10

// C.P. que aparece escrito en el domicilio (calle, colonia, ciudad, estado o referencias). Solo si hay UNO.
export function cpSugerido(r: Receiver): string | null {
  const a = r.address as unknown as Record<string, unknown>
  const texto = ['line1', 'colonia', 'city', 'state', 'refs'].map((k) => String(a[k] ?? '')).join(' | ')
  const hallados = Array.from(new Set(texto.match(/(?<!\d)\d{5}(?!\d)/g) ?? []))
  return hallados.length === 1 ? hallados[0] : null
}

export function faltantesEntrega(r: Receiver): { cp: boolean; phone: boolean } {
  return { cp: !cpValido(r.address.cp), phone: !telefonoValido(r.address.phone) }
}

// Destinatario para la guía: lo del pedido manda; lo capturado en empaque solo cubre lo que falta o no sirve.
export function receptorParaGuia(base: Receiver, ajuste: AjusteEntrega): Receiver {
  const f = faltantesEntrega(base)
  return {
    ...base,
    address: {
      ...base.address,
      cp: f.cp ? (cpValido(ajuste.cp) ? ajuste.cp.trim() : '') : String(base.address.cp ?? '').trim(),
      phone: f.phone ? (telefonoValido(ajuste.phone) ? ajuste.phone.trim() : '') : base.address.phone,
    },
  }
}
