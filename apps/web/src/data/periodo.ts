// RELOJ DEL NEGOCIO — la ÚNICA definición de día, mes y periodo para todo reporte.
//
// La autoridad es el servidor: `hoy_local()` y `dia_negocio(timestamptz)` cortan el
// día en 'America/Mazatlan'. Este módulo NO es otro reloj: aplica la MISMA zona IANA
// con la base de zonas del navegador, y su equivalencia con Postgres se demuestra con
// una sola tabla de vectores que ejecutan los dos lados
// (supabase/tests/db/tests/w5_00_reloj.sql ↔ periodo.equivalencia.test.ts).
//
// Reglas que este módulo hace cumplir (y que `periodo.guard.test.ts` vigila):
//  · un reporte NUNCA corta por UTC (`toISOString().slice(0, 10)`);
//  · NUNCA usa el reloj del dispositivo (`getMonth()`, `getDate()`…): la misma venta
//    debe caer en el mismo día la vea quien la vea, desde donde la vea;
//  · un concepto de calendario (día, mes) se corta por calendario, no por una
//    ventana de milisegundos contada hacia atrás desde "ahora".
export const ZONA_NEGOCIO = 'America/Mazatlan'

/** Día del negocio, 'AAAA-MM-DD'. Es una fecha de calendario, no un instante. */
export type Dia = string
/** Mes del negocio, 'AAAA-MM'. */
export type Mes = string

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/
const partes = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_NEGOCIO, year: 'numeric', month: '2-digit', day: '2-digit',
})

/**
 * Día del negocio en que ocurrió un instante. Equivale a `dia_negocio(ts)` del servidor.
 * Una fecha sin hora ('2026-10-31': `value_date`, `expenses.fecha`, caducidades) YA es
 * un día del negocio y se devuelve tal cual: interpretarla como medianoche UTC la
 * recorrería al día anterior.
 */
export function diaNegocio(instante: string | number | Date): Dia {
  if (typeof instante === 'string' && SOLO_FECHA.test(instante)) return instante
  const d = instante instanceof Date ? instante : new Date(instante)
  if (Number.isNaN(d.getTime())) return ''
  const p = partes.formatToParts(d)
  const de = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${de('year')}-${de('month')}-${de('day')}`
}

/** "Hoy" del negocio. Equivale a `hoy_local()` del servidor. */
export const hoyNegocio = (ahora: Date = new Date()): Dia => diaNegocio(ahora)

export const mesDe = (dia: Dia): Mes => dia.slice(0, 7)
export const mesNegocio = (instante: string | number | Date): Mes => mesDe(diaNegocio(instante))

// ── Aritmética de CALENDARIO (sobre días, sin horas ni zonas) ─────────────────
const aNumero = (dia: Dia): number => {
  const [y, m, d] = dia.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const aDia = (n: number): Dia => new Date(n).toISOString().substring(0, 10) // n es medianoche UTC exacta: solo formato
const DIA_MS = 86_400_000

export const sumarDias = (dia: Dia, n: number): Dia => aDia(aNumero(dia) + n * DIA_MS)
/** Días de calendario de `desde` a `hasta` (negativo si `hasta` es anterior). */
export const diasEntre = (desde: Dia, hasta: Dia): number => Math.round((aNumero(hasta) - aNumero(desde)) / DIA_MS)

export function sumarMeses(mes: Mes, n: number): Mes {
  const [y, m] = mes.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12 + 12) % 12 + 1).padStart(2, '0')}`
}
export const primerDiaMes = (mes: Mes): Dia => `${mes}-01`
export const ultimoDiaMes = (mes: Mes): Dia => sumarDias(primerDiaMes(sumarMeses(mes, 1)), -1)

/** Duración entre dos instantes, en días (con fracción). Es una DURACIÓN, no un corte. */
export function duracionDias(desde: string | Date, hasta: string | Date): number {
  return (new Date(hasta).getTime() - new Date(desde).getTime()) / DIA_MS
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const nombreMes = (mes: Mes): string => MESES[Number(mes.slice(5, 7)) - 1] ?? mes
export const etiquetaMes = (mes: Mes): string => `${nombreMes(mes)} ${mes.slice(0, 4)}`

// ── Periodos ──────────────────────────────────────────────────────────────────
/**
 * Un periodo es un rango de DÍAS DEL NEGOCIO, ambos inclusive. `null` = sin límite.
 * Es exactamente lo que reciben las funciones `kpi_*` del servidor (p_desde, p_hasta).
 */
export interface Periodo {
  clave: string
  desde: Dia | null
  hasta: Dia | null
  /** Texto para la pantalla. Siempre dice QUÉ periodo es; nunca "del periodo" a secas. */
  etiqueta: string
}

export function periodoMes(mes: Mes, prefijo?: string): Periodo {
  return {
    clave: `mes:${mes}`, desde: primerDiaMes(mes), hasta: ultimoDiaMes(mes),
    etiqueta: prefijo ? `${prefijo} · ${etiquetaMes(mes)}` : etiquetaMes(mes),
  }
}
export const esteMes = (ahora: Date = new Date()): Periodo => periodoMes(mesNegocio(ahora), 'Este mes')
export const mesPasado = (ahora: Date = new Date()): Periodo => periodoMes(sumarMeses(mesNegocio(ahora), -1), 'Mes pasado')

/** Los últimos `n` días DE CALENDARIO del negocio, hoy incluido. */
export function ultimosDias(n: number, ahora: Date = new Date()): Periodo {
  const hoy = hoyNegocio(ahora)
  return { clave: `dias:${n}:${hoy}`, desde: sumarDias(hoy, -(n - 1)), hasta: hoy, etiqueta: `Últimos ${n} días` }
}
export const todoElHistorico = (): Periodo => ({ clave: 'todo', desde: null, hasta: null, etiqueta: 'Todo el histórico' })

/** El periodo inmediatamente anterior y del mismo tamaño (mes ↔ mes, N días ↔ N días). */
export function periodoAnterior(p: Periodo): Periodo | null {
  if (!p.desde || !p.hasta) return null
  if (p.clave.startsWith('mes:')) return periodoMes(sumarMeses(mesDe(p.desde), -1))
  const n = diasEntre(p.desde, p.hasta) + 1
  const hasta = sumarDias(p.desde, -1)
  return { clave: `rango:${sumarDias(hasta, -(n - 1))}:${hasta}`, desde: sumarDias(hasta, -(n - 1)), hasta, etiqueta: `${n} días anteriores` }
}

/** ¿El instante (o día) cae dentro del periodo? Corta por día del negocio. */
export function enPeriodo(instante: string | number | Date, p: Pick<Periodo, 'desde' | 'hasta'>): boolean {
  const d = diaNegocio(instante)
  if (!d) return false
  if (p.desde && d < p.desde) return false
  if (p.hasta && d > p.hasta) return false
  return true
}

/** Los últimos `n` meses del negocio, del más antiguo al actual. */
export function ultimosMeses(n: number, ahora: Date = new Date()): Mes[] {
  const actual = mesNegocio(ahora)
  return Array.from({ length: n }, (_, i) => sumarMeses(actual, i - (n - 1)))
}
