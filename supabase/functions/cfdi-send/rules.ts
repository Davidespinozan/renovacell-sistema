// Reglas PURAS de envío de CFDI por email (sin Deno/red) — compartidas por la Edge Function
// `cfdi-send` y por sus tests (vitest). No dependen del entorno (igual que cfdi/rules.ts).

export interface SendMeta {
  status?: string
  uuid?: string
  facturama_id?: string | null
  simulated?: boolean
}

// GATE de envío: solo un CFDI TIMBRADO real (status 'timbrada' + uuid + facturama_id, NO
// simulado) puede enviarse. El facturama_id se toma SIEMPRE de aquí (BD), nunca del cliente.
export function puedeEnviar(
  invoiceMeta: unknown,
):
  | { ok: true; facturamaId: string; uuid: string }
  | { ok: false; error: string; message: string } {
  const m = (invoiceMeta ?? {}) as SendMeta
  if (m.simulated === true) {
    return { ok: false, error: 'not_stamped', message: 'El CFDI es simulado (demo): no hay documento fiscal para enviar.' }
  }
  if (m.status !== 'timbrada' || typeof m.uuid !== 'string' || m.uuid.length === 0) {
    return { ok: false, error: 'not_stamped', message: 'El pedido no tiene un CFDI timbrado para enviar.' }
  }
  if (typeof m.facturama_id !== 'string' || m.facturama_id.length === 0) {
    return { ok: false, error: 'not_stamped', message: 'El CFDI no tiene identificador de Facturama.' }
  }
  return { ok: true, facturamaId: m.facturama_id, uuid: m.uuid }
}

// Normaliza + valida un email de forma estricta pero sencilla (server-side; el cliente valida igual).
export function normalizaEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

// Regex conservador: un `@`, dominio con al menos un punto, sin espacios. Suficiente para
// bloquear entradas obviamente inválidas antes de llamar a Facturama.
export function emailValido(email: string): boolean {
  if (!email || email.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ¿Éxito real del envío de Facturama? Solo HTTP 2xx Y success===true. Cualquier otra cosa = fallo.
export function envioExitoso(httpStatus: number, body: unknown): boolean {
  const b = (body ?? {}) as { success?: unknown }
  return httpStatus >= 200 && httpStatus < 300 && b.success === true
}

// Auditoría BEST-EFFORT: registra sin poder alterar el resultado del envío. Tolera AMBOS casos
// de fallo — que el RPC devuelva `{ error }` y que lance/rechace excepción. NUNCA lanza. Un
// fallo de auditoría no debe convertir un envío ya realizado en un error para el frontend (evita
// reintentos que dupliquen el CFDI). No registra email/payload fiscal/credenciales, solo un aviso.
export async function auditarSeguro(
  rpc: () => Promise<{ error?: unknown } | null | undefined>,
): Promise<boolean> {
  try {
    const res = await rpc()
    if (res && (res as { error?: unknown }).error) {
      console.warn('[cfdi-send] auditoría no registrada (rpc error)')
      return false
    }
    return true
  } catch {
    console.warn('[cfdi-send] auditoría no registrada (excepción)')
    return false
  }
}
