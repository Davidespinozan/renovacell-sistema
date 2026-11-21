// CAJAS CON MEDIOS (21 nov 2026, dueño: «1 caja debe ser 1»). Los ultrafiltrados se guardan por MEDIA CAJA (unit
// 'Media caja/10 viales'), pero la gente ve y escribe CAJAS con medios: 1, 1½, 2… Esta es la única conversión:
//   interno (medias) → cajas: n / 2          cajas → interno: round(cajas × 2)
//   precio por caja = precio interno × 2
// Para cualquier otro producto el factor es 1 y todo queda igual.
export interface ConUnidad { unit?: string | null }

export const esMediaCaja = (p: ConUnidad | null | undefined): boolean => /^media caja/i.test(p?.unit ?? '')
/** Cuántas unidades internas forman una unidad que ve la gente (2 para media caja, 1 el resto). */
export const factor = (p: ConUnidad | null | undefined): number => (esMediaCaja(p) ? 2 : 1)

/** Cantidad interna → cantidad que ve la gente (1.5 para 3 medias). */
export const aVista = (p: ConUnidad | null | undefined, interno: number): number => interno / factor(p)
/** Cantidad que escribe la gente (puede traer ½) → cantidad interna entera. */
export const aInterno = (p: ConUnidad | null | undefined, vista: number): number => Math.max(0, Math.round(vista * factor(p)))
/** Precio por la unidad que ve la gente (por caja). */
export const precioVista = (p: ConUnidad | null | undefined, precioInterno: number): number => precioInterno * factor(p)

/** «1½», «½», «2» — sin unidad. */
export function numeroVista(p: ConUnidad | null | undefined, interno: number): string {
  const v = aVista(p, interno)
  if (!esMediaCaja(p)) return String(interno)
  const ent = Math.floor(v), medio = Math.abs(v - ent) >= 0.25
  return ent === 0 && medio ? '½' : `${ent}${medio ? '½' : ''}`
}
/** «1½ cajas», «½ caja», «2 cajas»; para el resto, el número tal cual (o con su unidad si se pide). */
export function cantidadVista(p: ConUnidad | null | undefined, interno: number, unidadOtros = ''): string {
  if (!esMediaCaja(p)) return unidadOtros ? `${interno} ${unidadOtros}` : String(interno)
  const v = aVista(p, interno)
  return `${numeroVista(p, interno)} ${v > 1 ? 'cajas' : 'caja'}`
}
/** Texto de la unidad que ve la gente. */
export const unidadVista = (p: ConUnidad | null | undefined): string | null => (esMediaCaja(p) ? 'Caja/20 viales · se vende por media caja' : p?.unit ?? null)
/** Paso del control +/− en unidades que ve la gente (0.5 caja) — el interno siempre sube de 1 en 1. */
export const pasoVista = (p: ConUnidad | null | undefined): number => 1 / factor(p)
