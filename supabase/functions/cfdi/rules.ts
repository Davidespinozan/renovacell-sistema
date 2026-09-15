// Reglas PURAS del CFDI (sin Deno/red) — compartidas por la Edge Function `cfdi` y por sus
// tests (vitest). No dependen del entorno para poder probarlas fuera de Deno.

export interface StampMeta { status?: string; uuid?: string; facturama_id?: string | null }

// IDEMPOTENCIA (auditoría P0-CFDI #3): si el pedido YA tiene un CFDI TIMBRADO de verdad
// (status 'timbrada' + UUID del SAT), no se debe volver a timbrar. Un folio 'emitida'
// (simulado/demo, sin UUID real) NO bloquea: ese sí puede timbrarse por primera vez.
export function cfdiYaTimbrado(invoiceMeta: unknown): { uuid: string; facturama_id: string | null } | null {
  const m = (invoiceMeta ?? {}) as StampMeta
  if (m.status === 'timbrada' && typeof m.uuid === 'string' && m.uuid.length > 0) {
    return { uuid: m.uuid, facturama_id: m.facturama_id ?? null }
  }
  return null
}

// LUGAR DE EXPEDICIÓN (auditoría P0-CFDI #2): es el CP fiscal del EMISOR (empresa), nunca el
// del receptor. Si falta, falla explícito indicando la configuración pendiente — jamás cae
// al CP del receptor.
export function lugarDeExpedicion(
  company: { cp?: string | null } | null,
): { ok: true; cp: string } | { ok: false; error: string; message: string } {
  const cp = (company?.cp ?? '').trim()
  if (!cp) {
    return { ok: false, error: 'missing_emisor', message: 'Falta el Código Postal fiscal del EMISOR. Captúralo en Configuración de la empresa antes de timbrar.' }
  }
  return { ok: true, cp }
}
