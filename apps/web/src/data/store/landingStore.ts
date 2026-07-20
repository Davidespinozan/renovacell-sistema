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

// Una diapositiva del hero. `imageMobileUrl` permite una foto distinta en
// teléfono (las horizontales suelen cortarse mal en vertical). Vacía = usa la de
// escritorio.
export interface HeroSlide {
  eyebrow: string
  title: string        // admite HTML (p. ej. <span class="green">)
  subtitle: string
  imageUrl: string
  imageMobileUrl: string
}

export interface Paso { titulo: string; texto: string }

// El modelo sigue las SECCIONES REALES de la landing, en el mismo orden en que
// se ven. Antes describía una página anterior (info/certifications/features/
// lead) que el rediseño dejó atrás: el editor mostraba campos que ya no
// correspondían a nada y por eso nadie notó que no estaban conectados.
export interface LandingContent {
  announcement: Announcement
  seo: { title: string; description: string }
  brand: { name: string; tagline: string; logoUrl: string }
  nav: { ciencia: string; cumplimiento: string; catalogo: string; acceso: string; cta: string }
  // `slides`: si trae más de una, el hero rota. `autoplayMs`: 0 = no rota solo.
  hero: {
    eyebrow: string; title: string; subtitle: string
    ctaPrimary: string; ctaSecondary: string
    imageUrl: string; imageMobileUrl: string
    slides: HeroSlide[]
    autoplayMs: number
  }
  ticker: string[]
  ciencia: { kicker: string; meta: string }
  cumplimiento: { kicker: string }
  catalogo: { kicker: string; title: string; body: string }
  recursos: { kicker: string; meta: string; display: string; title: string }
  acceso: { kicker: string; title: string; body: string; pasos: Paso[]; cta: string; nota: string }
  cierre: { display: string; title: string; body: string; btnPrimary: string; btnSecondary: string }
  verificacion: { kicker: string; title: string; body: string; boton: string }
  contacto: { whatsapp: string; email: string }
  footer: { text: string }
}


// Valores por DEFECTO: son exactamente los textos que hoy tiene la landing.
// Se extrajeron de index.html, no se escribieron a mano, para que la primera vez
// que Administración guarde no cambie nada sin querer.
const DEFAULT: LandingContent = {
  announcement: {
    enabled: false,
    text: 'Envío sin costo en pedidos mayores a $5,000 · Solo para médicos verificados',
    link: '', startsAt: '', endsAt: '',
  },
  seo: { title: 'Renovacell® — Tecnologías Antiedad | Medical Grade desde 2008', description: 'Renovacell. Tecnología S2RM® para profesionales de la salud. Certificación CE, registro COFEPRIS. Desde 2008, México y la Unión Europea.' },
  brand: { name: 'RENOVACELL<sup>®</sup>', tagline: 'Tecnologías Antiedad', logoUrl: '' },
  nav: {
    ciencia: 'Ciencia', cumplimiento: 'Cumplimiento',
    catalogo: 'Catálogo', acceso: 'El acceso', cta: 'Iniciar sesión',
  },
  hero: {
    eyebrow: 'Tecnología celular S²RM® · Grado europeo · Desde 2008',
    title: 'La regeneración celular<br> <span class="green">que respalda tu práctica.</span>',
    subtitle: 'El arsenal regenerativo y estético más completo de México: péptidos y ultrafiltrados celulares, toxinas, rellenos, metabólicos y más — con tecnología S²RM®, certificación CE y registro COFEPRIS. Disponible para médicos verificados.',
    ctaPrimary: 'Ver el catálogo', ctaSecondary: 'Solicitar acceso',
    imageUrl: '', imageMobileUrl: '',
    // Una sola diapositiva = el hero de siempre (no rota). Al agregar más desde
    // Administración, el hero se convierte en carrusel automáticamente.
    slides: [], autoplayMs: 7000,
  },
  ticker: ['S2RM® Technology', 'Systemic Stem Cell Released Molecules', 'CE · Certificación EU', 'COFEPRIS · Registro Sanitario', 'ISO 13485 · Calidad médica'],
  ciencia: { kicker: 'La ciencia', meta: '01 / 05 · Tecnología propietaria registrada' },
  cumplimiento: { kicker: 'Cumplimiento regulatorio' },
  catalogo: { kicker: 'El catálogo', title: 'Todo el arsenal regenerativo y estético, en un solo lugar.', body: 'Péptidos y ultrafiltrados celulares, toxinas, rellenos e hilos, vitaminas intravenosas, metabólicos de última generación, aparatología y más. Cada producto trae su ficha técnica — toca cualquiera para verla. Es solo informativa: la disponibilidad y los precios viven dentro del portal, reservados a médicos verificados.' },
  recursos: {
    kicker: 'Recursos clínicos', meta: '05 / 05 · Acceso libre profesionales',
    display: 'Recursos clínicos', title: 'Protocolos y bibliografía <span class="green">científica</span>',
  },
  acceso: {
    kicker: 'El acceso', title: 'Ya conoces el arsenal. <span class="green">Así entras.</span>', body: 'Renovacell vende solo a profesionales de la salud. No es una tienda abierta: el catálogo y los precios se activan cuando tu cédula queda avalada — así protegemos el estándar y a los pacientes de quienes lo aplican. La verificación es rápida; el acceso, permanente.',
    pasos: [
      { titulo: 'Solicitas acceso', texto: 'Dejas tu cédula profesional y tus datos. Treinta segundos, sin compromiso.' },
      { titulo: 'La IA te avala', texto: 'Verificamos tu cédula contra el registro oficial (SEP) en minutos, no en días. Sin llamadas ni esperas.' },
      { titulo: 'Entras al círculo', texto: 'Catálogo completo, precios profesionales y tu asesor. Compras cuando quieras, ya como parte de Renovacell.' },
    ],
    cta: 'Solicitar acceso médico', nota: 'La verificación es la puerta, no el obstáculo. <b>Pertenecer es el privilegio.</b>',
  },
  cierre: {
    display: 'Red profesional', title: 'No solicitas un producto.<br>Solicitas pertenecer.', body: 'El acceso al estándar regenerativo europeo se gana con tu cédula. La IA la verifica en minutos.',
    btnPrimary: 'Solicitar acceso médico', btnSecondary: 'Contactar al equipo clínico',
  },
  verificacion: {
    kicker: 'Acceso profesional', title: 'Verifícate y <span class="green">entra</span>.',
    body: 'Validamos tu cédula contra el registro oficial. Si eres profesional de la salud, tu acceso es inmediato — aquí mismo, sin salir de esta página.', boton: 'Verificar mi cédula',
  },
  contacto: { whatsapp: '526675310910', email: 'facturacion@goldenplacenta.com' },
  footer: { text: '© 2026 Renovacell® · Todos los derechos reservados' },
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
