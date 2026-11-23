// PAQ-SIMPLE (23 nov 2026) · ESTAFETA, por ahora MANUAL: Almacén genera la guía en el portal de Estafeta y aquí registra el
// número de guía (y, si quiere, el costo y la fecha estimada). El envío queda con provider 'estafeta' (así el rastreo
// automático no la confunde con DHL) y sigue el flujo normal (el pedido pasa a «En camino»).
// SEAM para la API: cuando se integre, `registrarGuiaEstafeta` se reemplaza por una llamada a la Edge `shipping`
// (provider 'estafeta'); la venta (opción foraneo_estafeta) y lo que ve el doctor no cambian.
import { createShipment, type EnvioCreado } from '../store/shipmentsStore'

/** Ids de paquetería foránea que usan venta, Almacén y la base. */
export type PaqueteriaForanea = 'dhl' | 'estafeta'

/** Rastreo público de Estafeta (para mostrar). */
export const urlRastreoEstafeta = (guia: string): string => `https://www.estafeta.com/Herramientas/Rastreo?guias=${encodeURIComponent(guia)}`

/**
 * Valida el número que da Estafeta: el número de guía (22 caracteres, letras y números) o el código de rastreo (10 dígitos).
 * Se aceptan espacios y guiones al capturar; se guarda en mayúsculas y sin separadores.
 */
export function validarGuiaEstafeta(raw: string): { ok: true; guia: string } | { ok: false; error: string } {
  const g = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '')
  if (!g) return { ok: false, error: 'Escribe el número de guía de Estafeta.' }
  if (!/^[A-Z0-9]+$/.test(g)) return { ok: false, error: 'La guía solo lleva letras y números.' }
  if (/^\d{10}$/.test(g) || /^[A-Z0-9]{22}$/.test(g)) return { ok: true, guia: g }
  return { ok: false, error: 'La guía de Estafeta tiene 22 caracteres (o el código de rastreo, 10 dígitos). Revísala.' }
}

/** Costo opcional en pesos: vacío = sin costo; si no, un número de 0 a 99,999. */
export function validarCostoGuia(raw: string): { ok: true; costo: number | null } | { ok: false; error: string } {
  const t = String(raw ?? '').trim().replace(/[$,\s]/g, '')
  if (!t) return { ok: true, costo: null }
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 99_999) return { ok: false, error: 'El costo debe ser un número de 0 a 99,999.' }
  return { ok: true, costo: Math.round(n * 100) / 100 }
}

/** Fecha AAAA-MM-DD a las 18:00 del negocio (UTC-7), como la promesa. */
export function estimadaDeFecha(dia: string | null | undefined): string | null {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null
  const t = new Date(`${dia}T18:00:00-07:00`)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

/** Registra la guía manual de Estafeta como el envío del pedido (lo escribe Almacén; RLS shipments_insert_ops). */
export async function registrarGuiaEstafeta(args: { orderId: string; guia: string; costo: number | null; llegaFecha: string | null; registradoPor: string | null }, crear: typeof createShipment = createShipment): Promise<EnvioCreado> {
  return crear({
    order_id: args.orderId, carrier: 'Estafeta', tracking_number: args.guia, driver_id: null, label_url: null,
    estimated_delivery_at: estimadaDeFecha(args.llegaFecha), status: 'in_transit',
    provider: 'estafeta', provider_cost: args.costo, currency: args.costo != null ? 'MXN' : null,
    provider_meta: { manual: true, registrado_por: args.registradoPor, tracking_url: urlRastreoEstafeta(args.guia) },
  })
}
