// Subida de imágenes. Con backend sube al bucket `media` de Supabase Storage y
// devuelve la URL pública (así NO se inflan las columnas con data-URI). Sin backend
// —o si la subida falla— cae a data-URI para no romper el flujo. Las pantallas solo
// llaman a uploadImage() y guardan la URL resultante donde antes ponían el data-URI.
import { hasSupabase, supabase } from './supabase'

const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? `f-${Math.random().toString(16).slice(2)}`)

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

// folder agrupa por uso: 'library' | 'design' | 'avatars' | 'catalog'…
// Bucket PÚBLICO `media` (contenido no sensible: avatares, biblioteca, catálogo).
export async function uploadImage(file: File, folder = 'misc'): Promise<string> {
  if (!hasSupabase) return toDataUrl(file)
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${folder}/${uuid()}.${ext}`
  const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
  if (error) { console.warn('[storage] upload', error.message); return toDataUrl(file) }
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl
}

// Sube EVIDENCIA sensible (prueba de entrega) al bucket PRIVADO `proofs`. Devuelve
// la RUTA (no una URL pública); para verla se genera una URL firmada temporal.
export async function uploadPrivate(file: File, folder = 'proofs', limiteMs = 30_000): Promise<string | null> {
  if (!hasSupabase) return toDataUrl(file)
  // AUDITORÍA CHOFER (19 nov 2026) · la foto del celular (3–12 MB) se reduce antes de subir y la subida tiene tope de
  // tiempo: con mala señal ya no se queda «Subiendo foto…» para siempre (falla, y aparece «Entregar sin foto»).
  const f = await comprimirImagen(file)
  const ext = f.type === 'image/jpeg' ? 'jpg' : (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${folder}/${uuid()}.${ext}`
  const subida = supabase.storage.from('proofs').upload(path, f, { contentType: f.type || 'image/jpeg', upsert: false })
  const tope = new Promise<{ error: { message: string } }>((r) => setTimeout(() => r({ error: { message: 'tiempo agotado' } }), limiteMs))
  const { error } = await Promise.race([subida, tope])
  if (error) { console.warn('[storage] upload privado', error.message); return null }
  return path
}

/** Reduce una foto a ~1280 px en JPEG 0.7 (200–400 KB). Si no se puede (formato raro, sin canvas), devuelve la original. */
export function comprimirImagen(file: File, max = 1280, calidad = 0.7): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || typeof document === 'undefined') return Promise.resolve(file)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file); const img = new Image()
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url)
      c.toBlob((b) => resolve(b ? new File([b], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', calidad)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// Genera una URL FIRMADA temporal para ver una evidencia privada (para el visor de
// pruebas de entrega / recall). Si es data-URI o URL pública (legacy), la devuelve tal cual.
export async function signedProofUrl(path: string | null, secs = 3600): Promise<string | null> {
  if (!path) return null
  if (path.startsWith('data:') || path.startsWith('http')) return path
  if (!hasSupabase) return null
  const { data, error } = await supabase.storage.from('proofs').createSignedUrl(path, secs)
  if (error) { console.warn('[storage] firmar', error.message); return null }
  return data?.signedUrl ?? null
}
