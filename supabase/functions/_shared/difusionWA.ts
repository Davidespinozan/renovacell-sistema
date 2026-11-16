// DIFUSIONES POR WHATSAPP (15 nov 2026). Puro (sin Deno ni supabase): lo usan la Edge `difusion-wa` y la pantalla.
// La difusión sale con la plantilla `difusion_vendedor`: {{1}} saludo, {{2}} vendedora, {{3}} el mensaje en UN renglón
// (Meta no acepta saltos de línea ni 4+ espacios seguidos dentro de un dato). La base arma los datos (_difwa_mensaje);
// aquí se repite la misma regla para la vista previa y se arma el cuerpo para la Cloud API.

export const CUERPO_DIFUSION_WA = 'Hola {{1}}, le comparte {{2}} de Renovacell: {{3}} Si le interesa, responda a este mensaje y con gusto le atendemos.'
export const LIMITE_MENSAJE_WA = 800

/** El mensaje como lo recibe el cliente en el dato {{3}} (misma regla que _difwa_mensaje en la base). */
export function mensajeDifusionWA(c: { titulo: string; texto: string; enlace?: string | null; imagen?: string | null }): string {
  const enlace = (c.enlace ?? '').trim(); const imagen = (c.imagen ?? '').trim()
  const s = `*${c.titulo.trim()}* — ${c.texto.trim()}${enlace ? ` ${enlace}` : ''}${imagen ? ` Imagen: ${imagen}` : ''}`
  return s.trim().replace(/\s+/g, ' ').slice(0, LIMITE_MENSAJE_WA)
}

/** Lo que verá el cliente en su WhatsApp. */
export function vistaPreviaWA(saludo: string, vendedora: string, mensaje: string): string {
  return CUERPO_DIFUSION_WA.replace('{{1}}', saludo).replace('{{2}}', vendedora).replace('{{3}}', mensaje)
}

/** Un dato de plantilla limpio: sin saltos de línea ni espacios de más (Meta rechaza el envío con 132018). */
export const datoLimpio = (t: string, max = LIMITE_MENSAJE_WA) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Cuerpo para POST /{phone-id}/messages. */
export function cuerpoDifusionWA(tel10: string, plantilla: string, idioma: string, parametros: string[]): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: `52${tel10}`, type: 'template',
    template: { name: plantilla, language: { code: idioma }, components: [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: datoLimpio(t) || '-' })) }] },
  }
}
