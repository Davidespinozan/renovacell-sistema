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

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TANDA 2 (23 nov 2026) · lo que la IA afirma de un producto, datos del negocio, medios, quién escribe y cómo se le trata.
//   3 · «Sí manejamos» SOLO con evidencia: con existencia → lo tenemos; sin existencia o presentación que no manejamos → se
//       dice y se ofrece la alternativa más cercana (como las vendedoras); no aparece → no se afirma: se confirma con el
//       equipo y UNA pregunta para aclarar. (A·C4 seq20 «sí manejamos NABOTA 200 UI», B·C2 seq5 «sí manejamos INNOTOX 100 UI»)
//   7 · Dirección de la sucursal (no la fiscal), nada de motivos inventados («si ayer fue domingo…»), y el costo de envío
//       solo si lo pregunta y nunca encima de una cotización «con envío incluido» (A·C8 seq4, A·C2 seq63).
//   8 · Imágenes: la IA sí las ve (R4-C13) → nunca «no puedo ver imágenes»; no toda imagen es un comprobante. Audios: una
//       línea honesta pidiendo que lo escriba, una vez. Enfermería, pacientes, revendedores y terceros, cada uno a su manera.
//   9 · «doctora/doctor» y su nombre solo si se sabe (él/ella lo dijo o viene de su cuenta vinculada); nunca «doctor(a)».
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const norm2 = (s: string) => sinAcentos(s).replace(/[^a-z0-9ñ.+ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const GENERICAS_PRODUCTO = new Set(('implante cosmetico ultrafiltrado ultrafiltrados hidrolizado vial kwikpen vitamina serum mask clasico caja cajas ' +
  'toxina toxinas relleno rellenos producto productos renovacell para como algo este esta tiene quiero quisiera precio mayoreo pieza piezas acido marca ' +
  'unidades presentacion').split(' '))
/** Palabra distintiva (marca) y presentación de un nombre de producto: «NABOTA 200 UI» → { marca: 'nabota', num: '200' }. */
export function claveProducto(nombre: string): { marca: string | null; num: string | null } {
  const n = norm2(nombre)
  const marca = n.split(' ').find((w) => /^[a-zñ][a-zñ+]{3,}$/.test(w) && !GENERICAS_PRODUCTO.has(w)) ?? null
  const m = /(?:^| )(\d+(?:\.\d+)?)\s*(?:u|ui|uds?|unidades|mg|ml|cc)?(?: |$)/.exec(n)
  return { marca, num: m ? m[1] : null }
}
const mencionaProducto = (frase: string, nombre: string): boolean => {
  const { marca, num } = claveProducto(nombre)
  if (!marca) return false
  const f = ' ' + norm2(frase) + ' '
  if (!f.includes(' ' + marca + ' ') && !f.includes(' ' + marca + 's ')) return false
  return !num || new RegExp(`(^|[^0-9.])${num.replace('.', '\\.')}(?![0-9])`).test(f)
}

// ── 3 · lo que se puede afirmar de un producto ──────────────────────────────────────────────────────────────────────────
/** Lo que el SERVIDOR dijo en este turno de lo que pidió el cliente (cc_ia_producto_estado + búsquedas fuertes). */
export interface ExistenciaTurno {
  /** productos con coincidencia fuerte que se pueden surtir ahora (o sin dato de existencia): «sí lo manejamos» es cierto */
  confirmados: string[]
  /** coinciden con lo que pidió pero NO se pueden surtir ahora (sin existencia, inactivo o no vendible) */
  sinExistencia: string[]
  /** «NABOTA 150 UI»: la marca existe pero esa presentación no la manejamos */
  presentacionNo: string[]
  /** lo que escribió y no aparece en el catálogo («hyalux deep») */
  noEncontrado: string[]
  /** alternativas con existencia que dio el servidor (en orden) */
  alternativas: string[]
}
export const existenciaVacia = (): ExistenciaTurno => ({ confirmados: [], sinExistencia: [], presentacionNo: [], noEncontrado: [], alternativas: [] })
const agregar = (xs: string[], x: string | null | undefined) => { const t = String(x ?? '').trim(); if (t && !xs.includes(t)) xs.push(t) }
/** Suma al estado del turno la salida de cc_ia_producto_estado (jsonb; desconocido = sin cambios). */
export function sumarExistencia(acc: ExistenciaTurno, estado: unknown): ExistenciaTurno {
  const e = (estado && typeof estado === 'object' ? estado : null) as Record<string, unknown> | null
  if (!e) return acc
  const coincidencia = String(e.coincidencia ?? '')
  if (coincidencia === 'ninguna') { agregar(acc.noEncontrado, String(e.consulta ?? '')); return acc }
  for (const p of (Array.isArray(e.pedidos) ? e.pedidos : []) as Array<Record<string, unknown>>) {
    if (coincidencia !== 'exacta') continue   // un parecido no confirma nada: se pregunta «¿te refieres a…?»
    if (p.disponible_ahora === false || p.se_vende === false) agregar(acc.sinExistencia, String(p.nombre ?? ''))
    else agregar(acc.confirmados, String(p.nombre ?? ''))
  }
  if (e.presentacion_no_manejada === true) {
    const marca = claveProducto(String(e.consulta ?? '')).marca
    agregar(acc.presentacionNo, [marca, String(e.presentacion_pedida ?? '')].filter(Boolean).join(' '))
  }
  for (const a of (Array.isArray(e.alternativas) ? e.alternativas : []) as Array<Record<string, unknown>>) agregar(acc.alternativas, String(a.nombre ?? ''))
  return acc
}
/** Nota para el modelo junto al resultado de buscar_productos: qué puede afirmar (sin cifras de existencias). */
export function notaExistencia(estado: unknown): string | null {
  const ex = sumarExistencia(existenciaVacia(), estado)
  const e = (estado && typeof estado === 'object' ? estado : {}) as Record<string, unknown>
  const alt = ex.alternativas.slice(0, 2).join(' o ')
  if (String(e.coincidencia ?? '') === 'ninguna') return 'No aparece en nuestro catálogo: NO digas que lo manejamos ni ofrezcas otro como si fuera el mismo. Dile que lo confirmas con el equipo y hazle UNA pregunta para aclarar (presentación o para qué lo busca).'
  if (String(e.coincidencia ?? '') === 'parecida') return 'Lo que escribió se PARECE a esto (pudo ser un error de dedo): pregúntale si se refiere a ese producto antes de afirmarlo.'
  if (ex.presentacionNo.length) return `Esa presentación (${e.presentacion_pedida}) NO la manejamos: díselo con naturalidad${alt ? ` y ofrécele ${alt}` : ''}. No digas que sí la manejamos.`
  if (ex.sinExistencia.length && !ex.confirmados.length) return `${ex.sinExistencia.join(', ')} NO se puede surtir ahora: dile que por ahora no está disponible${alt ? ` y ofrécele ${alt}, que sí hay` : ''}. No digas «sí lo manejamos» ni «sí lo tenemos», no des cifras ni prometas cuándo llega.`
  if (ex.confirmados.length) return 'Sí lo manejamos (puedes confirmarlo). Existencias: sin cifras; a un contacto sin verificar no le afirmes cuántas hay.'
  return null
}

const RE_AFIRMA = /\bs[ií],?\s+(?:lo |la |los |las )?(?:manejamos|tenemos|contamos con|hay|est[aá] disponible)\b|\bclaro,?\s+(?:que\s+)?(?:s[ií]\s+)?(?:lo |la )?(?:manejamos|tenemos)\b|\b(?:lo|la|los|las) (?:manejamos|tenemos)\b|\bmanejamos\b|\bcontamos con\b|\btenemos (?:el|la|los|las|disponible)\b|\bte (?:lo|la) (?:env[ií]o|mando|aparto|preparo)\b/i
const RE_NIEGA_DISPONIBLE = /\bno (?:lo |la |los |las )?(?:tengo|tenemos|hay|manejamos|est[aá]n?|contamos)\b|\bagotad[oa]s?\b|\bsin existencia|\bno disponible|\b(?:por ahora|ahorita|de momento|en este momento|por el momento) no\b|\bse (?:nos )?(?:acab[oó]|termin[oó])/i
export type ProblemaAfirmacion = 'afirma_sin_evidencia' | 'afirma_sin_existencia'
/** Frases que afirman tener algo que el servidor dijo que no hay (o no existe). Determinista. */
export function revisarAfirmaciones(texto: string, ex: ExistenciaTurno | null | undefined): { problemas: ProblemaAfirmacion[]; frases: string[] } {
  if (!ex) return { problemas: [], frases: [] }
  const problemas = new Set<ProblemaAfirmacion>(); const malas: string[] = []
  for (const f of frases(texto)) {
    if (!RE_AFIRMA.test(f) || RE_NIEGA_DISPONIBLE.test(f)) continue
    const sinEx = ex.sinExistencia.some((n) => mencionaProducto(f, n) && !ex.confirmados.some((c) => mencionaProducto(f, c) && claveProducto(c).num === claveProducto(n).num))
    const noManejada = ex.presentacionNo.some((n) => mencionaProducto(f, n))
    const noExiste = ex.noEncontrado.some((q) => { const k = claveProducto(q).marca; return !!k && (' ' + norm2(f) + ' ').includes(' ' + k + ' ') })
    if (sinEx) problemas.add('afirma_sin_existencia')
    if (noManejada || noExiste) problemas.add('afirma_sin_evidencia')
    if (sinEx || noManejada || noExiste) malas.push(f)
  }
  return { problemas: [...problemas], frases: malas }
}
/** Respaldo determinista si la regeneración también afirmó sin evidencia. Nunca inventa: usa lo que dijo el servidor. */
export function textoRespaldoExistencia(ex: ExistenciaTurno, asesor?: string | null): string {
  const alt = ex.alternativas.slice(0, 2)
  const ofrece = alt.length ? ` Te puedo ofrecer ${alt.join(' o ')}. ¿Te sirve?` : ` Lo confirmo con ${asesor ?? 'el equipo'}. ¿Te interesa otra presentación?`
  if (ex.sinExistencia.length) return `Ahorita no tengo ${ex.sinExistencia[0]} disponible.${ofrece}`
  if (ex.presentacionNo.length) return `Esa presentación (${ex.presentacionNo[0]}) no la manejamos.${ofrece}`
  return `No lo encuentro así en nuestro catálogo; lo confirmo con ${asesor ?? 'el equipo'} para no darte un dato equivocado. ¿Me dices la presentación o para qué lo buscas?`
}
/** Consultas de presentación que escribió el cliente («nabota de 200 unidades» → «nabota 200 ui») para preguntar al servidor. */
export function consultasExistencia(texto: string): string[] {
  const t = sinAcentos(texto).replace(/[^a-z0-9ñ. ]+/g, ' ')
  const out: string[] = []
  const re = /([a-zñ]{4,}(?: [a-zñ]{4,})?) (?:de |del )?(\d+(?:\.\d+)?) ?(u|ui|uds?|unidades|units?|mg|ml)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) && out.length < 3) {
    // la marca va justo antes de la presentación («…checar si tendrían innotox de 100 u» → «innotox»)
    const ws = m[1].split(' ').filter((w) => !GENERICAS_PRODUCTO.has(w) && !/^(tiene|tienen|tienes|tendrian|tendran|manejan|necesito|ocupo|cuanto|otra|otro|checar|hacer|pedido)$/.test(w))
    const marca = ws[ws.length - 1]
    if (marca) out.push(`${marca} ${m[2]} ${/^(mg|ml)$/.test(m[3]) ? m[3] : 'ui'}`)
  }
  return [...new Set(out)]
}

// ── 7 · negocio: dirección vigente, sin motivos inventados, envío sin contradecir ───────────────────────────────────────
const NO_DIRECCION = new Set('boulevard blvd bulevar calle avenida av colonia col desarrollo fraccionamiento fracc culiacan sinaloa mexico plaza local numero sucursal'.split(' '))
/** ¿El texto da la dirección anterior/fiscal? (dos palabras seguidas de esa dirección, o su número, que no estén en la sucursal) */
export function mencionaDireccionAnterior(texto: string, anterior: string | null | undefined, sucursal: string | null | undefined): boolean {
  const a = norm2(anterior ?? ''), s = ' ' + norm2(sucursal ?? '') + ' ', t = ' ' + norm2(texto) + ' '
  if (!a || a.length < 8) return false
  const w = a.split(' ').filter((x) => x.length >= 3 && !NO_DIRECCION.has(x))
  for (let i = 0; i + 1 < w.length; i++) {
    const bi = w[i] + ' ' + w[i + 1]
    if (/[a-zñ]/.test(bi) && !s.includes(' ' + bi + ' ') && t.includes(' ' + bi + ' ')) return true
  }
  return w.some((x) => /^\d{3,5}$/.test(x) && !s.includes(' ' + x + ' ') && t.includes(' ' + x + ' '))
}
// «Si ayer fue domingo, por eso nadie contestó» (A·C8 seq4): la IA no sabe qué pasó; no supone motivos.
const RE_MOTIVO_INVENTADO = /\bsi (?:ayer|hoy|ese d[ií]a|el d[ií]a que vino)\b[^.!?]{0,30}\b(?:fue|era|es|estaba)\b|\bpor eso (?:nadie|no (?:le |te )?(?:contest|atend|abri))|\b(?:seguramente|tal vez|quiz[aá]s?|a lo mejor|probablemente)\s+(?:fue|era|estaba|estuvo|estaban|porque (?:era|fue|estaba|estuvo)|se (?:cerr|equivoc|confund))/i
const RE_COSTO_ENVIO = /(?:env[ií]o|flete|paqueter[ií]a)[^.!?]{0,60}\$\s?\d|\$\s?\d[\d,.]*[^.!?]{0,40}(?:env[ií]o|flete)/i
const RE_PREGUNTA_ENVIO = /env[ií]o|enviar|envian|mandan|flete|paqueter|cuanto (cuesta|sale|cobran) (el )?(env|mand)|llega|domicilio|costo de/
// el equipo ya cotizó con el envío incluido (A·C2 seq38/48 «total $22,971 con envío incluido»)
const RE_ENVIO_INCLUIDO = /env[ií]o (?:va |ya va |queda )?incluido|incluye (?:el )?env[ií]o|env[ií]o (?:sin costo|gratis)|(?:ya )?con (?:el )?env[ií]o (?:incluido|gratis|sin costo)/i
export const equipoIncluyoEnvio = (previo: readonly MensajeHistorial[]): boolean => previo.slice(-20).some((m) => (esEquipo(m.actor) || m.actor === 'ai') && RE_ENVIO_INCLUIDO.test(m.content))

// ── 8 · medios ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const RE_AUDIO = /^Envió un (audio|video) por (WhatsApp|Instagram|Messenger)\.$/
/** La ráfaga pendiente es SOLO audio/video sin texto (no hay transcripción): 'audio' | 'video' | null. */
export function medioSinTexto(rafaga: readonly string[]): 'audio' | 'video' | null {
  if (!rafaga.length) return null
  const ms = rafaga.map((t) => RE_AUDIO.exec((t ?? '').trim()))
  if (ms.some((m) => !m)) return null
  return ms.some((m) => m![1] === 'video') ? 'video' : 'audio'
}
const RE_PIDIO_ESCRIBIR = /no (alcanzo|logro|puedo) (a )?(escuchar|oir|reproducir|abrir|ver)[^.!?]{0,40}\b(audio|audios|nota|notas|video|videos)|\b(audio|nota de voz|video)\b[^.!?]{0,60}\b(escr[ií]bemelo|me lo escribes|escribirlo|por escrito)/i
/** ¿La IA ya le pidió en esta sesión que escribiera lo del audio? (entonces otro audio no se contesta: lo escucha el equipo) */
export const yaPidioEscribirAudio = (previo: readonly MensajeHistorial[]): boolean => previo.some((m) => m.actor === 'ai' && RE_PIDIO_ESCRIBIR.test(m.content))
/** Una línea honesta, una sola vez. */
export const textoAudio = (tipo: 'audio' | 'video', yaSaludo: boolean): string =>
  `${yaSaludo ? '' : '¡Hola! '}Por aquí no alcanzo a ${tipo === 'audio' ? 'escuchar audios' : 'ver videos'}. ¿Me lo escribes, por favor?`
const RE_NIEGA_VISION = /\bno (?:puedo|logro|alcanzo a|pude|me es posible) (?:ver|abrir|visualizar|revisar|leer)(?:la|lo|las|los)\b|\bno (?:puedo|logro|alcanzo a|pude|me es posible) (?:ver|abrir|visualizar|revisar|leer)\b[^.!?]{0,25}\b(?:im[aá]gen(?:es)?|fotos?|archivos?|capturas?|pdf)\b|\bno (?:veo|se ve|se abre|abre) (?:la |tu |su )?(?:imagen|foto|captura)\b|\b(?:las )?im[aá]genes no (?:las )?(?:puedo|alcanzo)/i
const RE_COMPROBANTE = /\bcomprobante\b|\brecibo de pago\b|\b(?:tu|su) pago\b|\bpago (?:recibido|registrado)\b|\btransferencia (?:recibida|que hiciste)\b/i
const RE_HABLA_PAGO = /\bpag(o|os|ar|ue|ado|ada)\b|pagu[eé]|tarjeta|transfer|deposit|comprobante|spei|cuentas|recibo|ficha de pago/
/** ¿Alguien habló de pagar en lo reciente? (si no, una imagen no se trata como comprobante) */
export const hablaronDePago = (previo: readonly MensajeHistorial[], rafaga: string): boolean =>
  RE_HABLA_PAGO.test(sinAcentos(rafaga)) || previo.slice(-8).some((m) => RE_HABLA_PAGO.test(sinAcentos(m.content)))

// ── 8 · quién escribe ───────────────────────────────────────────────────────────────────────────────────────────────────
export type TipoContacto = 'enfermeria' | 'paciente' | 'revendedor' | 'tercero'
const RE_ENFERMERIA = /\b(cedula|titulo) de enfermer|\bsoy enfermer[oa]\b|\b(licenciad[oa]|lic\.?) en enfermer|\benfermer[oa] (titulad|general|especialista)/
const RE_PACIENTE = /\bsoy (su |una |un )?paciente\b|\bpara mi (cara|rostro|labios|frente|piel)\b|\bme (quiero|gustaria) (aplicar|poner|inyectar)\b|\b(aplicarme|ponerme|inyectarme)\b/
const RE_REVENDEDOR = /\b(no tengo cedula)\b[^.?!]{0,40}\b(vendo|distribuy|revend)|\b(solo|solamente|nada mas) (vendo|distribuyo|revendo)\b|\b(yo )?(distribuyo|revendo)\b|\bsoy (distribuidor|distribuidora|revendedor|revendedora)\b|\bpara (revender|reventa|distribuir)\b/
const RE_TERCERO = /\b(le |les )?hablo (de|desde) (farmacias?|la farmacia|paqueteria|la paqueteria|dhl|estafeta|fedex|la empresa)\b|\bsoy (de|del personal de) (farmacias?|la farmacia|paqueteria|dhl|estafeta|fedex)\b|\b(de parte de|vengo de parte de) (farmacias?|la farmacia|paqueteria|dhl|estafeta|fedex)\b|\b(soy|somos) (el |la )?(repartidor|repartidora|mensajer[oa]|proveedor|proveedora)\b|\b(traigo|vengo a (dejar|entregar)) (un|el|su) (paquete|pedido|envio)\b/
/** Quién escribe, según lo que él mismo dice (determinista; null = cliente normal). */
export function tipoContacto(textosCliente: readonly string[]): TipoContacto | null {
  const t = sinAcentos(textosCliente.join(' . '))
  if (RE_TERCERO.test(t)) return 'tercero'
  if (RE_ENFERMERIA.test(t)) return 'enfermeria'
  if (RE_REVENDEDOR.test(t)) return 'revendedor'
  if (RE_PACIENTE.test(t)) return 'paciente'
  return null
}
export const MENSAJE_ENFERMERIA = 'Por ahora vendemos solo con cédula profesional de médico; con la de enfermería no es posible. Gracias por escribirnos.'
export function textoTipoContacto(tipo: TipoContacto | null): string | null {
  switch (tipo) {
    case 'enfermeria': return 'QUIÉN ESCRIBE (lo dijo): personal de enfermería. Vendemos SOLO con cédula profesional de médico: díselo directo y amable en una frase ("Por ahora vendemos solo con cédula profesional de médico; con la de enfermería no es posible"). No digas que un asesor confirma si aplica, no le pidas datos para verificarla.'
    case 'paciente': return 'QUIÉN ESCRIBE (lo dijo): paciente (no profesional de la salud). No le vendes ni le das precios: oriéntalo con amabilidad a consultar con su médico, que es quien puede adquirir los productos.'
    case 'revendedor': return 'QUIÉN ESCRIBE (lo dijo): revendedor o distribuidor, sin cédula. No le pidas cédula ni le des precios. Califícalo como lo hacen las vendedoras, UNA pregunta a la vez: ¿cuenta con una empresa de distribución establecida? y luego su constancia de situación fiscal (o una red social de su negocio); usa solicitar_asesor para que el equipo comercial lo atienda.'
    case 'tercero': return 'QUIÉN ESCRIBE (lo dijo): un tercero (farmacia, paquetería, repartidor, proveedor), no un cliente. No le hables de productos, promociones ni precios y no le pidas cédula. Si pregunta dónde entregar o recoger, dale la dirección de la sucursal y el horario del bloque negocio; usa solicitar_asesor para que el equipo le confirme lo de su entrega, y díselo en una frase.'
  }
  return null
}

// ── 9 · trato ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Trato { trato: 'doctora' | 'doctor' | null; nombre: string | null }
const NOMBRE = '([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})'
/** Cómo tratarlo: lo que él mismo dijo («soy la Dra. Ana», «Dr. Luis», firma) o el nombre de SU cuenta vinculada. Nunca del teléfono. */
export function tratoCliente(textosCliente: readonly string[], nombreCuenta?: string | null): Trato {
  let trato: Trato['trato'] = null; let nombre: string | null = null
  const cuenta = (nombreCuenta ?? '').trim()
  const mc = new RegExp(`^(dra|dr|doctora|doctor)\\.?\\s+${NOMBRE}`, 'i').exec(cuenta)
  if (mc) { trato = /^(dra|doctora)/i.test(mc[1]) ? 'doctora' : 'doctor'; nombre = mc[2] }
  else if (cuenta) { const n = new RegExp(`^${NOMBRE}`).exec(cuenta); if (n) nombre = n[1] }
  for (const t0 of textosCliente) {
    const t = (t0 ?? '').trim()
    const dra = new RegExp(`\\b(?:soy (?:la )?)?(?:[Dd]ra\\.?|[Dd]octora)\\s+${NOMBRE}`).exec(t)
    const dr = new RegExp(`\\b(?:soy (?:el )?)?(?:[Dd]r\\.?|[Dd]octor)\\s+${NOMBRE}`).exec(t)
    if (dra) { trato = 'doctora'; nombre = nombre ?? dra[1] }
    else if (dr && !/\bdoctor(a)?\s+(de|del|que|para|con)\b/i.test(t)) { trato = trato ?? 'doctor'; nombre = nombre ?? dr[1] }
    else if (/\bsoy (la )?(doctora|dra\.?|m[eé]dica)\b/i.test(t)) trato = 'doctora'
    else if (/\bsoy (el )?(doctor|dr\.?)\b/i.test(t)) trato = trato ?? 'doctor'
    const yo = new RegExp(`\\b(?:[Mm]e llamo|[Mm]i nombre es|[Ss]oy)\\s+(?:la |el )?${NOMBRE}(?:\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?\\b`).exec(t)
    if (yo && !/^(dra|dr|doctora|doctor|enfermer[oa]|paciente|cliente|distribuidor[a]?|medic[oa]|dermatolog[oa]|cirujan[oa]|nutriolog[oa]|odontolog[oa]|dentista|esteticista|cosmiatra|de|del|su|tu)$/.test(sinAcentos(yo[1]))) nombre = nombre ?? yo[1]
  }
  return { trato, nombre }
}
export function textoTrato(t: Trato): string {
  if (t.trato && t.nombre) return `TRATO: llámale «${t.trato} ${t.nombre}» o «${t.trato}» con naturalidad (no en cada mensaje).`
  if (t.trato) return `TRATO: trátale de «${t.trato}».`
  if (t.nombre) return `TRATO: puedes llamarle por su nombre, ${t.nombre}; no sabes si es doctora o doctor: no uses ninguno de los dos.`
  return 'TRATO: no sabes su nombre ni si es doctora o doctor: escribe en neutro, sin «doctor(a)», «bienvenido(a)», «verificado(a)» ni vocativos.'
}
/** Determinista: nada de «(a)»; «doctora/doctor» solo si se sabe cuál (si no, se quita el vocativo). */
export function ajustarTrato(texto: string, t: Trato): string {
  let s = texto ?? ''
  const fem = t.trato === 'doctora', masc = t.trato === 'doctor'
  // «doctor(a)», «Dr(a).», «Doctor/a»
  s = s.replace(/\b([Dd])octor\s?\(a\)|\b([Dd])octor\/a\b|\b([Dd])r\(a\)\.?/g, (m) => (fem ? (m[0] === 'D' ? 'Doctora' : 'doctora') : masc ? (m[0] === 'D' ? 'Doctor' : 'doctor') : '\u0000'))
  // palabras con «(a)» u «o/a»: verificado(a), bienvenido(a), listo(a), interesado/a
  s = s.replace(/\b([A-Za-zÁÉÍÓÚáéíóúñÑ]+)o\s?\((a)\)|\b([A-Za-zÁÉÍÓÚáéíóúñÑ]+)o\/a\b/g, (_m, a: string | undefined, _x, b: string | undefined) => {
    const raiz = a ?? b ?? ''
    if (fem) return raiz + 'a'
    if (masc) return raiz + 'o'
    const r = raiz.toLowerCase()
    if (r === 'bienvenid') return raiz[0] === 'B' ? 'Te damos la bienvenida' : 'te damos la bienvenida'
    if (r === 'verificad') return raiz[0] === 'V' ? 'Con tu cuenta verificada' : 'con tu cuenta verificada'
    return raiz + 'o'   // último recurso neutro (raro): mejor sin «(a)»
  })
  // vocativo sin saber el trato: «, doctora,» / «Hola, doctor!» / «Doctora, …» → fuera
  if (!t.trato) s = s.replace(/,\s*(?:doctor|doctora|dra\.?|dr\.?)(?=\s*[,.!?])/gi, '').replace(/^\s*(?:doctor|doctora|dra\.?|dr\.?)\s*,\s*/i, '')
  s = s.replace(/,?\s*\u0000(?=\s*[,.!?])/g, '').replace(/\u0000\s*,?\s*/g, '')
  if (s !== texto) s = s.replace(/[ \t]+([,.!?])/g, '$1').replace(/¡[ \t]*!/g, '').replace(/[ \t]{2,}/g, ' ').trim()   // los saltos de línea se respetan
  return s === texto ? texto : s.charAt(0).toUpperCase() + s.slice(1)
}

// ── TANDA 2 · revisión determinista adicional (se suma a revisarRespuesta) ─────────────────────────────────────────────
export type ProblemaTanda2 = ProblemaAfirmacion | 'niega_imagen' | 'supone_comprobante' | 'enfermeria' | 'tercero'
export interface ContextoTanda2 {
  existencia?: ExistenciaTurno | null
  /** la IA recibió en este turno la imagen o el PDF (visión) */
  adjuntoVisto?: boolean
  /** alguien habló de pagos en lo reciente */
  hablaronDePago?: boolean
  tipo?: TipoContacto | null
  trato?: Trato | null
  /** el equipo (o la IA) ya cotizó con el envío incluido */
  envioIncluido?: boolean
  /** lo que escribió el cliente en este turno */
  rafaga?: string
  /** canal (WhatsApp/Instagram/Messenger): ahí el costo de envío solo se dice si lo pregunta */
  canal?: boolean
  /** el servidor calculó el pedido en este turno (revisar/confirmar pedido): su envío es el bueno y no se toca */
  resumenPedido?: boolean
}
const RE_TERCERO_MAL = /\bmanejamos\b|\bpromoci[oó]n|\bprecio|\bc[eé]dula|\bverific/i
export function revisarTanda2(texto: string, c: ContextoTanda2): { texto: string; problemas: ProblemaTanda2[] } {
  let t = texto ?? ''
  const raf = sinAcentos(c.rafaga ?? '')
  // 7 · motivos inventados y costo de envío que nadie pidió (o que contradice «envío incluido"): se quitan
  t = quitarFrases(t, (f) => RE_MOTIVO_INVENTADO.test(f))
  // (el resumen que calculó el servidor y el «te faltan $X para el envío gratis» del carrito no se tocan)
  if (!c.resumenPedido && (c.envioIncluido || (c.canal && !RE_PREGUNTA_ENVIO.test(raf)))) t = quitarFrases(t, (f) => RE_COSTO_ENVIO.test(f) && !/\bte falta|\bfaltan?\b/i.test(f))
  // 9 · trato
  if (c.trato !== undefined) t = ajustarTrato(t, c.trato ?? { trato: null, nombre: null })
  const problemas = new Set<ProblemaTanda2>()
  for (const p of revisarAfirmaciones(t, c.existencia).problemas) problemas.add(p)
  if (c.adjuntoVisto && RE_NIEGA_VISION.test(t)) problemas.add('niega_imagen')
  if (!c.hablaronDePago && RE_COMPROBANTE.test(t)) problemas.add('supone_comprobante')
  if (c.tipo === 'enfermeria' && (!/m[eé]dic/i.test(t) || /asesor[^.!?]{0,40}(confirma|revisa|valida)|te verifico|m[aá]ndame|c[eé]dula[^.!?]{0,30}aplica/i.test(t))) problemas.add('enfermeria')
  if (c.tipo === 'tercero' && RE_TERCERO_MAL.test(t)) problemas.add('tercero')
  return { texto: t, problemas: [...problemas] }
}
export function notaTanda2(ps: readonly ProblemaTanda2[], ex?: ExistenciaTurno | null): string {
  const m: Record<ProblemaTanda2, string> = {
    afirma_sin_existencia: `afirmaba que tenemos algo que el sistema dice que NO se puede surtir ahora (${(ex?.sinExistencia ?? []).join(', ')}): dilo con claridad y ofrece ${ex?.alternativas.length ? ex.alternativas.slice(0, 2).join(' o ') : 'la alternativa más cercana que regrese buscar_productos'}`,
    afirma_sin_evidencia: 'afirmaba que manejamos algo que no aparece así en el catálogo: no lo afirmes; di que lo confirmas con el equipo y haz UNA pregunta para aclarar',
    niega_imagen: 'decía que no puedes ver la imagen, y sí la estás viendo en este turno: úsala',
    supone_comprobante: 'trataba la imagen como comprobante de pago sin que nadie hablara de pagar: no supongas qué es; si no es claro, pregúntale',
    enfermeria: 'no le dejaba claro que solo vendemos con cédula profesional de médico',
    tercero: 'le hablaba de productos, precios o cédula a alguien que no es cliente (farmacia, paquetería, proveedor)',
  }
  return `\n\nANTES DE RESPONDER (instrucción interna, no la menciones ni pidas disculpas): tu respuesta anterior ${ps.map((p) => m[p]).join('; ')}. Vuelve a responder su último mensaje, corto y directo, como si fuera tu primera respuesta.`
}
/** Si la regeneración tampoco cumplió: quita lo que estaba mal o usa un texto fijo honesto. */
export function corregirTanda2(texto: string, ps: readonly ProblemaTanda2[], c: ContextoTanda2, asesor?: string | null): string {
  if (ps.includes('enfermeria')) return MENSAJE_ENFERMERIA
  if (ps.includes('tercero')) return `Gracias por avisarnos. Le paso su mensaje al equipo para que le confirme lo de la entrega por aquí mismo.`
  let t = texto
  if (ps.includes('afirma_sin_existencia') || ps.includes('afirma_sin_evidencia')) {
    const malas = new Set(revisarAfirmaciones(t, c.existencia).frases)
    const quedan = frases(t).filter((f) => !malas.has(f))
    t = quedan.length && quedan.some((f) => !/\?/.test(f)) ? unir(quedan) : textoRespaldoExistencia(c.existencia ?? existenciaVacia(), asesor)
  }
  if (ps.includes('niega_imagen')) { const q = frases(t).filter((f) => !RE_NIEGA_VISION.test(f)); t = q.length ? unir(q) : '¿Me confirmas qué producto es el de la imagen?' }
  if (ps.includes('supone_comprobante')) { const q = frases(t).filter((f) => !RE_COMPROBANTE.test(f)); t = q.length ? unir(q) : 'Gracias por la imagen. ¿Me cuentas qué necesitas con ella?' }
  return t
}
