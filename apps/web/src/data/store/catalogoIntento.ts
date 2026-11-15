// UX MODERNO · Fase 1 (15 nov 2026) · el Inicio del doctor abre el catálogo con una búsqueda ya escrita o directo en
// "revisar pedido". Se consume una sola vez al montar el catálogo.
let busqueda: string | null = null
let revisar = false
export const pedirBusqueda = (q: string) => { busqueda = q.trim() || null }
export const tomarBusqueda = (): string | null => { const q = busqueda; busqueda = null; return q }
export const pedirRevisarPedido = () => { revisar = true }
export const tomarRevisarPedido = (): boolean => { const r = revisar; revisar = false; return r }
