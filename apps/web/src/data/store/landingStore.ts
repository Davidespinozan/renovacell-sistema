// Contenido editable de la LANDING pública (single source of truth).
// Sembrado con los valores REALES de apps/landing/index.html. Administración (o
// quien tenga la capability "contenido") lo edita aquí. Hoy es un store mock;
// la página pública consumirá este modelo al conectar el backend (la landing se
// vuelve data-driven: lee este JSON en vez de tener el texto incrustado).
import { logAudit } from './auditStore'

export interface Certification { label: string; sub: string }

export interface LandingContent {
  metaTitle: string
  metaDescription: string
  heroEyebrow: string
  heroTitle: string
  heroSubtitle: string
  ctaPrimary: string
  ctaSecondary: string
  whatsapp: string   // número (wa.me)
  email: string
  certifications: Certification[]
}

// Valores REALES extraídos de la landing actual.
const DEFAULT: LandingContent = {
  metaTitle: 'Renovacell® — Tecnologías Antiedad | Medical Grade desde 2008',
  metaDescription: 'Renovacell. Tecnología S2RM® para profesionales de la salud. Certificación CE, registro COFEPRIS. Desde 2008, México y la Unión Europea.',
  heroEyebrow: 'Desde 2008 · Unión Europea + México',
  heroTitle: 'La nueva generación<br>de <span class="green">medicina regenerativa.</span>',
  heroSubtitle: 'Tecnología celular S²RM®, desarrollada en Europa para los profesionales que definen el estándar.',
  ctaPrimary: 'Acceso médico',
  ctaSecondary: 'Línea cosmética',
  whatsapp: '526675310910',
  email: 'facturacion@goldenplacenta.com',
  certifications: [
    { label: 'CE', sub: 'Certificación EU' },
    { label: 'COFEPRIS', sub: 'Registro Sanitario' },
    { label: 'ISO 13485', sub: 'Calidad médica' },
  ],
}

let content: LandingContent = { ...DEFAULT, certifications: DEFAULT.certifications.map((c) => ({ ...c })) }
const listeners = new Set<() => void>()
let snapshot: LandingContent = content

function emit() {
  snapshot = content
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): LandingContent => snapshot

export function saveLanding(next: LandingContent) {
  content = { ...next, certifications: next.certifications.map((c) => ({ ...c })) }
  emit()
  logAudit({ actor: 'Administración', action: 'Landing actualizada', resource: 'Página pública' })
}

export function resetLanding() {
  content = { ...DEFAULT, certifications: DEFAULT.certifications.map((c) => ({ ...c })) }
  emit()
}
