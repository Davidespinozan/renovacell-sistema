// IA · TANDA 2 · 9 (23 nov 2026) · el aviso de «cuenta verificada» por WhatsApp ya no manda el enlace técnico de Supabase:
// manda https://sistema.renovacell.mx/sistema#token_hash=…&type=recovery. Aquí se lee ese fragmento; la app lo canjea con
// verifyOtp (queda la sesión de recuperación) y muestra «crear contraseña». El fragmento nunca viaja al servidor.

/** token_hash de un enlace de la app para crear/recuperar la contraseña; null si el fragmento no es eso. */
export function tokenRecuperacion(hash: string | null | undefined): string | null {
  const h = new URLSearchParams(String(hash ?? '').replace(/^#/, ''))
  const t = h.get('token_hash')
  return t && h.get('type') === 'recovery' && /^[A-Za-z0-9_-]{16,200}$/.test(t) ? t : null
}
