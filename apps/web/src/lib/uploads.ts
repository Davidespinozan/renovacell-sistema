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
export async function uploadPrivate(file: File, folder = 'proofs'): Promise<string | null> {
  if (!hasSupabase) return toDataUrl(file)
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${folder}/${uuid()}.${ext}`
  const { error } = await supabase.storage.from('proofs').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
  if (error) { console.warn('[storage] upload privado', error.message); return null }
  return path
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
