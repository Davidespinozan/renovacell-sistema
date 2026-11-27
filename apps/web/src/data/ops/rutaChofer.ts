// CHOFER · MENOS PASOS PARA REGISTRAR (27 nov 2026, «sistema sencillo por rol»): hasta hoy el chofer confirmaba su carga
// pedido por pedido (6 pedidos = 6 toques antes de poder entregar el primero), escribía SIEMPRE el nombre de quien
// recibe y «Ir a la entrega» lo dejaba en lo alto de toda la lista. Aquí vive la lógica pura de los tres atajos; las
// reglas no cambian: cada pedido sigue confirmándose con el mismo comando y un problema se reporta en SU pedido.

/** Envíos que Almacén ya le entregó al chofer y él todavía no confirma. */
export const cargaPorConfirmar = <T extends { status?: string | null }>(envios: T[]): T[] => envios.filter((s) => s.status === 'despachado')

export interface ResultadoCarga { folio: string; ok: boolean; error?: string | null }

/** Lo que se le dice al chofer después de confirmar varios pedidos: nunca «todo bien» si alguno no quedó. */
export function resumenCarga(rs: ResultadoCarga[]): { ok: boolean; texto: string } {
  if (rs.length === 0) return { ok: true, texto: 'No hay carga por confirmar.' }
  const mal = rs.filter((r) => !r.ok)
  const bien = rs.length - mal.length
  if (mal.length === 0) return { ok: true, texto: `Carga recibida: ${bien} pedido${bien === 1 ? '' : 's'}.` }
  return { ok: false, texto: `Se confirmaron ${bien} de ${rs.length}. No quedó: ${mal.map((m) => m.folio).join(', ')}. ${mal[0].error ?? 'Intenta de nuevo.'}` }
}

/** Confirma toda la carga, pedido por pedido. No se detiene en el primer fallo: cada pedido responde por sí mismo. */
export async function confirmarTodaLaCarga(
  envios: Array<{ id: string; folio: string }>, quien: string,
  confirmar: (id: string, quien: string, folio: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ ok: boolean; texto: string }> {
  const rs: ResultadoCarga[] = []
  for (const e of envios) {
    const r = await confirmar(e.id, quien, e.folio)
    rs.push({ folio: e.folio, ok: r.ok, error: r.ok ? null : r.error })
  }
  return resumenCarga(rs)
}

/** Nombre que el chofer puede TOCAR en vez de escribir. Un nombre genérico no se sugiere: se escribe el real. */
export function nombreSugerido(nombre: string | null | undefined): string | null {
  const n = (nombre ?? '').trim()
  return n.length >= 3 && !/^(cliente|mostrador|p[uú]blico( en)? general)$/i.test(n) ? n : null
}

// Parada a la que el chofer quiere llegar desde Inicio. «Mi ruta» la toma UNA vez al abrir y baja hasta ella.
let paradaPedida: string | null = null
export const pedirParada = (shipmentId: string): void => { paradaPedida = shipmentId }
export const tomarParada = (): string | null => { const p = paradaPedida; paradaPedida = null; return p }
