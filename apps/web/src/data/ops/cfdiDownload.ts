// Descarga bajo demanda de XML/PDF de un CFDI timbrado. El cliente NUNCA habla con Facturama
// ni ve sus credenciales: invoca la Edge Function `cfdi-download` (que las tiene server-side),
// recibe base64 y lo convierte a Blob para disparar la descarga en el navegador.
import { supabase } from '../../lib/supabase'
import { notify } from '../store/notificationsStore'

export type CfdiFormat = 'xml' | 'pdf'

// base64 → ArrayBuffer (seguro en navegador; sin Buffer). ArrayBuffer es un BlobPart válido.
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const buf = new ArrayBuffer(bin.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return buf
}

function saneaNombre(name: string | undefined, format: CfdiFormat): string {
  const fallback = `cfdi.${format}`
  if (!name) return fallback
  const clean = name.replace(/[/\\]+/g, '_').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '')
  return clean || fallback
}

// Devuelve true si la descarga se disparó; false si hubo error (ya notificado).
export async function downloadCfdi(orderId: string, format: CfdiFormat): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('cfdi-download', { body: { order_id: orderId, format } })
  if (error || !data?.base64) {
    let reason = ''
    try {
      const b = await (error as { context?: { json?: () => Promise<{ message?: string; error?: string }> } })?.context?.json?.()
      reason = b?.message ?? b?.error ?? ''
    } catch { /* noop */ }
    notify({ text: `CFDI · ${reason || 'no se pudo descargar el documento'}`, roles: ['admin'], screen: 'av_fin' })
    console.warn('[cfdi-download]', (error as { message?: string })?.message, reason)
    return false
  }
  const buf = base64ToArrayBuffer(data.base64 as string)
  const blob = new Blob([buf], { type: (data.contentType as string) || 'application/octet-stream' })
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = saneaNombre(data.filename as string | undefined, format)
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
  return true
}
