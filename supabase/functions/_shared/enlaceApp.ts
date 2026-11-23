// IA · TANDA 2 · 9 (23 nov 2026) · ENLACES AL CLIENTE SOLO CON EL DOMINIO DE LA APP. El aviso de «cuenta verificada» por
// WhatsApp mandaba el enlace técnico de autenticación (https://<proyecto>.supabase.co/auth/v1/verify?token=…, A·C0 seq15):
// asusta, expone el proyecto y la vista previa de WhatsApp puede gastarlo. Ahora va el dominio de la app con el token en el
// FRAGMENTO (#…): el fragmento no viaja al servidor ni lo abre la vista previa; la app lo canjea (verifyOtp) y pide la
// contraseña nueva. Pura: la usan la Edge alta-whatsapp y las pruebas.
export const APP_URL = 'https://sistema.renovacell.mx'

/** Enlace para crear la contraseña: dominio de la app + token_hash de Supabase en el fragmento. null si no hay token. */
export function enlaceCrearContrasena(hashedToken: string | null | undefined): string | null {
  const t = String(hashedToken ?? '').trim()
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(t)) return null
  return `${APP_URL}/sistema#token_hash=${t}&type=recovery`
}

/** ¿Es un enlace que se le puede mandar a un cliente? (solo el dominio de la app; nunca supabase.co ni otro) */
export const esEnlaceDeLaApp = (url: string | null | undefined): boolean => /^https:\/\/sistema\.renovacell\.mx\/[^\s]*$/.test(String(url ?? ''))
