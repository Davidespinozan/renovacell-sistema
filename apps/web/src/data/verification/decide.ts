// Motor de decisión de VERIFICACIÓN AUTOMÁTICA (IA + SEP).
// Dada la cédula que capturó el doctor y el registro oficial (SEP/RENAPO), decide si
// se auto-verifica, se manda a revisión, o se rechaza. Es PURO (sin red): la consulta
// al registro y el OCR viven en la Edge Function `verify-cedula` (seam del proveedor).
//
// Lógica:
//  - La cédula debe EXISTIR en el registro (fuente de verdad).
//  - La PROFESIÓN debe ser del área médica (no se vende a otras carreras).
//  - El NOMBRE capturado debe COINCIDIR con el del registro (evita usar cédula ajena).
//  - Score alto y todo OK → auto; dudas → cola de revisión; sin match → rechazo.

export interface SepRecord {
  found: boolean
  name?: string
  profession?: string
  year?: string
  institution?: string
}

export type Decision = 'auto' | 'review' | 'reject'

export interface VerifyDecision {
  score: number       // 0..100
  nameMatch: number   // 0..100
  isMedical: boolean
  decision: Decision
  reasons: string[]
  sep: SepRecord
}

const norm = (s?: string): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()

const tokens = (s?: string): string[] => norm(s).split(' ').filter((t) => t.length > 1 && !['dr', 'dra', 'de', 'del', 'la', 'los'].includes(t))

// Similitud de nombre por traslape de tokens (robusta a acentos, orden de apellidos,
// "Dr(a)." y palabras vacías). 1 = todos los tokens del más corto están en el otro.
export function nameSimilarity(a?: string, b?: string): number {
  const A = new Set(tokens(a))
  const B = new Set(tokens(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  A.forEach((t) => { if (B.has(t)) inter += 1 })
  return inter / Math.max(A.size, B.size)
}

const MEDICAL = ['medic', 'cirug', 'cirujan', 'dermatolog', 'ginecolog', 'pediatr', 'cardiolog', 'anestesiolog', 'oftalmolog', 'odontolog', 'estomatolog', 'salud', 'enferm']
export function isMedicalProfession(p?: string): boolean {
  const n = norm(p)
  return n !== '' && MEDICAL.some((k) => n.includes(k))
}

export function decideVerification(enteredName: string, sep: SepRecord): VerifyDecision {
  if (!sep.found) {
    return { score: 0, nameMatch: 0, isMedical: false, decision: 'reject', reasons: ['La cédula no aparece en el registro oficial (SEP/RENAPO).'], sep }
  }
  const nm = nameSimilarity(enteredName, sep.name)
  const medical = isMedicalProfession(sep.profession)
  const nameMatch = Math.round(nm * 100)
  const score = Math.round((nm * 0.6 + (medical ? 1 : 0) * 0.4) * 100)

  const reasons: string[] = []
  let decision: Decision
  if (medical && nm >= 0.85) {
    decision = 'auto'
    reasons.push('Cédula válida en el registro, profesión del área médica y nombre coincide.')
  } else {
    if (!medical) reasons.push(`La profesión registrada ("${sep.profession ?? '—'}") no es del área médica.`)
    if (nm < 0.85) reasons.push(`El nombre coincide al ${nameMatch}% con el del registro.`)
    decision = nm >= 0.5 ? 'review' : 'reject'
    if (decision === 'review') reasons.push('Requiere revisión manual de Dirección.')
    else reasons.push('El nombre no coincide con el titular de la cédula.')
  }
  return { score, nameMatch, isMedical: medical, decision, reasons, sep }
}

// --- Simulador de SEP para modo demo (sin proveedor real) --------------------
// SEAM: en producción, la Edge Function `verify-cedula` reemplaza esto por la consulta
// real al Registro Nacional de Profesionistas (SEP/RENAPO) vía el proveedor de KYC.
// Simulación determinista por el último dígito de la cédula, para demostrar las 3 ramas:
//   termina en 0 → no existe (rechazo) · termina en 9 → existe pero NO médico (revisión)
//   resto → médico con el nombre capturado (auto).
export function simulateSep(cedula: string, enteredName: string): SepRecord {
  const digits = (cedula ?? '').replace(/\D/g, '')
  if (digits.length < 5) return { found: false }
  const last = digits[digits.length - 1]
  if (last === '0') return { found: false } // no existe → rechazo
  if (last === '9') return { found: true, name: enteredName, profession: 'Licenciatura en Administración', year: '2015', institution: 'UNAM' } // no médico → revisión
  if (last === '8') return { found: true, name: 'Juan Pérez García', profession: 'Médico Cirujano', year: '2013', institution: 'IPN' } // registrada a OTRO → rechazo por nombre
  return { found: true, name: enteredName, profession: 'Médico Cirujano', year: '2014', institution: 'UNAM' } // médico y nombre coincide → auto
}
