// COTIZAR EL ENVÍO AL VENDER (2 nov 2026) — puro, probado con vitest. Paquete estimado por piezas (antes de empacar no hay
// medidas reales) y servicios ordenados del más barato al más caro.
// PAQ-SIMPLE (23 nov 2026) · al vender solo se elige la paquetería; la cotización de DHL sirve para PROMETER la fecha (la
// llegada más tardía de los servicios permitidos, porque Almacén elige el servicio después). El cliente paga solo la
// regla: ya no hay «diferencia» por servicio.
export interface ConfigPaquete { paquete_kg_base?: number | null; paquete_kg_pieza?: number | null; paquete_largo_cm?: number | null; paquete_ancho_cm?: number | null; paquete_alto_cm?: number | null }
export interface ServicioCotizado { codigo: string; nombre: string; costo: number; llega_at?: string; llega_fecha: string }

// ═══ PAQ-SIMPLE · servicios de DHL que NUNCA se ofrecen ni se usan (venta, Almacén y guía). Único lugar de la lista:
// lo usan la Edge entrega-cotizar, la Edge shipping (tarifas y crear guía) y la pantalla de Almacén.
//   'G' = ECONOMY SELECT (el más barato y lento).
export const SERVICIOS_DHL_EXCLUIDOS: readonly string[] = ['G']
/** ¿Ese código de servicio de DHL se puede ofrecer/usar? */
export function servicioDhlPermitido(codigo: string | null | undefined, excluidos: readonly string[] = SERVICIOS_DHL_EXCLUIDOS): boolean {
  const c = String(codigo ?? '').trim().toUpperCase()
  return !!c && !excluidos.some((x) => x.toUpperCase() === c)
}
/** Quita de una lista de tarifas de DHL los servicios prohibidos (las que no traen código se dejan: no hay cómo saber). */
export function sinServiciosExcluidos<T extends { serviceCode?: string | null }>(tarifas: T[], excluidos: readonly string[] = SERVICIOS_DHL_EXCLUIDOS): T[] {
  return tarifas.filter((x) => !x.serviceCode || servicioDhlPermitido(x.serviceCode, excluidos))
}

// ═══ DHL-FECHA (23 nov 2026) · la cotización se pide para la SALIDA REAL del paquete, no para "el siguiente día hábil".
// Antes se cotizaba siempre como si saliera mañana: a Valle de Santiago (38406) DHL prometía el lunes 30 cuando, saliendo
// el lunes 23 antes del corte, llega el viernes 27 (Alberto). Misma regla que public._entrega_salida en la base:
// hoy si es antes del corte y es día de paquetería (y no está cerrado); si no, el siguiente día válido.
export interface ReglaSalida { corte: string; dias: number[]; cerrados?: string[]; zona?: string }
/** Fecha y hora local (AAAA-MM-DD, HH:MM) y desfase "GMT-07:00" de un instante en la zona del negocio. */
export function relojLocal(ahoraMs: number, zona = 'America/Mazatlan'): { dia: string; hora: string; desfase: string } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(new Date(ahoraMs))
  const de = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  const off = de('timeZoneName').replace('GMT', '') || '+00:00'
  return { dia: `${de('year')}-${de('month')}-${de('day')}`, hora: `${de('hour')}:${de('minute')}`, desfase: `GMT${off}` }
}
const sumarDia = (dia: string, n: number) => { const [y, m, d] = dia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
const isoDow = (dia: string) => { const [y, m, d] = dia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7 }
/** El día en que el paquete sale de verdad (AAAA-MM-DD), con la regla de la base. */
export function salidaPaqueteria(ahoraMs: number, r: ReglaSalida): string {
  const { dia, hora } = relojLocal(ahoraMs, r.zona)
  const valido = (x: string) => r.dias.includes(isoDow(x)) && !(r.cerrados ?? []).includes(x)
  if (hora < r.corte.slice(0, 5) && valido(dia)) return dia
  for (let i = 1; i <= 60; i++) { const x = sumarDia(dia, i); if (valido(x)) return x }
  return sumarDia(dia, 1)
}
/** plannedShippingDateAndTime para MyDHL: el día de salida; si es hoy, dentro de 30 min (nunca en el pasado), si no 12:00. */
export function fechaPlaneadaDhl(ahoraMs: number, r: ReglaSalida): string {
  const salida = salidaPaqueteria(ahoraMs, r)
  const { dia, desfase } = relojLocal(ahoraMs, r.zona)
  const hora = salida === dia ? relojLocal(ahoraMs + 30 * 60_000, r.zona).hora : '12:00'
  return `${salida}T${hora}:00 ${desfase}`
}

export function paqueteEstimado(piezas: number, c: ConfigPaquete) {
  const kg = Math.round((Number(c.paquete_kg_base ?? 1) + Math.max(0, piezas) * Number(c.paquete_kg_pieza ?? 0.3)) * 100) / 100
  return { weightKg: Math.max(0.5, kg), lengthCm: Number(c.paquete_largo_cm ?? 30), widthCm: Number(c.paquete_ancho_cm ?? 25), heightCm: Number(c.paquete_alto_cm ?? 20), pieces: 1 }
}

/** De las tarifas de la paquetería a lo que se guarda en la cotización: código, nombre, costo y fecha de llegada. Sin los prohibidos. */
export function serviciosCotizados(tarifas: Array<{ serviceCode?: string; service: string; amount: number; etaDays: number; entregaAt?: string }>, ahoraMs = Date.now()): ServicioCotizado[] {
  const validas = tarifas.filter((x) => x.serviceCode && x.amount > 0 && servicioDhlPermitido(x.serviceCode))
  return validas.map((x) => {
    const fecha = x.entregaAt?.slice(0, 10) ?? new Date(ahoraMs + x.etaDays * 86_400_000 - 7 * 3_600_000).toISOString().slice(0, 10)
    return { codigo: String(x.serviceCode), nombre: x.service, costo: x.amount, ...(x.entregaAt ? { llega_at: x.entregaAt } : {}), llega_fecha: fecha }
  }).sort((a, b) => a.costo - b.costo)
}

/** PAQ-SIMPLE · la promesa al cliente: la llegada MÁS TARDÍA entre los servicios permitidos (la misma regla que la base). */
export function promesaDeServicios(servicios: Array<Pick<ServicioCotizado, 'codigo' | 'llega_fecha'>>): { codigo: string; llega_fecha: string } | null {
  let mejor: { codigo: string; llega_fecha: string } | null = null
  for (const s of servicios) {
    if (!servicioDhlPermitido(s.codigo) || !/^\d{4}-\d{2}-\d{2}/.test(s.llega_fecha ?? '')) continue
    const f = s.llega_fecha.slice(0, 10)
    if (!mejor || f > mejor.llega_fecha) mejor = { codigo: s.codigo, llega_fecha: f }
  }
  return mejor
}
