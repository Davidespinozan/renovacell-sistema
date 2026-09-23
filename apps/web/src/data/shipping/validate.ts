// ============================================================================
// Validación logística NEUTRAL. Devuelve la lista EXACTA de datos faltantes para
// cotizar/crear un envío. Regla dura: si falta algo obligatorio → se BLOQUEA y se
// dice qué falta. NUNCA se inventan valores por defecto. La misma validación la
// re-aplica el servidor (Edge Function) como autoridad; esto es para la UX.
// ============================================================================
import type { LogisticsPackage, Receiver, ShipperConfig } from './model'

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string => String(v ?? '').trim()

// Paquete: peso y las 3 dimensiones > 0, piezas entero >= 1. Sin defaults silenciosos.
export function validatePackage(p?: Partial<LogisticsPackage> | null): string[] {
  const miss: string[] = []
  const w = num(p?.weightKg); if (w == null || w <= 0) miss.push('peso (kg)')
  const l = num(p?.lengthCm); if (l == null || l <= 0) miss.push('largo (cm)')
  const a = num(p?.widthCm); if (a == null || a <= 0) miss.push('ancho (cm)')
  const h = num(p?.heightCm); if (h == null || h <= 0) miss.push('alto (cm)')
  const pc = num(p?.pieces); if (pc == null || pc < 1 || !Number.isInteger(pc)) miss.push('número de piezas')
  return miss
}

// Destinatario: nombre, calle, CP, ciudad, teléfono (email es opcional para el carrier).
export function validateReceiver(r?: Partial<Receiver> | null): string[] {
  const miss: string[] = []
  if (!str(r?.name)) miss.push('nombre del destinatario')
  const a = r?.address
  if (!str(a?.line1)) miss.push('calle/dirección de entrega')
  if (!str(a?.cp)) miss.push('código postal (CP) de entrega')
  if (!str(a?.city)) miss.push('ciudad de entrega')
  if (!str(a?.phone)) miss.push('teléfono de entrega')
  return miss
}

// Remitente (config de empresa): nombre, dirección, CP, ciudad, país, teléfono, email.
export function validateShipper(s?: Partial<ShipperConfig> | null): string[] {
  const miss: string[] = []
  if (!str(s?.name)) miss.push('remitente: razón social')
  if (!str(s?.addressLine1)) miss.push('remitente: dirección')
  if (!str(s?.cp)) miss.push('remitente: CP')
  if (!str(s?.city)) miss.push('remitente: ciudad')
  if (!str(s?.country)) miss.push('remitente: país')
  if (!str(s?.phone)) miss.push('remitente: teléfono')
  if (!str(s?.email)) miss.push('remitente: email')
  return miss
}

// Todo lo faltante para crear/cotizar un envío, etiquetado por sección.
export function missingForShipment(input: {
  shipper?: Partial<ShipperConfig> | null
  receiver?: Partial<Receiver> | null
  pkg?: Partial<LogisticsPackage> | null
}): string[] {
  return [
    ...validateShipper(input.shipper),
    ...validateReceiver(input.receiver),
    ...validatePackage(input.pkg),
  ]
}
