// TIMBRADO REAL (2 nov 2026) · la pantalla habla con la Edge `cfdi`: vista previa (qué falta y cuánto), timbrar y
// conciliar. Toda respuesta trae su cuerpo (también 409/422/501): el operador siempre sabe por qué.
import { supabase } from '../../lib/supabase'

export interface RespuestaCfdi {
  status?: string; listo?: boolean; configurado?: boolean; entorno?: 'sandbox' | 'produccion' | null
  faltantes?: string[]; requiere_forma_tarjeta?: boolean; message?: string; error?: string
  resumen?: { conceptos: number; subtotal: number; iva: number; total: number; forma_pago: string } | null
  uuid?: string | null; serie?: string; folio?: string; correo_enviado?: boolean
}
async function llamar(body: Record<string, unknown>): Promise<RespuestaCfdi> {
  const { data, error } = await supabase.functions.invoke('cfdi', { body })
  if (!error) return data as RespuestaCfdi
  const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null) as RespuestaCfdi | null
  return cuerpo ?? { error: 'red', message: 'No se pudo contactar al servidor de facturación. No vuelvas a timbrar: revisa el estado en un momento.' }
}
export const cfdiTimbrado = {
  preparar: (doc: string, forma?: string | null) => llamar({ accion: 'preparar', doc_id: doc, forma_pago: forma ?? null }),
  timbrar: (doc: string, forma?: string | null) => llamar({ accion: 'timbrar', doc_id: doc, forma_pago: forma ?? null }),
  conciliar: (doc: string, forma?: string | null) => llamar({ accion: 'conciliar', doc_id: doc, forma_pago: forma ?? null }),
}
export type ClienteCfdiTimbrado = typeof cfdiTimbrado
export const FORMAS_TARJETA = [{ v: '04', t: 'Tarjeta de crédito (04)' }, { v: '28', t: 'Tarjeta de débito (28)' }] as const
