// ANTIBOT (5 nov 2026) · freno determinista para que la IA de canal (WhatsApp/Instagram/Messenger) NO converse con otro bot.
// Incidente: el asistente automático de otra empresa escribió al número de Renovacell y las dos IAs se contestaron 42 min
// (252 mensajes, 124 turnos, ~1.45 M tokens). La IA "decía" que dejaba de contestar, pero el modelo no puede callarse solo:
// el freno tiene que estar ANTES de llamar al proveedor (cero tokens). Pura, sin red ni base: se prueba en vitest.
//
// Reglas (cualquiera basta):
//   · sin_contenido — mensaje sin texto que no es imagen/audio/etc. (plantillas o avisos de empresas, reacciones): no se contesta.
//   · eco           — el mensaje entrante repite un texto que acaba de mandar NUESTRA IA (el otro bot la está repitiendo).
//   · repetido      — el mismo texto (≥ 12 letras) ya llegó 2+ veces en la sesión y la IA ya contestó entre ellas.
//   · automatico    — frase típica de bot ("selecciona una de las opciones", "asistente virtual"…) y en la sesión ya hubo
//                     otra igual de automática: una sola frase así de una persona real no frena nada.
// El freno no es permanente: solo mira la sesión; si después escribe una persona con texto normal, la IA contesta.

export type MotivoFreno = 'sin_contenido' | 'eco' | 'repetido' | 'automatico'
export interface MensajeHist { actor: string; content: string }

const SIN_CONTENIDO = /^Envió un mensaje por (WhatsApp|Instagram|Messenger)\.$/

/** Etiqueta genérica de entrada (tipo desconocido, plantilla, reacción): no hay nada que contestar. */
export function sinContenido(texto: string): boolean {
  return SIN_CONTENIDO.test((texto ?? '').trim())
}

export function normalizar(t: string): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const AUTOMATICO = [
  /\basistente (virtual|automatico|digital)\b/,
  /\b(selecciona|elige|escoge) (una|alguna) de las opciones\b/,
  /\bno (logre|pude) entender\b/,
  /\bno entendi (lo que|tu mensaje|tu respuesta)\b/,
  /\bintenta de nuevo\b/,
  /\bescribe solo (tu|el) \w+/,
  /\b(respuesta|mensaje) automatic[oa]\b/,
  /\bvoy a finalizar la charla\b/,
  /\bescribeme hola\b/,
  /\b(responde|contesta|escribe) con el numero\b/,
  /\bopcion (no )?valida\b/,
  /\bmenu principal\b/,
]

/** ¿Suena a respuesta de un bot (menú, "no entendí", "asistente virtual")? */
export function pareceAutomatico(texto: string): boolean {
  const t = normalizar(texto)
  return AUTOMATICO.some((r) => r.test(t))
}

function esUsuario(actor: string): boolean { return actor === 'visitor' || actor === 'doctor' }

/**
 * Decide si la IA debe callar ante `texto`. `historial` = mensajes de la sesión ANTERIORES al disparador (como los da
 * cc_ia_contexto, en orden); si incluye al disparador como último mensaje de usuario, se ignora esa copia.
 */
export function frenoBot(historial: MensajeHist[], texto: string): MotivoFreno | null {
  if (sinContenido(texto)) return 'sin_contenido'
  const n = normalizar(texto)
  if (!n) return null
  let hist = historial ?? []
  const ult = hist[hist.length - 1]
  if (ult && esUsuario(ult.actor) && normalizar(ult.content) === n) hist = hist.slice(0, -1)

  // eco: el entrante contiene (o es contenido en) un mensaje reciente de nuestra IA.
  if (n.length >= 30) {
    const huella = n.slice(0, 60)
    for (const m of hist) {
      if (m.actor !== 'ai') continue
      const a = normalizar(m.content)
      if (a.length >= 30 && (a.includes(huella) || n.includes(a.slice(0, 60)))) return 'eco'
    }
  }
  const previosUsuario = hist.filter((m) => esUsuario(m.actor)).map((m) => normalizar(m.content))
  // repetido: solo si la IA ya contestó después de la primera copia (una persona que reenvía porque la IA tardó no frena).
  if (n.replace(/[^a-z]/g, '').length >= 12) {
    const primera = hist.findIndex((m) => esUsuario(m.actor) && normalizar(m.content) === n)
    if (primera >= 0 && previosUsuario.filter((p) => p === n).length >= 2 && hist.slice(primera + 1).some((m) => m.actor === 'ai')) return 'repetido'
  }
  if (pareceAutomatico(texto) && previosUsuario.slice(-8).some((p) => AUTOMATICO.some((r) => r.test(p)))) return 'automatico'
  return null
}
