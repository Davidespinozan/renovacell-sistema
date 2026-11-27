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

// ── ENTREGAR VARIOS AL CHOFER DE UNA VEZ (27 nov 2026) ─────────────────────────────────────────────────────────────
// Cuando salen varios pedidos locales a la misma hora, antes había que abrir, elegir chofer y confirmar uno por uno.
// Aquí cada pedido hace EXACTAMENTE los tres pasos de «Entregar al chofer» (asignar → dar salida → En camino), uno tras
// otro. Si uno falla, los demás siguen y el resultado dice cuál falló y en qué paso; nada queda a medias sin avisar.
export interface PasosLote {
  asignar: (pedidoId: string, choferId: string) => Promise<{ ok: true; envioId: string } | { ok: false; error: string }>
  darSalida: (envioId: string, folio: string) => Promise<{ ok: boolean; error?: string }>
  enCamino: (pedidoId: string, choferId: string) => Promise<{ ok: boolean; error?: string }>
}
export interface ResultadoLote { entregados: string[]; fallas: Array<{ id: string; folio: string; mensaje: string }> }

export async function entregarLoteAlChofer(pedidos: Array<{ id: string; folio: string }>, choferId: string, pasos: PasosLote, alAvanzar?: (hechos: number) => void): Promise<ResultadoLote> {
  const r: ResultadoLote = { entregados: [], fallas: [] }
  let hechos = 0
  for (const p of pedidos) {
    const falla = (mensaje: string) => r.fallas.push({ id: p.id, folio: p.folio, mensaje })
    const a = await pasos.asignar(p.id, choferId)
    if (!a.ok) falla(`No se asignó el chofer. ${a.error}`)
    else {
      const d = await pasos.darSalida(a.envioId, p.folio)
      if (!d.ok) falla(`Quedó asignado, pero NO salió. ${d.error ?? ''}`.trim())
      else {
        const e = await pasos.enCamino(p.id, choferId)
        if (!e.ok) falla(`La carga salió, pero el pedido NO pasó a En camino. ${e.error ?? ''}`.trim())
        else r.entregados.push(p.id)
      }
    }
    hechos += 1; alAvanzar?.(hechos)
  }
  return r
}
