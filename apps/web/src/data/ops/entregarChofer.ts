// ALMACÉN · ENTREGAR AL CHOFER EN UN PASO (27 nov 2026, «sistema sencillo por rol»): el chofer nunca venía elegido —ni
// habiendo uno solo— y asignar y dar salida eran dos confirmaciones. Aquí vive lo que se puede probar sin pantalla.
const CLAVE = 'rc_ultimo_chofer'

/** Chofer que ya viene elegido: el único que hay o, si hay varios, el último que eligió esta persona. */
export function choferSugerido(choferes: Array<{ id: string }>, ultimo: string | null): string {
  if (choferes.length === 1) return choferes[0].id
  return ultimo && choferes.some((c) => c.id === ultimo) ? ultimo : ''
}
export const leerUltimoChofer = (): string | null => { try { return localStorage.getItem(CLAVE) } catch { return null } }
export const recordarChofer = (id: string): void => { try { localStorage.setItem(CLAVE, id) } catch { /* sin almacenamiento */ } }

export type MetodoEntrega = 'paqueteria' | 'chofer' | 'recoge'
/** El botón dice el paso que sigue según cómo se vendió. Sin dato de entrega (pedidos viejos) se queda genérico. */
export function textoSiguientePaso(metodo: MetodoEntrega | null): string {
  return metodo === 'recoge' ? 'Listo para recoger' : metodo === 'chofer' ? 'Entregar al chofer' : metodo === 'paqueteria' ? 'Generar guía' : 'Asignar envío'
}
