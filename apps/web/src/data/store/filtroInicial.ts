// PENDIENTES QUE ABREN YA FILTRADOS (27 nov 2026, «sistema sencillo por rol»): un renglón de la bandeja («CFDI por emitir»,
// «Por cobrar», «Reembolsos por resolver»…) abría su pantalla sin filtrar y había que volver a buscar. El renglón deja
// aquí el filtro con el que la pantalla debe abrir; la pantalla lo toma UNA vez al montarse. Si nadie lo pidió, abre
// como siempre. Si la pantalla YA está abierta y escuchando (buscar un pedido estando en Ventas), lo recibe al momento.
const pedidos: Record<string, string> = {}
const oyentes: Record<string, Set<(filtro: string) => void>> = {}
export const pedirFiltro = (pantalla: string, filtro: string): void => {
  const o = oyentes[pantalla]
  if (o && o.size > 0) { o.forEach((f) => f(filtro)); return }
  pedidos[pantalla] = filtro
}
/** Lo MIRA sin gastarlo: para el estado inicial de la pantalla (un inicializador no debe tener efectos; React puede
 *  ejecutarlo dos veces). La pantalla lo gasta después, en un efecto, con `tomarFiltro`. */
export const verFiltro = (pantalla: string): string | null => pedidos[pantalla] ?? null
export const tomarFiltro = (pantalla: string): string | null => { const f = pedidos[pantalla] ?? null; delete pedidos[pantalla]; return f }
/** La pantalla abierta se suscribe; devuelve cómo darse de baja. */
export const escucharFiltro = (pantalla: string, cb: (filtro: string) => void): (() => void) => {
  (oyentes[pantalla] ??= new Set()).add(cb)
  return () => { oyentes[pantalla]?.delete(cb) }
}
