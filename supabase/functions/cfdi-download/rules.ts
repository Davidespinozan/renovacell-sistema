// Reglas PURAS de descarga de CFDI (sin Deno/red) — compartidas por la Edge Function
// `cfdi-download` y por sus tests (vitest). No dependen del entorno para poder probarlas
// fuera de Deno (igual que cfdi/rules.ts).

export type CfdiFormat = 'xml' | 'pdf'

// Valida ESTRICTAMENTE el formato pedido por el cliente. Cualquier otro valor → 422.
export function formatoValido(f: unknown): f is CfdiFormat {
  return f === 'xml' || f === 'pdf'
}

export interface DownloadMeta {
  status?: string
  uuid?: string
  facturama_id?: string | null
  simulated?: boolean
}

// GATE de descarga: solo un CFDI TIMBRADO de verdad (status 'timbrada' + UUID del SAT +
// facturama_id real, NO simulado) es descargable. El facturama_id se toma SIEMPRE de aquí
// (BD), nunca del cliente. Un folio 'emitida' simulado/demo NO es descargable → 409.
export function puedeDescargar(
  invoiceMeta: unknown,
):
  | { ok: true; facturamaId: string; uuid: string }
  | { ok: false; error: string; message: string } {
  const m = (invoiceMeta ?? {}) as DownloadMeta
  if (m.simulated === true) {
    return { ok: false, error: 'not_stamped', message: 'El CFDI es simulado (demo): no hay documento fiscal para descargar.' }
  }
  if (m.status !== 'timbrada' || typeof m.uuid !== 'string' || m.uuid.length === 0) {
    return { ok: false, error: 'not_stamped', message: 'El pedido no tiene un CFDI timbrado descargable.' }
  }
  if (typeof m.facturama_id !== 'string' || m.facturama_id.length === 0) {
    return { ok: false, error: 'not_stamped', message: 'El CFDI no tiene identificador de Facturama.' }
  }
  return { ok: true, facturamaId: m.facturama_id, uuid: m.uuid }
}

// MIME correcto para el Blob del navegador (Facturama devuelve ContentType 'xml'/'pdf', no MIME).
export function mimeDe(format: CfdiFormat): string {
  return format === 'pdf' ? 'application/pdf' : 'application/xml'
}

// Nombre de archivo legible y saneado: <folio>_<uuid>.<ext>. Sin rutas ni caracteres raros.
export function nombreArchivo(ref: string | null | undefined, uuid: string, format: CfdiFormat): string {
  const safeRef = sanitizar(ref || 'CFDI')
  const safeUuid = sanitizar(uuid)
  return `${safeRef}_${safeUuid}.${format}`
}

function sanitizar(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_') // solo letras/números/_/./-
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 80) || 'CFDI'
}
