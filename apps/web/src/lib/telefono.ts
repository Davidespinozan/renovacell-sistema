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
