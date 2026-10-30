// ENLACE-VENDEDOR · vista previa del enlace del chat (renovacell.mx/contacto/<código>). Lo que WhatsApp, Facebook o un
// SMS muestran al pegar el enlace es lo primero que ve quien lo recibe: debe decir quién lo recomienda y con qué asesor va
// a hablar, no un genérico "Chatea con un asesor". Los buscadores y apps de mensajería no corren JavaScript, así que el
// título y la descripción se ponen aquí, en el servidor, antes de entregar la página.
//
// Solo lee lo público del enlace (Edge `visitor`, acción ver_enlace: nombre del asesor y primer nombre de quien
// recomienda). Si algo falla o tarda, se entrega la página tal cual (la vista genérica): nunca bloquea el chat.
import type { Context } from 'https://edge.netlify.com'

const CODIGO = /^\/contacto\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Publico { valido?: boolean; asesor?: { nombre?: string; primer_nombre?: string | null } | null; recomienda?: string | null }

async function leer(codigo: string): Promise<Publico | null> {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Netlify?.env
  const url = env?.get('VITE_SUPABASE_URL'); const anon = env?.get('VITE_SUPABASE_ANON_KEY')
  if (!url || !anon) return null
  try {
    const r = await fetch(`${url}/functions/v1/visitor`, {
      method: 'POST', signal: AbortSignal.timeout(1500),
      headers: { 'content-type': 'application/json', apikey: anon, authorization: `Bearer ${anon}` },
      body: JSON.stringify({ action: 'ver_enlace', codigo }),
    })
    return r.ok ? await r.json() as Publico : null
  } catch { return null }
}

export function textosVista(p: Publico): { titulo: string; descripcion: string } | null {
  if (!p.valido) return null
  const asesor = p.asesor?.primer_nombre || p.asesor?.nombre || null
  const titulo = p.recomienda ? `${p.recomienda} te recomienda Renovacell` : asesor ? `Chatea con ${p.asesor?.nombre ?? asesor} · Renovacell` : 'Renovacell · Tecnologías Antiedad'
  const descripcion = asesor
    ? `${asesor}, asesor de Renovacell · Tecnologías Antiedad, te atiende directo por aquí. Sin descargar nada.`
    : 'Te atendemos directo por aquí. Sin descargar nada.'
  return { titulo, descripcion }
}

export default async (request: Request, context: Context): Promise<Response | void> => {
  const m = CODIGO.exec(new URL(request.url).pathname)
  if (!m) return
  const codigo = m[1].toLowerCase()
  const [res, pub] = await Promise.all([context.next(), leer(codigo)])
  const t = pub && textosVista(pub)
  if (!t || !(res.headers.get('content-type') ?? '').includes('text/html')) return res
  const canonica = `https://renovacell.mx/contacto/${codigo}`
  const html = (await res.text())
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(t.titulo)}</title>`)
    .replace(/(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*"/g, `$1${esc(t.titulo)}"`)
    .replace(/(<meta (?:name="description"|property="og:description"|name="twitter:description") content=")[^"]*"/g, `$1${esc(t.descripcion)}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${canonica}"`)
    .replace(/(<link rel="canonical" href=")[^"]*"/, `$1${canonica}"`)
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.set('cache-control', 'public, max-age=0, must-revalidate')
  return new Response(html, { status: res.status, headers })
}

export const config = { path: '/contacto/*' }
