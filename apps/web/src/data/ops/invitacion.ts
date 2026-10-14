// INVITACIONES · cliente de la Edge `invitacion`: el personal invita a un cliente existente (WhatsApp o correo) y
// el cliente, con el enlace, crea su cuenta ya ligada y verificada. La autoridad es del servidor.
import { hasSupabase, supabase } from '../../lib/supabase'

type Invocar = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: unknown; error: unknown }>

export type EstadoCorreo = 'no_pedido' | 'sin_correo' | 'no_configurado' | 'enviado' | 'fallido' | 'incierto'
export interface InvitacionCreada { enlace: string; expira_at: string; nombre: string; email: string | null; telefono: string | null; correo: EstadoCorreo }
export type Res<T> = { ok: true; data: T } | { ok: false; mensaje: string; codigo?: string; campo?: string }

async function llamar<T>(body: Record<string, unknown>, invocar: Invocar): Promise<Res<T>> {
  if (!hasSupabase && invocar === invocarPorDefecto) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
  try {
    const { data, error } = await invocar('invitacion', { body })
    if (error) {
      try {
        const ctx = (error as { context?: Response }).context
        if (ctx) { const b = (await ctx.json()) as { error?: string; message?: string; campo?: string }; return { ok: false, mensaje: b.message ?? 'No se pudo completar.', codigo: b.error, campo: b.campo } }
      } catch { /* sin detalle */ }
      return { ok: false, mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' }
    }
    return { ok: true, data: data as T }
  } catch { return { ok: false, mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }
}

export const crearInvitacion = (customerId: string, o: { correo?: boolean; email?: string } = {}, invocar: Invocar = invocarPorDefecto) =>
  llamar<InvitacionCreada>({ action: 'crear', customer_id: customerId, correo: o.correo === true, email: o.email ?? null }, invocar)
export const verInvitacion = (token: string, invocar: Invocar = invocarPorDefecto) =>
  llamar<{ estado: string; nombre?: string; email?: string | null; message?: string }>({ action: 'ver', token }, invocar)
export const aceptarInvitacion = (token: string, email: string, password: string, invocar: Invocar = invocarPorDefecto) =>
  llamar<{ ok: true; email: string }>({ action: 'aceptar', token, email, password, consent: true }, invocar)

export const TEXTO_CORREO: Record<EstadoCorreo, string> = {
  no_pedido: '', sin_correo: 'El cliente no tiene correo registrado: mándala por WhatsApp.',
  no_configurado: 'El envío de correos aún no está configurado: mándala por WhatsApp.',
  enviado: 'Invitación enviada por correo.', fallido: 'El proveedor rechazó el correo: revisa la dirección o mándala por WhatsApp.',
  incierto: 'No se pudo confirmar el envío del correo: si no le llega, mándala por WhatsApp.',
}

/** Mensaje listo para WhatsApp. Con teléfono mexicano de 10 dígitos abre el chat de esa persona; si no, eliges a quién. */
export function whatsappInvitacion(nombre: string, enlace: string, telefono: string | null): string {
  const texto = `Hola ${nombre.trim()}, te invito a crear tu cuenta en Renovacell. Como ya eres cliente, queda verificada: verás precios, harás pedidos y hablarás conmigo por ahí. Crea tu contraseña aquí: ${enlace}`
  const d = (telefono ?? '').replace(/\D/g, '')
  const numero = d.length === 10 ? `52${d}` : d.length === 12 && d.startsWith('52') ? d : ''
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}
