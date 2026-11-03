// EQUIPO-ADJUNTOS (mig 20270323) · imágenes, videos y documentos en el Chat del equipo. El archivo vive en el bucket
// PRIVADO `equipo` en <conversación>/<quien sube>/<archivo>; la base decide quién lo ve (los de la conversación) y el
// mensaje solo puede adjuntar un archivo propio de esa conversación. Aquí: qué se acepta, la ruta y el enlace firmado.
import { supabase } from '../../lib/supabase'
import type { Adjunto } from '../types'

export const BUCKET_EQUIPO = 'equipo'
export const MAX_ADJUNTO = 50 * 1024 * 1024   // igual que el bucket

const IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
const VIDEO = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp']
const DOCUMENTO = ['application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
// Algunos teléfonos y navegadores no dicen el tipo (HEIC de iPhone, .csv en Windows): se deduce por la extensión.
const POR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', doc: 'application/msword', docx: DOCUMENTO[4], xls: 'application/vnd.ms-excel', xlsx: DOCUMENTO[6],
  ppt: 'application/vnd.ms-powerpoint', pptx: DOCUMENTO[8],
}
/** Lo que el selector de archivos ofrece (en el teléfono abre fotos, videos y archivos). */
export const ACEPTA = ['image/*', 'video/*', ...Object.keys(POR_EXTENSION).map((e) => `.${e}`)].join(',')

export function tipoDe(nombre: string, tipo: string): string {
  const t = (tipo || '').toLowerCase()
  if ([...IMAGEN, ...VIDEO, ...DOCUMENTO].includes(t)) return t
  return POR_EXTENSION[nombre.split('.').pop()?.toLowerCase() ?? ''] ?? t
}
export function claseDe(tipo: string): Adjunto['clase'] | null {
  return IMAGEN.includes(tipo) ? 'imagen' : VIDEO.includes(tipo) ? 'video' : DOCUMENTO.includes(tipo) ? 'documento' : null
}

/** null = se puede mandar; si no, por qué no (en palabras de quien lo usa). */
export function problemaArchivo(f: { name: string; type: string; size: number }): string | null {
  if (f.size <= 0) return 'El archivo está vacío.'
  if (f.size > MAX_ADJUNTO) return `«${f.name}» pesa ${pesoLegible(f.size)}; el máximo es 50 MB. Para un video largo, mándalo recortado o como enlace.`
  if (!claseDe(tipoDe(f.name, f.type))) return `«${f.name}» no es una imagen, un video ni un documento (PDF, Word, Excel, PowerPoint, texto).`
  return null
}

/** Ruta en el bucket: <conversación>/<quien sube>/<id>-<nombre limpio>. */
export function rutaAdjunto(conversationId: string, uid: string, id: string, nombre: string): string {
  const limpio = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'archivo'
  return `${conversationId}/${uid}/${id}-${limpio}`
}

export function pesoLegible(b: number | null | undefined): string {
  if (!b || b <= 0) return ''
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`
  return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** Lo que se ve en la lista de chats y en el aviso cuando el mensaje es solo un archivo. */
export function etiquetaAdjunto(a: Adjunto | null | undefined): string {
  if (!a) return ''
  return a.clase === 'imagen' ? '📷 Imagen' : a.clase === 'video' ? '🎥 Video' : `📄 ${a.nombre}`
}

// Enlaces firmados (1 h) en memoria: cada archivo se firma una vez por sesión, no en cada render.
const firmas = new Map<string, { url: string; vence: number }>()
export async function urlAdjunto(path: string): Promise<string | null> {
  if (path.startsWith('blob:')) return path   // sin backend: vista previa local
  const f = firmas.get(path)
  if (f && f.vence > Date.now() + 60_000) return f.url
  const { data, error } = await supabase.storage.from(BUCKET_EQUIPO).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return null
  firmas.set(path, { url: data.signedUrl, vence: Date.now() + 3600_000 })
  return data.signedUrl
}
