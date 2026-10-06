// CC-5 · Lógica PURA del carrito compartida (sin Deno ni supabase): cantidades, operation_id y
// mapeo de errores de la base a respuestas controladas. La autoridad vive en la base (cc_carrito_*).

export const MAX_CANTIDAD = 999
export const MAX_OPERACION = 120

/** Entero 1..999 (0 permitido solo en actualizar = quitar). NaN/decimal/negativo/infinito/texto → null. */
export function validarCantidad(entrada: unknown, permitirCero = false): number | null {
  const n = typeof entrada === 'number' ? entrada : (typeof entrada === 'string' && /^\d+$/.test(entrada.trim()) ? Number(entrada) : NaN)
  if (!Number.isInteger(n)) return null
  if (n === 0) return permitirCero ? 0 : null
  return n >= 1 && n <= MAX_CANTIDAD ? n : null
}

export function validarOperacion(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null
  const t = entrada.trim()
  return t && t.length <= MAX_OPERACION && /^[A-Za-z0-9:_.-]+$/.test(t) ? t : null
}

export function mapearErrorCarrito(mensaje: string | undefined): { status: number; body: { error: string; message: string } } | null {
  const m = mensaje ?? ''
  const r = (status: number, error: string, message: string) => ({ status, body: { error, message } })
  if (/CARRITO_CERRADO/.test(m)) return r(409, 'carrito_cerrado', 'Este carrito ya no acepta cambios.')
  if (/CANTIDAD_INVALIDA/.test(m)) return r(400, 'cantidad_invalida', 'La cantidad no es válida (1 a 999).')
  if (/PRODUCTO_NO_DISPONIBLE/.test(m)) return r(404, 'producto_no_disponible', 'Ese producto no está disponible.')
  if (/PRODUCTO_NO_VENDIBLE/.test(m)) return r(409, 'producto_no_vendible', 'Ese producto no se vende por pieza; elige una presentación.')
  if (/IDEMPOTENCIA_CONFLICTO/.test(m)) return r(409, 'idempotencia_conflicto', 'Esa operación ya se registró con otros datos.')
  if (/ACCION_INVALIDA/.test(m)) return r(400, 'accion_invalida', 'Acción no válida.')
  // CC-6
  if (/OPERACION_INVALIDA/.test(m)) return r(400, 'operacion_invalida', 'Falta operation_id válido.')
  if (/NO_VERIFICADO|is_verified/.test(m)) return r(403, 'NO_VERIFICADO', 'Tu cuenta aún no está verificada por Renovacell.')
  if (/No autorizado/.test(m)) return r(403, 'no_autorizado', 'No puedes confirmar este pedido.')
  // C360-0 · sin expediente de cliente vinculado no hay pedido (falla cerrado, el carrito queda intacto)
  if (/CLIENTE_NO_VINCULADO/.test(m)) return r(409, 'cliente_no_vinculado', 'Tu cuenta aún no está ligada a tu expediente de cliente. Renovacell lo completa; tu carrito sigue guardado.')
  if (/FALLO_INYECTADO|W1_INCONSISTENTE/.test(m)) return r(503, 'no_disponible', 'No se pudo crear el pedido. Tu carrito sigue intacto; intenta de nuevo.')
  return null   // lo demás (NO_AUTORIZADO, SESION_INVALIDA, CUENTA_SUSPENDIDA…) lo traduce el mapa de CC-2
}
