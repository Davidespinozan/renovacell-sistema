// TANDA 1 (23 nov 2026, dueño: «DALE») · CONVERSACIÓN NATURAL (puro, sin imports). Lo que el análisis de 34 conversaciones
// reales encontró y que se decide sin el modelo:
//   1 · JUNTAR MENSAJES SEGUIDOS: el cliente manda «Hola» / «Buen día» o «Tiene linurasse» / «?» y la IA contestaba cada uno.
//       Ahora responde el turno MÁS NUEVO con todo lo pendiente; uno viejo que termina después de que llegó otro mensaje del
//       cliente espera a que el turno nuevo arranque y cede (la base lo descarta como 'superado'). Nunca deja un mensaje sin
//       respuesta: si el turno nuevo no arranca a tiempo (bot, límite, transferencia), el viejo publica su respuesta.
//   2 · CLIENTE RECONOCIDO: si el equipo ligó la conversación a un cliente o el cliente dice que ya compró, no se le piden
//       datos; lo atiende su asesor con su historial y la IA avanza la venta. NO da precios ni datos (R4-B1 sigue igual).
//   4 · MENSAJES CORTOS: ~280 caracteres, UNA pregunta, sin re-saludar, promoción y horario una sola vez por conversación.
//   6 · Respaldos naturales que avanzan la venta (ver validacion.ts).

export interface MensajeHistorial { actor: string; content: string; seq?: number }

const sinAcentos = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const esCliente = (actor: string) => actor === 'visitor' || actor === 'doctor'
const esEquipo = (actor: string) => actor === 'seller' || actor === 'admin'

// ══ 1 · JUNTAR MENSAJES SEGUIDOS ══════════════════════════════════════════════════════════════════════════════════════
/** Espera del webhook antes de responder (mensajes seguidos del cliente). La Edge responde a Meta ANTES: no causa reintentos. */
export const AGRUPAR_MS = 8_000
/** Lo más que un turno terminado espera a que arranque el turno de un mensaje más nuevo antes de publicar el suyo. */
export const ESPERA_TURNO_NUEVO_MS = 15_000
/** Mensajes del cliente que NUNCA disparan un turno de IA (reacción, sticker, algo que WhatsApp no deja ver; fotos y archivos
 *  del portal): no cuentan como «llegó otro mensaje», o el anterior se quedaría sin respuesta. */
const SIN_TURNO: readonly RegExp[] = [/^Reaccionó con /, /^Envió un sticker por WhatsApp\./, /^Mandó algo que WhatsApp no deja ver/, /^Envió una imagen\.$/, /^Envió un video\.$/, /^Envió un documento: [\s\S]*\.$/]
export const esMensajeSinTurno = (texto: string): boolean => SIN_TURNO.some((r) => r.test((texto ?? '').trim()))
/** ¿Alguno de estos mensajes (posteriores al disparador) es del cliente y sí dispara un turno? */
export const hayMensajeQueResponder = (nuevos: ReadonlyArray<{ actor: string; content: string }>): boolean =>
  nuevos.some((m) => esCliente(m.actor) && !esMensajeSinTurno(m.content))

export type DecisionPublicar = 'publicar' | 'esperar' | 'ceder'
/** Antes de publicar: sin mensajes nuevos, publica; con mensaje nuevo cuyo turno ya arrancó, cede (la base descarta este);
 *  con mensaje nuevo sin turno todavía, espera; agotada la espera, publica (nunca se queda el cliente sin respuesta). */
export function decidirPublicar(e: { hayNuevo: boolean; turnoNuevo: boolean; esperadoMs: number; maxMs?: number }): DecisionPublicar {
  if (!e.hayNuevo) return 'publicar'
  if (e.turnoNuevo) return 'ceder'
  return e.esperadoMs >= (e.maxMs ?? ESPERA_TURNO_NUEVO_MS) ? 'publicar' : 'esperar'
}

/** Mensajes del cliente aún sin respuesta: los posteriores a la última línea de la IA o del equipo (el sistema no cuenta). */
export function rafagaPendiente(h: readonly MensajeHistorial[]): string[] {
  const out: string[] = []
  for (let i = h.length - 1; i >= 0; i--) {
    const m = h[i]
    if (m.actor === 'system') continue
    if (!esCliente(m.actor)) break
    if (!esMensajeSinTurno(m.content)) out.unshift(String(m.content ?? ''))
  }
  return out
}
/** El historial ANTES de la ráfaga pendiente (lo que ya se le contestó). */
export function historialPrevio(h: readonly MensajeHistorial[]): MensajeHistorial[] {
  let i = h.length - 1
  while (i >= 0 && (h[i].actor === 'system' || esCliente(h[i].actor))) i--
  // los avisos del sistema dentro de la ráfaga (p. ej. «fuera de horario») sí cuentan como ya dichos
  return [...h.slice(0, i + 1), ...h.slice(i + 1).filter((m) => m.actor === 'system')]
}

// ══ 2 · CLIENTE RECONOCIDO ════════════════════════════════════════════════════════════════════════════════════════════
const DICE_CLIENTE = /\bya (soy|somos) (su |sus |tu |tus )?client[ae]s?\b|\bya (he|hemos|habia|habiamos|hubiera) (comprado|pedido|realizado (un |el |mi )?pedido|hecho (un |el |mi )?pedido)|\bya (les |le |te )(he |hemos |habia )?(comprado|pedido)|\bya (me|nos) (tienen|tiene|conocen|conoce)\b|\bya (estoy|estamos) (registrad[oa]s?|verificad[oa]s?|dad[oa]s? de alta)\b|\b(siempre|ya) les compro\b|\b(ustedes )?(me|nos) (han )?surtid[oa]\b|\bya tengo (mi )?cuenta\b|\bsoy (su )?client[ae] (de ustedes|desde)\b/
/** El cliente dice que ya compró, que ya es cliente o que ya lo tienen registrado (determinista; no da identidad). */
export const diceSerCliente = (textos: readonly string[]): boolean => textos.some((t) => DICE_CLIENTE.test(sinAcentos(t)))

/** Instrucción de cliente reconocido. Solo deja de pedir datos y lo encamina con su asesor: NO abre precios ni datos (R4-B1). */
export function textoClienteReconocido(e: { porServidor: boolean; porCliente: boolean; asesor?: string | null }): string | null {
  if (!e.porServidor && !e.porCliente) return null
  const quien = e.asesor ? `${e.asesor}, de nuestro equipo comercial,` : 'una persona de nuestro equipo comercial que ve su historial'
  return [
    `CLIENTE RECONOCIDO (${e.porServidor ? 'el equipo ya ligó esta conversación a un cliente de Renovacell' : 'dice que ya nos ha comprado o que ya lo tenemos registrado'}):`,
    'NO le pidas nombre, cédula, correo ni foto, ni lo mandes a registrarse o verificarse, aunque pregunte precios.',
    `Dile en una frase que ${quien} lo atiende con su historial por este mismo chat, y avanza la venta: qué producto, cuántas piezas y a qué ciudad (una pregunta a la vez).`,
    'Esto NO cambia lo que puedes decir: precios, existencias, pedidos, direcciones y datos de la cuenta siguen sin estar a tu alcance; no confirmes ni inventes datos de su cuenta.',
  ].join(' ')
}

// ══ 4 · ESTADO DE LA CONVERSACIÓN (para no repetir) ═══════════════════════════════════════════════════════════════════
const RE_PROMO = /\bpromo(s|ci[oó]n|ciones)?\b|\bbuen fin\b|\bmayoreo especial\b/i
const RE_HORARIO = /fuera de horario|horario de atenci[oó]n|\batendemos de\b|\blunes a (viernes|s[aá]bado)\b|\bhoy domingo\b|\bestamos cerrad|no est[aá] disponible en este momento|cuando (el equipo )?vuelva a estar disponible|\bde 10:00 a 18:00\b/i
const RE_PREGUNTA_PROMO = /promo|buen fin|descuento|oferta|rebaja|especial/i
const RE_PREGUNTA_HORARIO = /horario|abren|cierran|a que hora|que hora|domingo|sabado|hoy|mañana|manana|cuando|direcci|ubicaci|donde est/i

// Petición explícita (verbo de petición dirigido al cliente o «¿cuál es tu…?»); mencionar la verificación no es pedir datos.
const SOLICITA = /\b(me|nos) (pasas|compartes|mandas|env[ií]as|das|regalas|escribes|confirmas|proporcionas|dices|dejas|(puedes|podr[ií]as) (pasar|compartir|mandar|enviar|dar|escribir|confirmar|dejar|proporcionar))\b|\b(m[aá]nd[ae]me|env[ií]a(me|nos)|comp[aá]rte(me|nos)|p[aá]sa(me|nos)|d[eé]ja(me|nos)|escr[ií]be(me|nos))\b|\b(necesito|ocupo|requiero|solo falta|me falta|nada m[aá]s falta)\b|\bcu[aá]l es (tu|su)\b/i
const DATO: ReadonlyArray<[string, RegExp]> = [['cedula', /c[eé]dula/i], ['correo', /\b(correo|e-?mail)\b/i], ['nombre', /\b(tu|su) nombre\b|\bnombre completo\b/i], ['foto', /\bfoto\b[^.?!]{0,30}c[eé]dula|c[eé]dula[^.?!]{0,40}\bfoto\b/i]]
/** Datos de verificación que el texto le PIDE al cliente (frase con verbo de petición o pregunta). */
export function datosPedidos(texto: string): Set<string> {
  const out = new Set<string>()
  for (const f of frases(texto)) {
    if (!SOLICITA.test(f)) continue
    for (const [k, re] of DATO) if (re.test(f)) out.add(k)
  }
  return out
}

export interface EstadoConversacion {
  yaSaludo: boolean          // la IA o el equipo ya escribieron en esta sesión: no se vuelve a saludar
  promoDicha: boolean        // la IA o el equipo ya hablaron de la promoción
  horarioDicho: boolean      // ya se dijo el horario o que estamos fuera de horario (también lo dice el aviso del sistema)
  pedidosCedula: number      // veces que la IA ya pidió la cédula
  respuestasIA: number       // respuestas de la IA en la sesión (0 = esta es la primera)
  dijoCliente: boolean       // el cliente dijo que ya es cliente / ya compró
}
export function estadoConversacion(previo: readonly MensajeHistorial[], rafaga: readonly string[] = []): EstadoConversacion {
  const ia = previo.filter((m) => m.actor === 'ai')
  const equipo = previo.filter((m) => m.actor === 'ai' || esEquipo(m.actor))
  return {
    yaSaludo: equipo.length > 0,
    promoDicha: equipo.some((m) => RE_PROMO.test(m.content)),
    horarioDicho: previo.some((m) => (m.actor === 'ai' || m.actor === 'system' || esEquipo(m.actor)) && RE_HORARIO.test(m.content)),
    pedidosCedula: ia.filter((m) => datosPedidos(m.content).has('cedula')).length,
    respuestasIA: ia.length,
    dijoCliente: diceSerCliente([...previo.filter((m) => esCliente(m.actor)).map((m) => m.content), ...rafaga]),
  }
}

/** Reglas de forma para TODAS las respuestas (canal y portal). */
export const ESTILO_MENSAJE = 'FORMA DE CADA MENSAJE (como escriben nuestras mejores vendedoras): máximo 2 o 3 líneas (unos 280 caracteres) y UNA sola pregunta. Si hay varias opciones, nombra como mucho 3, las más relevantes para lo que pidió; nunca listes el catálogo completo. La promoción y el horario se mencionan una sola vez por conversación. No cierres con «¿En qué más te puedo ayudar?» ni repitas lo que ya dijiste. Trata de «doctora» o «doctor» solo si ya sabes cuál; si no, en neutro, nunca «doctor(a)».'

/** Bloque variable del turno: lo que ya pasó en la conversación y cómo responder a la ráfaga. */
export function textoEstadoConversacion(est: EstadoConversacion, o: { rafaga: number; verificarDatos: boolean }): string {
  const l: string[] = []
  if (o.rafaga > 1) l.push(`EL CLIENTE MANDÓ ${o.rafaga} MENSAJES SEGUIDOS (van juntos en su último turno): contéstalos todos en UNA sola respuesta corta, no uno por uno.`)
  if (est.yaSaludo) l.push('YA HUBO SALUDO EN ESTA CONVERSACIÓN: no vuelvas a saludar (nada de «hola», «buen día» ni «de nuevo»); ve directo al punto.')
  if (est.promoDicha) l.push('LA PROMOCIÓN YA SE MENCIONÓ: no la repitas, salvo que pregunte por ella.')
  if (est.horarioDicho) l.push('EL HORARIO YA SE DIJO: no lo repitas, salvo que pregunte por él.')
  if (o.verificarDatos) {
    if (est.respuestasIA === 0) l.push('ES TU PRIMERA RESPUESTA: no pidas cédula ni datos todavía; responde lo que preguntó.')
    else if (est.pedidosCedula > 0) l.push('YA LE PEDISTE LA CÉDULA: no la vuelvas a pedir; si ya la dio, pide solo el siguiente dato que falte.')
  }
  return l.length ? 'CONVERSACIÓN HASTA AHORA (lo dice el servidor): ' + l.join(' ') : ''
}

// ══ 4 · REVISIÓN DETERMINISTA DE LA RESPUESTA ═════════════════════════════════════════════════════════════════════════
export type ProblemaEstilo = 'larga' | 'preguntas' | 'opciones' | 'pide_datos_primera' | 'pide_datos_cliente' | 'pide_datos_todos' | 'pide_cedula_repetida'
export interface ContextoRevision {
  estado: EstadoConversacion; rafaga: string
  /** canal sin vínculo: aplica las reglas de verificación por pasos */
  verificarDatos: boolean
  /** cliente reconocido por el servidor o por lo que dijo */
  reconocido: boolean
  /** límite de caracteres que se exige (null = sin exigir largo/una pregunta: portal) */
  limite: number | null
  /** nombres de producto del catálogo (para contar opciones) */
  nombresProducto?: readonly string[]
}
export const LIMITE_CANAL = 320          // el prompt pide ~280; se tolera un poco antes de corregir
export const LIMITE_CANAL_RESUMEN = 650  // resumen de pedido (WhatsApp vinculado: productos, total, entrega)

/** Preguntas de verdad: el «?» de un enlace (…?api=1&query=…) no cuenta. */
const sinUrls = (t: string) => (t ?? '').replace(/https?:\/\/\S+/g, ' ')
const esPregunta = (f: string) => /\?/.test(sinUrls(f))
export const cuentaPreguntas = (t: string): number => (sinUrls(t).match(/\?/g) ?? []).length
/** Frases (para recortar sin partir una idea). Un enlace nunca se parte. */
export function frases(texto: string): string[] {
  return (texto ?? '').split(/(?<=[.!?…])\s+(?=[¡¿A-ZÁÉÍÓÚÑ0-9"«(])|\n+/).map((s) => s.trim()).filter(Boolean)
}
const unir = (fs: readonly string[]) => fs.join(' ').replace(/\s+/g, ' ').trim()
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// sin /i: el nombre tras la coma debe empezar con mayúscula («Hola, sí manejamos…» no es un nombre)
const RE_SALUDO_INICIO = /^\s*¡?\s*(?:[Hh]ola+|[Hh]oli|[Bb]uen(?:os|as|o|a)?\s+(?:[Dd][ií]as?|[Tt]ardes?|[Nn]oches?)|[Bb]uen\s+[Dd][ií]a|[Bb]uenas|[Qq]u[eé]\s+tal)(?:\s+de\s+nuevo)?(?:\s*,\s*(?:(?:[Dd]octora?|[Dd]ra\.?|[Dd]r\.?)\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2}(?=\s*[!.,]))?\s*[!.,]*\s*(?:👋|😊|🙂)?\s*/
const RE_GUSTO = /^\s*¡?\s*(?:qu[eé] gusto (?:saludarte|saludarle|leerte)( de nuevo)?|mucho gusto)\s*[!.,]*\s*/i
/** Quita el saludo del inicio (ya hubo saludo en la conversación). */
export function sinSaludo(texto: string): string {
  let t = texto.replace(RE_SALUDO_INICIO, '')
  t = t.replace(RE_GUSTO, '')
  return t === texto ? texto : mayuscula(t.trim())
}
const RE_PREGUNTA_GENERICA = /^¿\s*(?:en qu[eé] (?:m[aá]s )?(?:te|le|les) (?:puedo|podemos) ayudar(?: hoy)?|hay algo m[aá]s[^?]*|algo m[aá]s en (?:lo )?que[^?]*|te puedo ayudar (?:en|con) algo m[aá]s)\s*\?\s*(?:😊|🙂)?$/i
const quitarFrases = (texto: string, quitar: (f: string) => boolean): string => {
  const fs = frases(texto); const quedan = fs.filter((f) => !quitar(f))
  return quedan.length && quedan.length !== fs.length ? unir(quedan) : texto
}

/** Ajustes deterministas (saludo repetido, promo/horario ya dichos, pregunta genérica de cierre) y problemas que piden
 *  regenerar (largo, varias preguntas, más de 3 opciones, datos de verificación fuera de lugar). */
export function revisarRespuesta(texto: string, c: ContextoRevision): { texto: string; problemas: ProblemaEstilo[] } {
  let t = (texto ?? '').trim()
  const raf = sinAcentos(c.rafaga)
  if (c.estado.yaSaludo) t = sinSaludo(t)
  // una frase con un monto ($) es parte de una cotización: no se quita aunque mencione la promoción
  if (c.estado.promoDicha && !RE_PREGUNTA_PROMO.test(raf)) t = quitarFrases(t, (f) => RE_PROMO.test(f) && !/\?|\$/.test(f))
  if (c.estado.horarioDicho && !RE_PREGUNTA_HORARIO.test(raf)) t = quitarFrases(t, (f) => RE_HORARIO.test(f) && !/\?|\$/.test(f))
  t = quitarFrases(t, (f) => RE_PREGUNTA_GENERICA.test(f))
  const problemas: ProblemaEstilo[] = []
  if (c.limite !== null) {
    if (t.length > c.limite) problemas.push('larga')
    if (cuentaPreguntas(t) > 1) problemas.push('preguntas')
    // un resumen de pedido (límite de resumen) sí lista lo que lleva: ahí no se cuentan opciones
    if (c.limite < LIMITE_CANAL_RESUMEN && opcionesNombradas(t, c.nombresProducto ?? []) > 3) problemas.push('opciones')
  }
  if (c.verificarDatos) {
    const pide = datosPedidos(t)
    const daDatos = aportaDatos(c.rafaga)   // si el cliente ya está mandando sus datos, pedir el que falta es lo correcto
    if (pide.size) {
      if (c.reconocido) problemas.push('pide_datos_cliente')
      else if (daDatos) { /* sigue la verificación que él mismo empezó */ }
      else if (c.estado.respuestasIA === 0) problemas.push('pide_datos_primera')
      else if (pide.size >= 3) problemas.push('pide_datos_todos')
      else if (pide.has('cedula') && c.estado.pedidosCedula > 0) problemas.push('pide_cedula_repetida')
    }
  }
  return { texto: t, problemas }
}
/** El cliente está mandando datos (cédula de 7–8 dígitos o un correo). */
export const aportaDatos = (t: string): boolean => /(^|\D)\d{7,8}(\D|$)|[\w.+-]+@[\w-]+\.[\w.]+/.test(t ?? '')
function opcionesNombradas(texto: string, nombres: readonly string[]): number {
  // una lista larga en una sola frase («toxinas, rellenos, bioestimuladores, péptidos, vitaminas…») es un catálogo
  if (frases(texto).some((f) => (f.match(/,/g) ?? []).length >= 4)) return 4
  const tn = ' ' + sinAcentos(texto).replace(/[^a-z0-9ñ+.]+/g, ' ') + ' '
  const vistos = new Set<string>()
  for (const n of nombres) {
    const nn = sinAcentos(n).replace(/[^a-z0-9ñ+.]+/g, ' ').trim()
    if (nn.length >= 4 && tn.includes(' ' + nn + ' ')) vistos.add(nn)
  }
  // "Nabota 100 UI" y "Nabota 200 UI" cuentan por separado: son opciones distintas para el cliente
  return vistos.size
}

/** Nota interna para la ÚNICA regeneración por forma (el usuario no la ve). */
export function notaEstilo(ps: readonly ProblemaEstilo[], limite: number | null): string {
  const m: Record<ProblemaEstilo, string> = {
    larga: `quedó demasiado larga: déjala en 2 o 3 líneas (menos de ${limite ?? 280} caracteres), solo lo esencial`,
    preguntas: 'hacía varias preguntas: deja UNA sola, la más útil para avanzar',
    opciones: 'listaba demasiados productos: nombra como mucho 3, los más relevantes',
    pide_datos_primera: 'pedía cédula o datos en tu primera respuesta: primero responde lo que preguntó, sin pedir datos',
    pide_datos_cliente: 'le pedía datos a un cliente que ya conocemos: no le pidas nada; dile que su asesor lo atiende con su historial y avanza (producto, piezas o ciudad)',
    pide_datos_todos: 'pedía varios datos a la vez: pide solo su número de cédula profesional; lo demás después',
    pide_cedula_repetida: 'volvía a pedir la cédula que ya pediste: no la pidas otra vez; avanza con lo que preguntó',
  }
  return `\n\nANTES DE RESPONDER (instrucción interna, no la menciones ni pidas disculpas): tu respuesta anterior ${ps.map((p) => m[p]).join('; ')}. Vuelve a responder su último mensaje, directo y como si fuera tu primera respuesta.`
}

/** Si la regeneración tampoco cumplió: recorte determinista (nunca inventa; solo quita frases). */
export function recortar(texto: string, c: ContextoRevision): string {
  let fs = frases(texto)
  if (c.verificarDatos) {
    // solo se tocan las peticiones de datos que de verdad estaban mal (pedir el siguiente dato que falta es correcto)
    const ps = revisarRespuesta(texto, c).problemas
    const pide = (f: string) => datosPedidos(f).size > 0
    if (ps.includes('pide_datos_cliente') || ps.includes('pide_datos_primera') || ps.includes('pide_cedula_repetida')) { const q = fs.filter((f) => !pide(f)); if (q.length) fs = q }
    else if (ps.includes('pide_datos_todos')) fs = fs.map((f) => (pide(f) ? '¿Me compartes tu número de cédula profesional?' : f)).filter((f, i, a) => a.indexOf(f) === i)
  }
  if (c.limite === null) return unir(fs)
  // una sola pregunta: se queda la ÚLTIMA (la que avanza); las anteriores salen
  const preguntas = fs.filter(esPregunta)
  if (preguntas.length > 1) { const ultima = preguntas[preguntas.length - 1]; fs = fs.filter((f) => !esPregunta(f) || f === ultima) }
  const pregunta = fs.find(esPregunta) ?? null
  const out: string[] = []
  for (const f of fs) {
    const tentativa = unir([...out, f])
    if (tentativa.length <= c.limite || !out.length) { out.push(f); continue }
    break
  }
  // la pregunta que avanza la venta se conserva si cabe
  if (pregunta && !out.includes(pregunta) && unir([...out, pregunta]).length <= c.limite + 40) out.push(pregunta)
  return unir(out)
}

/** Respaldo natural para un cliente reconocido que no debe dar datos. */
export function textoReconocidoRespaldo(asesor?: string | null): string {
  return `Va, ${asesor ? asesor + ' te atiende' : 'nuestro equipo comercial te atiende'} con tu historial por aquí mismo. Para adelantar, ¿qué producto y cuántas piezas necesitas?`
}

// ══ 6 · NOMBRES QUE ESCRIBIÓ EL CLIENTE ═══════════════════════════════════════════════════════════════════════════════
// Palabras de familia/forma que comparten muchos productos: por sí solas no identifican uno.
const GENERICAS = new Set(('implante cosmetico ultrafiltrado ultrafiltrados ultra filtrados microaguja desechable vial kwikpen vitamina vit hidrolizado ' +
  'placenta serum mask hombre mujer renovacell').split(' '))
/** Nombres del catálogo cuya palabra distintiva escribió el propio cliente («linurasse» no, «linurase» sí): nombrarlos no es
 *  inventar (existen en el catálogo de su audiencia). Una cédula o un número nunca autoriza nada. */
export function nombresQueEscribioElCliente(nombresCatalogo: readonly string[], textosCliente: readonly string[]): string[] {
  const t = ' ' + sinAcentos(textosCliente.join(' ')).replace(/[^a-z0-9ñ+]+/g, ' ') + ' '
  if (!/[a-zñ]{4,}/.test(t)) return []
  const out: string[] = []
  for (const n of nombresCatalogo) {
    const palabras = sinAcentos(n).replace(/[^a-z0-9ñ+]+/g, ' ').trim().split(' ')
    const clave = palabras.find((w) => /^[a-zñ][a-zñ+]{3,}$/.test(w) && !GENERICAS.has(w))
    if (clave && t.includes(' ' + clave + ' ')) out.push(n)
  }
  return out
}
