// PERFIL FISCAL CANÓNICO — un solo contrato para Portal/POS/Admin/Facturación y para el
// snapshot por pedido. La autoridad de almacenamiento es customers.meta.fiscal; el snapshot
// congelado vive en orders.invoice_meta.receiver. Estos helpers PUROS evitan que cada canal
// invente formas incompatibles. No es un motor SAT: valida lo mínimo y deja el juicio fiscal
// final a Facturama. Reutiliza los catálogos SAT existentes (régimen, uso CFDI).
import { esRegimenValido } from '../sat/regimenesFiscales'
import { esUsoCfdiValido } from '../sat/usosCfdi'

export interface FiscalProfile {
  rfc: string
  razon_social: string
  regimen: string
  cp: string
  uso_cfdi: string
  email_facturacion: string
}

export type PersonType = 'fisica' | 'moral'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// RFC PF = 13 (4 letras + 6 fecha + 3 homoclave); PM = 12 (3 letras + 6 + 3).
const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/

// Tipo de persona inferido del RFC (sin columna nueva): 13 = física, 12 = moral.
export function personTypeFromRfc(rfc: string | null | undefined): PersonType | null {
  const r = (rfc ?? '').trim().toUpperCase()
  if (r.length === 13) return 'fisica'
  if (r.length === 12) return 'moral'
  return null
}

// Normaliza cualquier origen (canónico nuevo, legacy profiles.meta.fiscal, o parcial POS) al
// contrato canónico. NUNCA inventa valores: lo ausente queda como cadena vacía.
export function normalizeFiscalProfile(raw: unknown): FiscalProfile {
  const r = (raw ?? {}) as Record<string, unknown>
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  return {
    // canónico → legacy(name/taxRegime/taxZip/cfdiUse) → parcial POS(razon_social/uso_cfdi/email)
    rfc: s(r.rfc).toUpperCase(),
    razon_social: s(r.razon_social) || s(r.name),
    regimen: s(r.regimen) || s(r.taxRegime),
    cp: s(r.cp) || s(r.taxZip),
    uso_cfdi: s(r.uso_cfdi) || s(r.cfdiUse),
    email_facturacion: (s(r.email_facturacion) || s(r.email)).toLowerCase(),
  }
}

// Validación mínima previa a guardar/timbrar. Devuelve errores por campo (para la UI) y `ok`.
export function validateFiscalProfile(input: unknown): { ok: boolean; errors: Partial<Record<keyof FiscalProfile, string>> } {
  const f = normalizeFiscalProfile(input)
  const errors: Partial<Record<keyof FiscalProfile, string>> = {}
  if (!f.rfc) errors.rfc = 'RFC requerido.'
  else if (f.rfc.length !== 12 && f.rfc.length !== 13) errors.rfc = 'El RFC debe tener 12 (moral) o 13 (física) caracteres.'
  else if (!RFC_RE.test(f.rfc)) errors.rfc = 'Formato de RFC no válido.'
  if (!f.razon_social) errors.razon_social = 'Razón social requerida.'
  if (!f.regimen) errors.regimen = 'Régimen fiscal requerido.'
  else if (!esRegimenValido(f.regimen)) errors.regimen = 'Régimen fiscal no válido.'
  if (!f.cp) errors.cp = 'CP fiscal requerido.'
  else if (!/^\d{5}$/.test(f.cp)) errors.cp = 'El CP debe tener 5 dígitos.'
  if (!f.uso_cfdi) errors.uso_cfdi = 'Uso de CFDI requerido.'
  else if (!esUsoCfdiValido(f.uso_cfdi)) errors.uso_cfdi = 'Uso de CFDI no válido.'
  if (!f.email_facturacion) errors.email_facturacion = 'Correo de facturación requerido.'
  else if (!EMAIL_RE.test(f.email_facturacion)) errors.email_facturacion = 'Correo de facturación no válido.'
  return { ok: Object.keys(errors).length === 0, errors }
}

// ¿El perfil tiene los 6 campos válidos? (hard gate cliente; el servidor revalida).
export function isFiscalProfileComplete(input: unknown): boolean {
  return validateFiscalProfile(input).ok
}

// Vacío canónico para inicializar formularios.
export const emptyFiscalProfile = (): FiscalProfile => ({ rfc: '', razon_social: '', regimen: '', cp: '', uso_cfdi: '', email_facturacion: '' })
