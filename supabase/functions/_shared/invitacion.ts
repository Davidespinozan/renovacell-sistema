// INVITACIONES · Lógica PURA de la invitación de clientes existentes (sin Deno ni supabase, probada desde vitest).
// La autoridad está en la base (cliente_invitacion_*): aquí se arma el enlace, se acota la entrada, se traducen
// los errores y se compone el correo.

export const URL_SISTEMA = 'https://sistema.renovacell.mx'

/** El enlace lleva el secreto en el FRAGMENTO (#): el navegador no lo manda a ningún servidor ni queda en bitácoras. */
export function enlaceInvitacion(token: string, base: string = URL_SISTEMA): string {
  return `${base.replace(/\/+$/, '')}/invitacion#${token}`
}

export type CampoAceptar = 'email' | 'password' | 'consentimiento'
export function validarAceptacion(entrada: unknown): { ok: true; email: string; password: string } | { ok: false; campo: CampoAceptar; mensaje: string } {
  const o = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>
  const email = (typeof o.email === 'string' ? o.email : '').trim().toLowerCase().slice(0, 160)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, campo: 'email', mensaje: 'El correo no parece válido.' }
  const password = typeof o.password === 'string' ? o.password : ''
  if (password.length < 8 || password.length > 72) return { ok: false, campo: 'password', mensaje: 'La contraseña debe tener entre 8 y 72 caracteres.' }
  if (o.consent !== true) return { ok: false, campo: 'consentimiento', mensaje: 'Para continuar, acepta el Aviso de privacidad.' }
  return { ok: true, email, password }
}

export const MENSAJE_ESTADO: Record<string, string> = {
  usada: 'Esta invitación ya se usó. Inicia sesión con tu correo y contraseña.',
  expirada: 'Esta invitación venció. Pide a tu asesor que te mande una nueva.',
  revocada: 'Esta invitación ya no es válida. Pide a tu asesor el enlace más reciente.',
  inexistente: 'No encontramos esta invitación. Revisa que el enlace esté completo.',
}

export function mapearErrorInvitacion(mensaje: string | undefined): { status: number; body: { error: string; message: string } } {
  const m = mensaje ?? ''
  const r = (status: number, error: string, message: string) => ({ status, body: { error, message } })
  if (/INVITACION_USADA/.test(m)) return r(409, 'usada', MENSAJE_ESTADO.usada)
  if (/INVITACION_EXPIRADA/.test(m)) return r(410, 'expirada', MENSAJE_ESTADO.expirada)
  if (/INVITACION_REVOCADA/.test(m)) return r(410, 'revocada', MENSAJE_ESTADO.revocada)
  if (/INVITACION_INVALIDA/.test(m)) return r(404, 'inexistente', MENSAJE_ESTADO.inexistente)
  if (/YA_TIENE_CUENTA/.test(m)) return r(409, 'ya_tiene_cuenta', 'Este cliente ya tiene cuenta en el portal.')
  if (/CLIENTE_INACTIVO/.test(m)) return r(409, 'cliente_inactivo', 'Este cliente está dado de baja: reactívalo antes de invitarlo.')
  if (/NO_AUTORIZADO|permission denied/.test(m)) return r(403, 'no_autorizado', 'Solo Dirección o el vendedor del cliente pueden invitarlo.')
  return r(503, 'no_disponible', 'No se pudo completar. Intenta más tarde.')
}

/** Correo de invitación: texto claro, sin datos sensibles más allá del nombre y el enlace. */
export function correoInvitacion(nombre: string, enlace: string): { asunto: string; texto: string; html: string } {
  const n = nombre.trim() || 'Hola'
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const texto = `${n}:\n\nTe invitamos a crear tu cuenta en Renovacell. Como ya eres cliente, tu cuenta queda verificada: podrás ver precios, hacer pedidos y hablar con tu asesor.\n\nCrea tu contraseña aquí (el enlace vence en 14 días):\n${enlace}\n\nRenovacell · Tecnologías Antiedad`
  const html = `<p>${esc(n)}:</p><p>Te invitamos a crear tu cuenta en <b>Renovacell</b>. Como ya eres cliente, tu cuenta queda verificada: podrás ver precios, hacer pedidos y hablar con tu asesor.</p><p><a href="${esc(enlace)}" style="display:inline-block;padding:12px 20px;background:#007311;color:#fff;border-radius:24px;text-decoration:none;font-weight:600">Crear mi cuenta</a></p><p style="color:#667;font-size:13px">El enlace vence en 14 días.</p><p style="color:#667;font-size:13px">Renovacell · Tecnologías Antiedad</p>`
  return { asunto: 'Tu cuenta en Renovacell', texto, html }
}
