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

// ── Receptor fiscal canónico ────────────────────────────────────────────────────────────────
// Reglas PRESERVADAS de la resolución del receptor (snapshot → maestro del cliente → perfil
// legacy). Viven aquí, puras y probadas, porque W3-A CONTIENE el camino de timbrado y W3-B
// las volverá a usar contra la intención durable. Nunca inventan valores: lo ausente queda
// vacío y luego se rechaza de forma explícita.

export interface ReceptorFiscal {
  rfc: string
  razon_social: string
  regimen: string
  cp: string
  uso_cfdi: string
  email_facturacion: string
}

// Normaliza el snapshot/customer (forma nueva) o el perfil legacy (name/taxRegime/taxZip/cfdiUse).
export function normFiscal(raw: unknown): ReceptorFiscal {
  const r = (raw ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return {
    rfc: s(r.rfc).toUpperCase(),
    razon_social: s(r.razon_social) || s(r.name),
    regimen: s(r.regimen) || s(r.taxRegime),
    cp: s(r.cp) || s(r.taxZip),
    uso_cfdi: s(r.uso_cfdi) || s(r.cfdiUse),
    email_facturacion: (s(r.email_facturacion) || s(r.email)).toLowerCase(),
  }
}

// Campos faltantes (para un rechazo explícito). Sin defaults 616/G03/nombre-visible.
export function fiscalFaltantes(f: ReceptorFiscal): string[] {
  const req: [keyof ReceptorFiscal, string][] = [
    ['rfc', 'RFC'], ['razon_social', 'razón social'], ['regimen', 'régimen'],
    ['cp', 'CP fiscal'], ['uso_cfdi', 'uso CFDI'], ['email_facturacion', 'correo de facturación'],
  ]
  return req.filter(([k]) => !f[k]).map(([, label]) => label)
}

// GATE DE PAGO (autoridad server-side, heredado de W2): no se timbra un pedido que no está
// pagado. Se conserva como regla pura y probada para que W3-B la aplique sobre la intención
// durable, en vez de que viva suelta dentro de una función que ya no debe timbrar.
export function puedeTimbrar(order: { payment_status?: string | null } | null):
  { ok: true } | { ok: false; error: string; message: string } {
  if ((order?.payment_status ?? '') !== 'paid') {
    return { ok: false, error: 'unpaid', message: 'El pedido debe estar pagado antes de facturarse.' }
  }
  return { ok: true }
}
