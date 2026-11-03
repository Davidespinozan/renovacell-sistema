// COTIZAR EL ENVÍO AL VENDER (2 nov 2026) — puro, probado con vitest. Paquete estimado por piezas (antes de empacar no hay
// medidas reales) y servicios ordenados del más barato al más caro, con la diferencia que pagaría el cliente por cada uno
// (al peso entero, hacia arriba, igual que la base).
export interface ConfigPaquete { paquete_kg_base?: number | null; paquete_kg_pieza?: number | null; paquete_largo_cm?: number | null; paquete_ancho_cm?: number | null; paquete_alto_cm?: number | null }
export interface ServicioCotizado { codigo: string; nombre: string; costo: number; diferencia: number; llega_at?: string; llega_fecha: string }

export function paqueteEstimado(piezas: number, c: ConfigPaquete) {
  const kg = Math.round((Number(c.paquete_kg_base ?? 1) + Math.max(0, piezas) * Number(c.paquete_kg_pieza ?? 0.3)) * 100) / 100
  return { weightKg: Math.max(0.5, kg), lengthCm: Number(c.paquete_largo_cm ?? 30), widthCm: Number(c.paquete_ancho_cm ?? 25), heightCm: Number(c.paquete_alto_cm ?? 20), pieces: 1 }
}

/** De las tarifas de la paquetería a lo que ve el cliente: código, nombre, fecha exacta y diferencia vs el más barato. */
export function serviciosCotizados(tarifas: Array<{ serviceCode?: string; service: string; amount: number; etaDays: number; entregaAt?: string }>, ahoraMs = Date.now()): ServicioCotizado[] {
  const validas = tarifas.filter((x) => x.serviceCode && x.amount > 0)
  if (!validas.length) return []
  const min = Math.min(...validas.map((x) => x.amount))
  return validas.map((x) => {
    const fecha = x.entregaAt?.slice(0, 10) ?? new Date(ahoraMs + x.etaDays * 86_400_000 - 7 * 3_600_000).toISOString().slice(0, 10)
    return { codigo: String(x.serviceCode), nombre: x.service, costo: x.amount, diferencia: Math.max(0, Math.ceil(x.amount - min - 1e-9)), ...(x.entregaAt ? { llega_at: x.entregaAt } : {}), llega_fecha: fecha }
  }).sort((a, b) => a.costo - b.costo)
}
