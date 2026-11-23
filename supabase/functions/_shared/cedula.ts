// CÉDULA ÚNICA (23 nov 2026, auditoría de altas). Antes cada puerta validaba distinto (7–8, 5–12, «5 o más», hasta 40
// caracteres guardados tal cual). Una sola regla en todo el sistema (servidor, pantallas y base: public._cedula_canonica):
// solo números, de 5 a 8 dígitos (las antiguas de 5–6 y las actuales de 7–8). Se guarda limpia (sin espacios ni guiones).
export const MENSAJE_CEDULA = 'La cédula profesional son solo números, de 5 a 8 dígitos.'
/** La cédula en su forma canónica (solo dígitos, 5–8) o null si no es válida. */
export function cedulaCanonica(s: unknown): string | null {
  const d = (typeof s === 'string' ? s : '').replace(/\D/g, '')
  return /^[0-9]{5,8}$/.test(d) ? d : null
}
