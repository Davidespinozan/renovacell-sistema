// INVITA-1 · Lógica PURA del envío masivo de invitaciones (sin Deno ni supabase, probada desde vitest).
// La base decide a quién, cuándo y cuántos (_invm_reclamar); aquí se arma el mensaje de WhatsApp y se traduce el
// resultado del proveedor a lo que la base asienta: enviado | incierto | fallido (culpa del destinatario) |
// retener (culpa del canal: la campaña se pausa y el cliente vuelve a la cola, la lista nunca se quema).
import { nombreBonito } from './plantillas.ts'
import type { ResultadoEnvio as ResultadoMeta } from './salidaClase.ts'
import type { ResultadoEnvio as ResultadoCorreo } from './correo.ts'

export type Asiento = { resultado: 'enviado'; id: string } | { resultado: 'incierto' | 'fallido' | 'retener'; error: string }

/** Plantilla de WhatsApp aprobada por Meta. Cuerpo con dos variables: {{1}} nombre, {{2}} enlace personal. */
export function cuerpoPlantillaInvitacion(tel10: string, plantilla: string, idioma: string, nombre: string, enlace: string): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: `52${tel10}`, type: 'template',
    template: {
      name: plantilla, language: { code: idioma },
      components: [{ type: 'body', parameters: [{ type: 'text', text: (nombreBonito(nombre) || 'doctor(a)').slice(0, 60) }, { type: 'text', text: enlace }] }],
    },
  }
}

// Errores del CANAL, no del cliente: la plantilla no existe / no está aprobada / pausada / parámetros, token o cuenta.
const CANAL_META = new Set([0, 3, 10, 190, 200, 131031, 131042, 131045, 131047, 131051, 131053, 133010, 135000])
const codigoMeta = (detalle: string): number | null => { const m = /Meta \d+ \((\d+)/.exec(detalle); return m ? Number(m[1]) : null }

export function asientoWhatsApp(r: ResultadoMeta): Asiento {
  if (r.ok) return { resultado: 'enviado', id: r.id }
  if (r.clase === 'incierto') return { resultado: 'incierto', error: r.detalle }
  if (r.clase === 'reintentable') return { resultado: 'retener', error: `Meta limitó los envíos; reanuda más tarde. ${r.detalle}` }
  const c = codigoMeta(r.detalle)
  if (c !== null && (CANAL_META.has(c) || (c >= 132000 && c < 133000))) return { resultado: 'retener', error: r.detalle }
  return { resultado: 'fallido', error: r.detalle }   // p. ej. 131026: ese número no tiene WhatsApp
}

/** Correo: un rechazo por credencial o dominio es del canal (retener); uno por la dirección es del cliente (fallido). */
export function asientoCorreo(r: ResultadoCorreo): Asiento {
  if (r.resultado === 'enviado') return r
  // 429: el proveedor lo rechazó por cupo (plan diario o tasa): no salió; la campaña se pausa y el cliente vuelve a la cola
  if (r.resultado === 'incierto' && /proveedor 429\b/.test(r.error)) return { resultado: 'retener', error: `El servicio de correo llegó a su límite; reanuda más tarde o baja el envío por día. ${r.error}` }
  if (r.resultado === 'incierto') return r
  if (/rechazado (401|403)\b|domain|api key|not verified/i.test(r.error)) return { resultado: 'retener', error: `El servicio de correo rechazó el envío: ${r.error}` }
  return r
}
