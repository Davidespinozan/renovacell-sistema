// Teléfono legible como en WhatsApp: "+52 667 867 5738". El número de WhatsApp de México trae un 1 tras el 52
// (+52 1 …) que la gente no reconoce: se omite al mostrarlo. Lo que no se reconoce se deja tal cual.
export function telefonoLegible(t: string | null | undefined): string | null {
  const s = (t ?? '').trim()
  if (!s) return null
  const d = s.replace(/\D/g, '')
  const mx = d.length === 13 && d.startsWith('521') ? d.slice(3) : d.length === 12 && d.startsWith('52') ? d.slice(2) : d.length === 10 && !s.startsWith('+') ? d : null
  if (mx) return `+52 ${mx.slice(0, 3)} ${mx.slice(3, 6)} ${mx.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`
  return s.startsWith('+') ? s : d.length >= 8 ? `+${d}` : s
}

/** Número para MARCAR desde el celular (enlace tel:): solo dígitos con +52; toma el PRIMER número de 10 dígitos aunque
 *  vengan dos ("961-611-1843 961-611-4287") o ya traiga +52 / +52 1. Sin número válido: null (no se muestra el botón). */
export function telParaMarcar(t: string | null | undefined): string | null {
  const m = /(?:\+?52[\s-]*(?:1[\s-]*)?)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/.exec(t ?? '')
  if (!m) return null
  let d = m[0].replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3)
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2)
  return /^\d{10}$/.test(d) ? `+52${d}` : null
}
