// Contenido editable de la LANDING pública (single source of truth).
// La landing (apps/landing) se DIBUJA desde este modelo (data-driven): todo es
// editable — textos, imágenes, logo, secciones.
//
// PUNTOS DE CONEXIÓN A SUPABASE (sin parches temporales):
//   · LECTURA admin   → getSnapshot()  = select de landing_content.
//   · ESCRITURA admin → saveLanding()  = upsert de landing_content (+ regenera
//                       el content.json que sirve la landing, o la landing lee
//                       la fila vía endpoint).
//   · LECTURA pública → la landing hace fetch del contenido (hoy content.json).
//   · Imágenes/logo   → hoy por URL; con Storage de Supabase será subir archivo.
// La firma de useLanding NO cambia al conectar; solo el cuerpo de estas funciones.
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import type { Json } from '../database.types'

export interface NavLink { label: string; href: string }
export interface Certification { label: string; sub: string }
export interface Feature { title: string; body: string }

// Banda de anuncios de la parte superior (promociones, festejos, avisos).
// `enabled` la enciende; las fechas son OPCIONALES: vacías = sin límite. Así se
// puede programar una promo y que se apague sola, sin depender de nadie.
export interface Announcement {
  enabled: boolean
  text: string
  link: string        // opcional: a dónde lleva al hacer clic
  startsAt: string    // 'AAAA-MM-DD' o '' (sin fecha de inicio)
  endsAt: string      // 'AAAA-MM-DD' o '' (sin fecha de fin)
}

export interface LandingContent {
  announcement: Announcement
  seo: { title: string; description: string }
  brand: { name: string; tagline: string; logoUrl: string }
  nav: { links: NavLink[]; cta: string }
  hero: { eyebrow: string; title: string; subtitle: string; ctaPrimary: string; ctaSecondary: string; imageUrl: string }
  ticker: string[]
  info: { eyebrow: string; title: string; body: string; imageUrl: string }
  certifications: { eyebrow: string; title: string; items: Certification[] }
  features: { eyebrow: string; title: string; items: Feature[] }
  lead: { eyebrow: string; title: string; body: string; submitLabel: string; successText: string }
  contact: { title: string; whatsapp: string; email: string; address: string }
  footer: { text: string }
}

// Valores REALES (mismos que apps/landing/content.json).
const DEFAULT: LandingContent = {
  announcement: {
    enabled: false,
    text: 'Envío sin costo en pedidos mayores a $5,000 · Solo para médicos verificados',
    link: '',
    startsAt: '',
    endsAt: '',
  },
  seo: {
    title: 'Renovacell® — Tecnologías Antiedad | Medical Grade desde 2008',
    description: 'Renovacell. Tecnología S2RM® para profesionales de la salud. Certificación CE, registro COFEPRIS. Desde 2008, México y la Unión Europea.',
  },
  brand: { name: 'Renovacell®', tagline: 'Tecnologías Antiedad', logoUrl: '' },
  nav: {
    links: [
      { label: 'Ciencia', href: '#s2rm' },
      { label: 'Regulatory Compliance', href: '#cumplimiento' },
      { label: 'Catálogo', href: '#catalogo' },
      { label: 'El acceso', href: '#acceso' },
    ],
    cta: 'Acceso médico',
  },
  hero: {
    eyebrow: 'Tecnología celular S²RM® · Grado europeo · Desde 2008',
    title: 'La regeneración celular<br><span class="green">que respalda tu práctica.</span>',
    subtitle: 'El arsenal regenerativo y estético más completo de México: péptidos y ultrafiltrados celulares, toxinas, rellenos, metabólicos y más — con tecnología S²RM®, certificación CE y registro COFEPRIS. Disponible para médicos verificados.',
    ctaPrimary: 'Ver el catálogo',
    ctaSecondary: 'Solicitar acceso',
    imageUrl: '',
  },
  ticker: ['S2RM® Technology', 'Systemic Stem Cell Released Molecules', 'CE · Certificación EU', 'COFEPRIS · Registro Sanitario', 'ISO 13485 · Calidad médica'],
  info: {
    eyebrow: '01 · La ciencia',
    title: 'Tecnología celular S²RM®',
    body: 'Moléculas liberadas por células madre, en líneas exclusivas para uso clínico — tópico, inyectable e implantable. Ingredientes biocompatibles respaldados por evidencia clínica.',
    imageUrl: '',
  },
  certifications: {
    eyebrow: '02 · Cumplimiento regulatorio',
    title: 'Estándares europeo y mexicano',
    items: [
      { label: 'CE', sub: 'Certificación EU' },
      { label: 'COFEPRIS', sub: 'Registro Sanitario' },
      { label: 'ISO 13485', sub: 'Calidad médica' },
    ],
  },
  features: {
    eyebrow: '03 · Para médicos',
    title: 'Acceso exclusivo para profesionales de la salud',
    items: [
      { title: 'Sin venta directa', body: 'El catálogo y los precios solo se muestran a médicos verificados con cédula profesional.' },
      { title: 'Asesoría clínica', body: 'Acompañamiento y fichas técnicas para cada línea de producto.' },
      { title: 'Logística propia', body: 'Surtido por lotes con trazabilidad y entrega a tu clínica.' },
    ],
  },
  lead: {
    eyebrow: 'Acceso médico',
    title: 'Solicita tu acceso',
    body: 'Exclusivo para profesionales de la salud. Verificamos tu cédula antes de habilitar el portal de compra.',
    submitLabel: 'Enviar solicitud',
    successText: '¡Gracias! Recibimos tu solicitud. Te contactaremos para verificar tu cédula y habilitar tu acceso.',
  },
  contact: { title: 'Contacto', whatsapp: '526675310910', email: 'facturacion@goldenplacenta.com', address: 'Culiacán, Sinaloa · México' },
  footer: { text: '© Renovacell® · Tecnologías Antiedad · Operado por STRYV' },
}

const clone = (c: LandingContent): LandingContent => JSON.parse(JSON.stringify(c))

// Fila única id='main'. Con backend hidrata de `landing_content` (lectura
// pública; escritura solo admin por RLS) y saveLanding hace upsert write-through.
// Sin backend, opera sobre DEFAULT en memoria.
const ROW_ID = 'main'
let content: LandingContent = clone(DEFAULT)
const listeners = new Set<() => void>()
let snapshot: LandingContent = content

function emit() { snapshot = content; listeners.forEach((l) => l()) }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): LandingContent => snapshot

async function hydrate() {
  if (!hasSupabase) return
  const { data, error } = await supabase.from('landing_content').select('content').eq('id', ROW_ID).maybeSingle()
  if (error) { console.warn('[landing] hydrate', error.message); return }
  if (data?.content) { content = clone({ ...DEFAULT, ...(data.content as unknown as LandingContent) }); emit() }
}
if (hasSupabase) {
  hydrate()
  supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'TOKEN_REFRESHED') hydrate() })
}

export function saveLanding(next: LandingContent) {
  content = clone(next)
  emit()
  logAudit({ actor: 'Administración', action: 'Landing actualizada', resource: 'Página pública' })
  if (hasSupabase) {
    supabase.from('landing_content').upsert({ id: ROW_ID, content: content as unknown as Json, updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.warn('[landing] save', error.message) })
  }
}

export function resetLanding(): LandingContent {
  content = clone(DEFAULT)
  emit()
  if (hasSupabase) supabase.from('landing_content').upsert({ id: ROW_ID, content: content as unknown as Json, updated_at: new Date().toISOString() }).then(({ error }) => { if (error) console.warn('[landing] reset', error.message) })
  return content
}
