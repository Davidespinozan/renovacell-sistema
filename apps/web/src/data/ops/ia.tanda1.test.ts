// IA · TANDA 1 (23 nov 2026, dueño: «DALE») · regresiones sacadas de 34 conversaciones reales (parte A / parte B, «C<n>
// seq<m>»). Proveedor de IA FALSO y base FALSA: sin Anthropic, sin red, sin Meta. Cubre:
//   1 · mensajes seguidos → UNA respuesta (y nunca un mensaje sin responder)
//   2 · cliente reconocido → no se le piden datos; verificación por pasos, nunca en la primera respuesta (R4-B1 intacto)
//   4 · mensajes cortos: sin re-saludo, promo y horario una vez, una pregunta, máx. 3 opciones
//   5 · plan B cuando la persona no llega (SQL: guardas sobre la migración; la lógica se probó en una base desechable)
//   6 · respaldos naturales; números y nombres que escribió el cliente no disparan el bloqueo
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import * as conversacion from '../../../../../supabase/functions/_shared/ia/conversacion'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { REGLAS_IA } from '../../../../../supabase/functions/_shared/conocimiento'

const raiz = resolve(__dirname, '../../../../..')
const migracion = readFileSync(resolve(raiz, 'supabase/migrations/20270407470000_ia_tanda1.sql'), 'utf8')
const webhook = readFileSync(resolve(raiz, 'supabase/functions/meta-webhook/index.ts'), 'utf8')
const responderSrc = readFileSync(resolve(raiz, 'supabase/functions/_shared/ia/responder.ts'), 'utf8')

const CONV = '99999999-9999-4999-8999-999999999999'
const L1 = '11111111-1111-4111-8111-111111111111', N1 = '22222222-2222-4222-8222-222222222222', N2 = '33333333-3333-4333-8333-333333333333'
const CATALOGO = [{ product_id: L1, nombre: 'Linurase 100 UI' }, { product_id: N1, nombre: 'NABOTA 100 UI' }, { product_id: N2, nombre: 'NABOTA 200 UI' }, { product_id: '44444444-4444-4444-8444-444444444444', nombre: 'Botox 100 UI' }, { product_id: '55555555-5555-4555-8555-555555555555', nombre: 'Dysport 500 UI' }, { product_id: '66666666-6666-4666-8666-666666666666', nombre: 'Xeomeen 100 UI' }]
const validacionCanal = { ...validacion, respuestaSegura: validacion.respuestaSeguraCanal }
const politicaCanal = { ...politica, clasificarIntencion: politica.clasificarIntencionCanal, MENSAJE_SIN_RESPUESTA: politica.MENSAJE_SIN_RESPUESTA_CANAL, MENSAJE_LIMITE_CLINICO: politica.MENSAJE_LIMITE_CLINICO_CANAL }
type H = { actor: string; content: string; seq?: number }

function base(o: { handoff?: Record<string, unknown>; responder?: Record<string, unknown>; buscar?: (q: string) => unknown[] } = {}) {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
    llamadas.push({ fn, args })
    switch (fn) {
      case 'cc_ia_contexto_actor': return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      case 'cc_ia_identidad_canal': return { data: null, error: null }   // R4-B1: sin vínculo explícito, el teléfono no da identidad
      case 'cc_ia_media_caja': return { data: [], error: null }
      case 'cc_ia_turno_reclamar': return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:17', attempts: 1 }, error: null }
      case 'cc_ia_estado_handoff': return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active', ...(o.handoff ?? {}) }, error: null }
      case 'cc_catalogo_para_ia': return { data: CATALOGO, error: null }
      case 'cc_buscar_productos': return { data: (o.buscar ?? ((q: string) => CATALOGO.filter((p) => p.nombre.toLowerCase().includes(String(q).toLowerCase().split(' ')[0])).map((p) => ({ ...p, puntaje: 90 }))))(String(args.p_q)), error: null }
      case 'cc_ia_herramienta_registrar': return { data: 'tc', error: null }
      case 'cc_ia_turno_responder': return { data: { persistido: true, idempotente: false, message_id: 'm-ai', seq: 18, ...(o.responder ?? {}) }, error: null }
      case 'cc_ia_turno_fallar': return { data: { estado: 'failed' }, error: null }
      case 'cc_ia_aviso_no_disponible': return { data: null, error: null }
    }
    return { data: null, error: { message: 'fn desconocida ' + fn } }
  }
  return { rpc, llamadas }
}
function deps(db: ReturnType<typeof base>, guion: Parameters<typeof crearProveedorFalso>[0], historial: H[], extra: Partial<DepsOrquestador> = {}, pol = politicaCanal, val = validacionCanal) {
  return {
    rpc: db.rpc, leerMensajes: async () => historial,
    proveedor: crearProveedorFalso(guion), config: { maxTokens: 300, timeoutMs: 45_000, maxRondas: 4, historial: 12 },
    politica: pol, herramientas, validacion: val, reglasConocimiento: REGLAS_IA, conversacion, ...extra,
  } as DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> }
}
const entrada = (texto: string, canal: 'whatsapp' | 'portal' = 'whatsapp', triggerSeq = 17) => ({ conv: CONV, triggerSeq, actor: 'visitor' as const, profile: null, visitorHash: 'h'.repeat(64), textoUsuario: texto, canal })
const persistidos = (db: ReturnType<typeof base>) => db.llamadas.filter((l) => l.fn === 'cc_ia_turno_responder').map((l) => String(l.args.p_content))
const preguntas = (t: string) => (t.match(/\?/g) ?? []).length

// ═══ 1 · MENSAJES SEGUIDOS → UNA RESPUESTA ═════════════════════════════════════════════════════════════════════════════
describe('1 · mensajes seguidos: una sola respuesta, ninguno sin responder', () => {
  it('A·C2 seq4-6 «Tiene linurasse» + «?» + «Tiene linurasse?»: la ráfaga pendiente son los tres', () => {
    const h: H[] = [{ actor: 'visitor', content: 'Hola' }, { actor: 'visitor', content: 'Buen fia' }, { actor: 'ai', content: 'Buen día 😊 ¿En qué te puedo ayudar?' },
      { actor: 'visitor', content: 'Tiene linurasse' }, { actor: 'visitor', content: '?' }, { actor: 'system', content: 'Un asesor de Renovacell revisará tu mensaje.' }, { actor: 'visitor', content: 'Tiene linurasse?' }]
    expect(conversacion.rafagaPendiente(h)).toEqual(['Tiene linurasse', '?', 'Tiene linurasse?'])
    // lo ya contestado (y el aviso del sistema de la ráfaga) queda en el «previo»
    expect(conversacion.historialPrevio(h).map((m) => m.content)).toEqual(['Hola', 'Buen fia', 'Buen día 😊 ¿En qué te puedo ayudar?', 'Un asesor de Renovacell revisará tu mensaje.'])
  })
  it('una reacción, un sticker o una foto del portal no cuentan como «otro mensaje» (el anterior no se queda sin respuesta)', () => {
    for (const t of ['Reaccionó con 👍', 'Envió un sticker por WhatsApp.', 'Mandó algo que WhatsApp no deja ver fuera del teléfono (una encuesta…). Pídele que lo mande de otra forma.', 'Envió una imagen.', 'Envió un video.', 'Envió un documento: receta.pdf.'])
      expect(conversacion.esMensajeSinTurno(t), t).toBe(true)
    for (const t of ['Hola', '?', 'Envió una imagen por WhatsApp.', 'Envió un audio por WhatsApp.', 'Envió un mensaje por WhatsApp.']) expect(conversacion.esMensajeSinTurno(t), t).toBe(false)
    expect(conversacion.hayMensajeQueResponder([{ actor: 'visitor', content: 'Reaccionó con 👍' }])).toBe(false)
    expect(conversacion.hayMensajeQueResponder([{ actor: 'visitor', content: 'Reaccionó con 👍' }, { actor: 'visitor', content: 'Buen día' }])).toBe(true)
    expect(conversacion.hayMensajeQueResponder([{ actor: 'seller', content: 'Hola' }])).toBe(false)
  })
  it('decisión antes de publicar: sin nuevo publica; con nuevo y su turno arrancado cede; si no arranca en 15 s, publica', () => {
    expect(conversacion.decidirPublicar({ hayNuevo: false, turnoNuevo: false, esperadoMs: 0 })).toBe('publicar')
    expect(conversacion.decidirPublicar({ hayNuevo: true, turnoNuevo: true, esperadoMs: 0 })).toBe('ceder')
    expect(conversacion.decidirPublicar({ hayNuevo: true, turnoNuevo: false, esperadoMs: 3_000 })).toBe('esperar')
    expect(conversacion.decidirPublicar({ hayNuevo: true, turnoNuevo: false, esperadoMs: conversacion.ESPERA_TURNO_NUEVO_MS })).toBe('publicar')
    // la espera total (agrupar + turno + espera) cabe holgada en el tiempo de pared de una Edge
    expect(conversacion.AGRUPAR_MS + 45_000 + conversacion.ESPERA_TURNO_NUEVO_MS).toBeLessThan(120_000)
  })
  it('A·C6 seq1-2 «hola» / «buen día»: el turno viejo espera a que arranque el del nuevo mensaje y cede (la base lo descarta)', async () => {
    const db = base({ responder: { persistido: false, motivo: 'superado' } })
    let t = 0; const dormidas: number[] = []; let consultas = 0
    const d = deps(db, [respuestaTexto('¡Hola! ¿En qué te puedo ayudar? 😊')], [{ actor: 'visitor', content: 'hola' }], {
      ahora: () => t,
      esperaPublicar: { hayNuevo: async () => true, turnoNuevo: async () => (++consultas >= 3), dormir: async (ms) => { dormidas.push(ms); t += ms } },
    })
    const r = await ejecutarTurno(entrada('hola', 'whatsapp', 1), d)
    expect(dormidas).toEqual([1000, 1000])            // esperó a que el turno del «buen día» arrancara
    expect(r.estado).toBe('descartada'); expect(r.clase).toBe('superado')   // y cedió: sale UNA respuesta (la del turno nuevo)
  })
  it('si el turno del mensaje nuevo nunca arranca (bot, límite, transferencia), el viejo publica: nadie se queda sin respuesta', async () => {
    const db = base()
    let t = 0
    const d = deps(db, [respuestaTexto('¿En qué te puedo ayudar?')], [{ actor: 'visitor', content: 'hola' }], {
      ahora: () => t, esperaPublicar: { hayNuevo: async () => true, turnoNuevo: async () => false, dormir: async (ms) => { t += ms } },
    })
    const r = await ejecutarTurno(entrada('hola', 'whatsapp', 1), d)
    expect(r.estado).toBe('respondio'); expect(t).toBeGreaterThanOrEqual(conversacion.ESPERA_TURNO_NUEVO_MS); expect(persistidos(db)).toHaveLength(1)
  })
  it('B·C3 seq31-33 «me envían una toxina» + «Xeomeen» + «100 u»: la pre-búsqueda y la intención miran TODA la ráfaga', async () => {
    const db = base()
    const h: H[] = [{ actor: 'ai', content: 'Claro, estamos en Culiacán.' }, { actor: 'visitor', content: 'Si es posible me pueden enviar una toxina a mi consultorio en cuanto puedan?' }, { actor: 'visitor', content: 'Xeomeen' }, { actor: 'visitor', content: '100 u' }]
    const d = deps(db, [respuestaTexto('Va, Xeomeen 100 UI. ¿Cuántas piezas te envío?')], h)
    await ejecutarTurno(entrada('100 u'), d)
    expect(db.llamadas.some((l) => l.fn === 'cc_buscar_productos' && /xeomeen/i.test(String(l.args.p_q)))).toBe(true)
    expect(d.proveedor.solicitudes[0].system).toContain('EL CLIENTE MANDÓ 3 MENSAJES SEGUIDOS')
    expect(persistidos(db)).toEqual(['Va, Xeomeen 100 UI. ¿Cuántas piezas te envío?'])
  })
  it('webhook: 8 s de agrupación (vive en conversacion.ts), también en Instagram/Messenger; responder espera sin leer cc_messages directo', () => {
    expect(conversacion.AGRUPAR_MS).toBe(8_000)
    expect(webhook).toMatch(/if \(await llegoOtroMensaje\(admin, r\.conversation_id, r\.seq\)\) return   \/\/ TANDA 1 · 1 · también en Instagram\/Messenger\n\s*const ia = await responderIA\(admin, r\.conversation_id, r\.seq, 'visitor'/)
    expect(responderSrc).toMatch(/conversacion, esperaPublicar: esperaPublicar\(admin\)/)
    expect(responderSrc).toMatch(/from\('cc_ai_turns'\)\.select\('id'\)\.eq\('conversation_id', conv\)\.gt\('trigger_seq', seq\)\.in\('status', \['provider_running', 'completed'\]\)/)
    expect(responderSrc).toMatch(/if \(r0 === 'superada'\) return 'descartada'/)   // cedió: ni aviso de transferencia ni señal duplicada
  })
})

// ═══ 2 · CLIENTE RECONOCIDO Y VERIFICACIÓN POR PASOS ═══════════════════════════════════════════════════════════════════
describe('2 · cliente reconocido: no se le piden datos (y R4-B1 sigue intacto)', () => {
  it('frases reales de «ya soy cliente / ya compré»', () => {
    for (const t of ['Ya me tienen registrada ya he pedido' /* A·C7 seq11 */, 'Si. Ya he comprado' /* A·C2 seq10 */, 'Ya había realizado pedido con uds' /* A·C9 seq4 */,
      'Holaaa! Ya me conocen ya les he compartido antes mi información' /* B·C3 seq6 */, 'Si ustedes me han surtido siempre y los conocí en un congreso' /* A·C3 seq7 */,
      'Ya me tiene registrada mi cédula es 11172305' /* B·C10 seq5 */, 'Ya me tienen registrada' /* B·C6 seq14 */])
      expect(conversacion.diceSerCliente([t]), t).toBe(true)
    for (const t of ['Hola, quiero comprar botox', 'Me envía promos', 'Ya vi el catálogo']) expect(conversacion.diceSerCliente([t]), t).toBe(false)
  })
  it('WhatsApp ligado por el equipo (customer_id): sin pedir datos, con el nombre de su asesora, sin verificación… y SIN precios ni perfil', async () => {
    const db = base({ handoff: { cliente_reconocido: true, asesor_nombre: 'Alejandra' } })
    const d = deps(db, [respuestaTexto('Va, Alejandra te atiende con tu historial. ¿Cuántas piezas de Linurase necesitas?')], [{ actor: 'visitor', content: 'Cuánto está Linurase' }])
    await ejecutarTurno(entrada('Cuánto está Linurase'), d)
    const s = d.proveedor.solicitudes[0]
    expect(s.system).toContain('CLIENTE RECONOCIDO'); expect(s.system).toContain('Alejandra, de nuestro equipo comercial,'); expect(s.system).toContain('NO le pidas nombre, cédula, correo ni foto')
    expect(s.system).toContain('precios, existencias, pedidos, direcciones y datos de la cuenta siguen sin estar a tu alcance')
    expect(s.tools.map((x) => x.name)).not.toContain('solicitar_verificacion')
    // R4-B1: la IA sigue siendo audiencia pública (el teléfono no da identidad) y nunca hubo evidencia de precio
    expect(db.llamadas.find((l) => l.fn === 'cc_ia_contexto_actor')!.args).toEqual({ p_profile: null })
    expect(db.llamadas.some((l) => l.fn === 'cc_ia_perfil_comercial' || l.fn === 'cc_ia_precio')).toBe(false)
    expect(validacion.validarRespuesta('Te queda en $1,620.', { evidencia: [], nombresAutorizados: [], nombresCatalogo: [], limiteClinico: false })).toMatchObject({ ok: false, motivo: 'precio_sin_evidencia' })
  })
  it('A·C7 seq9-11: si aun así pide los datos, una regeneración; si insiste, el respaldo natural con su asesora', async () => {
    const db = base({ handoff: { cliente_reconocido: true, asesor_nombre: 'Alejandra' } })
    const pide = 'Para darte precio, ¿me pasas tu nombre completo, tu número de cédula profesional y tu correo?'
    const d = deps(db, [respuestaTexto(pide), respuestaTexto(pide)], [{ actor: 'ai', content: 'Sí manejamos Linurase 100 UI.' }, { actor: 'visitor', content: 'Ya me tienen registrada ya he pedido' }])
    await ejecutarTurno(entrada('Ya me tienen registrada ya he pedido'), d)
    expect(d.proveedor.solicitudes).toHaveLength(2); expect(d.proveedor.solicitudes[1].system).toContain('le pedía datos a un cliente que ya conocemos')
    expect(persistidos(db)).toEqual([conversacion.textoReconocidoRespaldo('Alejandra')])
    expect(persistidos(db)[0]).not.toMatch(/c[eé]dula|correo|foto/i)
  })
  it('el cliente que DICE ser cliente (sin vínculo): no se le piden datos, pero la herramienta de verificación sigue (si él la manda)', async () => {
    const db = base()
    const d = deps(db, [respuestaTexto('Qué gusto. Te atiende el equipo comercial con tu historial. ¿Qué producto necesitas?')], [{ actor: 'ai', content: 'Hola, ¿en qué te ayudo?' }, { actor: 'visitor', content: 'Ya había realizado pedido con uds' }])
    await ejecutarTurno(entrada('Ya había realizado pedido con uds'), d)
    expect(d.proveedor.solicitudes[0].system).toContain('dice que ya nos ha comprado')
    expect(d.proveedor.solicitudes[0].tools.map((x) => x.name)).toContain('solicitar_verificacion')
  })
  it('en el portal (sesión) no aplica: ni bloque ni filtro', async () => {
    const db = base({ handoff: { cliente_reconocido: true, asesor_nombre: 'Alejandra' } })
    const d = deps(db, [respuestaTexto('Hola, ¿en qué te ayudo?')], [{ actor: 'visitor', content: 'hola' }], {}, politica as never, validacion as never)
    await ejecutarTurno(entrada('hola', 'portal'), d)
    expect(d.proveedor.solicitudes[0].system).not.toContain('CLIENTE RECONOCIDO')
  })
  it('verificación por pasos en el prompt del canal: nunca en la primera respuesta, primero la cédula, una sola vez', () => {
    const c = politica.contextoCanal('whatsapp')
    for (const x of ['VERIFICACIÓN POR PASOS', 'NUNCA en tu primera respuesta', 'una sola vez por conversación', 'primero pide solo su número de cédula profesional', 'la foto de su cédula es opcional', 'no confirmes ni niegues si existe una cuenta']) expect(c, x).toContain(x)
    expect(c).not.toContain('en un solo mensaje cordial su nombre completo, su número de cédula profesional, su correo y una foto')
    for (const i of ['PRICE', 'CHECKOUT']) expect(politica.tareaCanal(i, false), i).not.toMatch(/en UN mensaje nombre completo|pide nombre completo, cédula profesional, correo y foto/)
  })
  const est = (o: Partial<conversacion.EstadoConversacion> = {}): conversacion.EstadoConversacion => ({ yaSaludo: true, promoDicha: false, horarioDicho: false, pedidosCedula: 0, respuestasIA: 1, dijoCliente: false, ...o })
  const ctx = (o: Partial<conversacion.ContextoRevision> = {}): conversacion.ContextoRevision => ({ estado: est(), rafaga: '', verificarDatos: true, reconocido: false, limite: conversacion.LIMITE_CANAL, ...o })
  it('A·C10 seq4: pedir los datos en la PRIMERA respuesta se corrige', () => {
    const t = 'Sí manejamos Botox 100 UI. Por este chat te puedo verificar: mándame tu nombre completo, tu número de cédula profesional, tu correo y una foto de tu cédula.'
    expect(conversacion.revisarRespuesta(t, ctx({ estado: est({ yaSaludo: false, respuestasIA: 0 }), rafaga: 'Hola buen día\nTienen disponible\nBotox' })).problemas).toContain('pide_datos_primera')
    expect(conversacion.recortar(t, ctx({ estado: est({ respuestasIA: 0 }) }))).toBe('Sí manejamos Botox 100 UI.')
  })
  it('B·C3 seq5: los cuatro datos de golpe → solo la cédula', () => {
    const t = 'Sí manejamos el HYDRA PEN H5. ¿Me compartes tu nombre completo, número de cédula profesional, correo y una foto de tu cédula?'
    expect(conversacion.revisarRespuesta(t, ctx()).problemas).toContain('pide_datos_todos')
    expect(conversacion.recortar(t, ctx())).toBe('Sí manejamos el HYDRA PEN H5. ¿Me compartes tu número de cédula profesional?')
  })
  it('no vuelve a pedir la cédula que ya pidió; si el cliente está mandando sus datos, pedir el que falta es correcto', () => {
    expect(conversacion.revisarRespuesta('¿Me pasas tu número de cédula?', ctx({ estado: est({ pedidosCedula: 1 }) })).problemas).toContain('pide_cedula_repetida')
    expect(conversacion.revisarRespuesta('Gracias. ¿Me pasas tu correo?', ctx({ estado: est({ pedidosCedula: 1 }), rafaga: 'Cp.14934850' })).problemas).toEqual([])
    // mencionar la verificación no es pedir datos
    expect(conversacion.datosPedidos('Los precios son para profesionales con cédula verificada.').size).toBe(0)
    expect(conversacion.datosPedidos('¿Me dices el nombre del producto?').size).toBe(0)
  })
})

// ═══ 4 · MENSAJES CORTOS Y NATURALES ═══════════════════════════════════════════════════════════════════════════════════
describe('4 · forma: corto, una pregunta, sin repetir saludo, promo ni horario', () => {
  const est = (o: Partial<conversacion.EstadoConversacion> = {}): conversacion.EstadoConversacion => ({ yaSaludo: true, promoDicha: false, horarioDicho: false, pedidosCedula: 0, respuestasIA: 2, dijoCliente: false, ...o })
  const ctx = (o: Partial<conversacion.ContextoRevision> = {}): conversacion.ContextoRevision => ({ estado: est(), rafaga: '', verificarDatos: false, reconocido: false, limite: conversacion.LIMITE_CANAL, nombresProducto: CATALOGO.map((p) => p.nombre), ...o })
  it('A·C8 seq6 «¡Buena tarde de nuevo!»: nunca vuelve a saludar', () => {
    expect(conversacion.sinSaludo('¡Buena tarde de nuevo! ¿En qué le puedo ayudar?')).toBe('¿En qué le puedo ayudar?')
    expect(conversacion.sinSaludo('¡Hola, Blanca! Sí manejamos Linurase 100 UI.')).toBe('Sí manejamos Linurase 100 UI.')
    expect(conversacion.sinSaludo('Hola, sí manejamos Linurase.')).toBe('Sí manejamos Linurase.')
    expect(conversacion.sinSaludo('¡Hola! Qué gusto saludarte. ¿En qué te puedo ayudar?')).toBe('¿En qué te puedo ayudar?')
    expect(conversacion.sinSaludo('Sí manejamos Linurase.')).toBe('Sí manejamos Linurase.')
  })
  it('estado de la conversación: saludo, promo (también del vendedor), horario (también del aviso del sistema), cédula pedida', () => {
    const e = conversacion.estadoConversacion([{ actor: 'visitor', content: 'Hola' }, { actor: 'ai', content: '¡Hola! Ahorita está el Mayoreo Especial Buen Fin. ¿Me pasas tu número de cédula?' },
      { actor: 'system', content: 'Nuestro equipo de asesores no está disponible en este momento.' }])
    expect(e).toEqual({ yaSaludo: true, promoDicha: true, horarioDicho: true, pedidosCedula: 1, respuestasIA: 1, dijoCliente: false })
    expect(conversacion.estadoConversacion([{ actor: 'seller', content: 'Comparto precios de Buen Fin' }]).promoDicha).toBe(true)
    expect(conversacion.estadoConversacion([])).toEqual({ yaSaludo: false, promoDicha: false, horarioDicho: false, pedidosCedula: 0, respuestasIA: 0, dijoCliente: false })
  })
  it('B·C6 seq11-13: la promo y el horario ya dichos se quitan (salvo que pregunte por ellos)', () => {
    const t = 'Perfecto, quedan anotadas 10 piezas de NABOTA 100 UI y 10 de NABOTA 200 UI. Ambas entran en el Mayoreo Especial Buen Fin hasta el 17 de noviembre. Hoy domingo estamos cerrados y se reanuda el lunes. ¿A qué ciudad te las enviamos?'
    const r = conversacion.revisarRespuesta(t, ctx({ estado: est({ promoDicha: true, horarioDicho: true }), rafaga: '10 de 100 y 10 de 200' }))
    expect(r.texto).toBe('Perfecto, quedan anotadas 10 piezas de NABOTA 100 UI y 10 de NABOTA 200 UI. ¿A qué ciudad te las enviamos?')
    expect(r.problemas).toEqual([])
    // si pregunta por la promo, se queda
    expect(conversacion.revisarRespuesta(t, ctx({ estado: est({ promoDicha: true }), rafaga: '¿y sigue la promo?' })).texto).toContain('Buen Fin')
  })
  it('A·C0 seq2 (637 caracteres: catálogo + promo + pregunta): larga y con lista → regenerar; si no, recorte a ≤ límite con UNA pregunta', () => {
    const t = '¡Buen día! Con gusto. Manejamos toxinas botulínicas, rellenos e implantes, bioestimuladores, péptidos, vitaminas y minerales inyectables, metabólicos, anestésicos y aparatología como microagujas y dermapen. Ahorita tenemos el Mayoreo Especial Buen Fin, vigente hasta el 17 de noviembre. Aplica en varios productos, entre ellos toxinas como Botox 100 UI, Dysport 500 UI y NABOTA 100 UI, rellenos como RADIESSE y HArmonyCa, SkinVive, líneas Xelaju, Golden Placenta, vitaminas inyectables, NAD+ y microagujas. Los precios y el detalle los ve un profesional verificado o te los da un asesor. ¿Hay alguna línea que te interese para darte más información? ¿O prefieres el catálogo?'
    const c = ctx({ estado: est({ yaSaludo: false, respuestasIA: 0 }) })
    const r = conversacion.revisarRespuesta(t, c)
    expect(r.problemas).toEqual(expect.arrayContaining(['larga', 'opciones', 'preguntas']))
    const f = conversacion.recortar(r.texto, c)
    expect(f.length).toBeLessThanOrEqual(conversacion.LIMITE_CANAL + 40); expect(preguntas(f)).toBe(1); expect(f).toContain('¿O prefieres el catálogo?')
  })
  it('cierre genérico «¿En qué más te puedo ayudar?» sobra si ya dijo algo', () => {
    expect(conversacion.revisarRespuesta('Sí manejamos Xeomeen 100 UI. ¿En qué más te puedo ayudar?', ctx()).texto).toBe('Sí manejamos Xeomeen 100 UI.')
    expect(conversacion.revisarRespuesta('¿En qué te puedo ayudar?', ctx()).texto).toBe('¿En qué te puedo ayudar?')
  })
  it('reglas de forma en el prompt (todas las respuestas) y en el canal', () => {
    for (const x of ['280 caracteres', 'UNA sola pregunta', 'como mucho 3', 'una sola vez por conversación', 'nunca «doctor(a)»']) expect(conversacion.ESTILO_MENSAJE, x).toContain(x)
    expect(politica.contextoCanal('whatsapp')).toContain('máximo 280 caracteres (2 o 3 líneas) y una sola pregunta')
    expect(politica.contextoCanal('whatsapp')).toContain('si ya hubo saludo, no vuelvas a saludar')
    expect(politica.contextoCanal('whatsapp')).toContain('menciónalas UNA sola vez por conversación')
    expect(politica.contextoCanal('whatsapp')).not.toContain('1500 caracteres')
    const b = conversacion.textoEstadoConversacion(est({ promoDicha: true, horarioDicho: true }), { rafaga: 2, verificarDatos: true })
    for (const x of ['2 MENSAJES SEGUIDOS', 'no vuelvas a saludar', 'LA PROMOCIÓN YA SE MENCIONÓ', 'EL HORARIO YA SE DIJO']) expect(b, x).toContain(x)
  })
  it('orquestador · B·C1 seq2 (larga): UNA regeneración con nota interna y publica la corta; el cliente nunca ve la larga', async () => {
    const db = base()
    const larga = 'Sí, el Mayoreo Especial Buen Fin está vigente hasta el 17 de noviembre. ' + 'Aplica en toxinas, rellenos, bioestimuladores, péptidos, vitaminas y aparatología. '.repeat(4) + '¿Cuál te interesa?'
    const d = deps(db, [respuestaTexto(larga), respuestaTexto('Sí, el Mayoreo Especial Buen Fin sigue hasta el 17 de noviembre. ¿Qué producto te interesa?')], [{ actor: 'ai', content: '¡Hola! ¿En qué te ayudo?' }, { actor: 'visitor', content: 'Me podrías enviar las promos del buen fin' }])
    await ejecutarTurno(entrada('Me podrías enviar las promos del buen fin'), d)
    expect(d.proveedor.solicitudes).toHaveLength(2); expect(d.proveedor.solicitudes[1].system).toContain('quedó demasiado larga')
    expect(persistidos(db)).toEqual(['Sí, el Mayoreo Especial Buen Fin sigue hasta el 17 de noviembre. ¿Qué producto te interesa?'])
    expect(db.llamadas.some((l) => l.fn === 'cc_ia_herramienta_registrar' && l.args.p_tool === 'revision_estilo')).toBe(true)
  })
  it('orquestador · sin tiempo para regenerar: recorte determinista (nunca un turno fallido por la forma)', async () => {
    const db = base()
    let t = 0
    const larga = 'Sí manejamos NABOTA 100 UI y NABOTA 200 UI. ' + 'Es una toxina de venta exclusiva para profesionales verificados y la enviamos a todo el país por paquetería. '.repeat(3) + '¿Cuántas piezas necesitas?'
    const d = deps(db, [async () => { t = 30_000; return respuestaTexto(larga) }], [{ actor: 'ai', content: 'Hola' }, { actor: 'visitor', content: 'Nabota' }], { ahora: () => t })
    const r = await ejecutarTurno(entrada('Nabota'), d)
    expect(r.estado).toBe('respondio'); expect(d.proveedor.solicitudes).toHaveLength(1)
    expect(persistidos(db)[0].length).toBeLessThanOrEqual(conversacion.LIMITE_CANAL + 40); expect(persistidos(db)[0]).toMatch(/¿Cuántas piezas necesitas\?$/)
  })
  it('orquestador · A·C8 seq5-6: «Holaa» a media conversación → sin «¡Buena tarde de nuevo!»', async () => {
    const db = base()
    const d = deps(db, [respuestaTexto('¡Buena tarde de nuevo! ¿En qué le puedo ayudar?')], [{ actor: 'visitor', content: 'Buena tarde' }, { actor: 'ai', content: 'Buena tarde. Nuestra sucursal está en Culiacán.' }, { actor: 'visitor', content: 'Holaa' }])
    await ejecutarTurno(entrada('Holaa'), d)
    expect(persistidos(db)).toEqual(['¿En qué le puedo ayudar?'])
  })
})

// ═══ 5 · PLAN B (SQL) ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('5 · plan B cuando la persona no llega (migración 20270407470000)', () => {
  const sql = migracion.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
  it('corre dentro del cron que ya existe (renovacell-atencion-comercial → cc_atencion_evaluar), sin cron nuevo', () => {
    expect(sql).toMatch(/'en_cola'', n_cola, ''plan_b'', public\._cc_ia_plan_b\(\)\);'\);/)
    expect(sql).not.toMatch(/cron\.schedule/)
  })
  it('solo si NINGUNA persona escribió desde el traspaso (un vendedor que «se unió» sin escribir no llegó) y tras 10 min hábiles', () => {
    expect(sql).toMatch(/m\.actor_type in \('seller', 'admin'\) and m\.created_at >= least\(v_h, v_ref\)/)
    expect(sql).toMatch(/continue when v_abierto and v_min < 10;/)
    expect(sql).toMatch(/v_min := coalesce\(public\._cc_minutos_habiles\(v_h, now\(\)\), 0\);/)
    expect(sql).toMatch(/r\.modo = 'human_active' and r\.asesoria_iniciada_at > now\(\) - interval '10 minutes'/)   // recién unido: sus 10 min
    expect(sql).toMatch(/perform public\._cc_cambiar_modo\(r\.id, 'human_assigned', 'human_assigned', 'system'/)      // se unió sin escribir → asignada
  })
  it('una vez por traspaso, máximo una cada 3 h; la IA calla si sigue atendiendo; respeta el canal', () => {
    expect(sql).toMatch(/v_key := 'tpl:planb:'/); expect(sql).toMatch(/interval '3 hours'/)
    expect(sql).toMatch(/m\.actor_type = 'ai' and m\.created_at > now\(\) - interval '10 minutes'/)
    expect(sql).toMatch(/continue when not public\._cc_ia_permitida_en\(r\.id\);/)
  })
  it('alerta interna al vendedor asignado Y a Dirección con el tipo de escalación que ya existe (push incluido)', () => {
    expect(sql).toMatch(/_cc_notificar\('handoff_escalado', r\.id, case when r\.seller_profile_id is not null then array\[r\.seller_profile_id\] end, array\['admin'\]/)
  })
  it('textos: corto, una pregunta en horario; fuera de horario dice cuándo lo atienden (sin prometer «en un momento»)', () => {
    const textos = [...migracion.matchAll(/'((?:Perdón|Ahorita|Para adelantar|Si me)[^']*)'/g)].map((m) => m[1])
    expect(textos.length).toBeGreaterThanOrEqual(5)
    for (const t of textos) expect(t, t).not.toMatch(/en un momento|enseguida|de inmediato|doctor\(a\)|\$\s?\d/)
    expect(migracion).toContain("'Ahorita estamos fuera de horario; ' || v_quien || ' te atiende ' || v_cuando")
  })
  it('la IA no habla encima de una persona que escribió hace < 10 min (cc_ia_turno_reclamar)', () => {
    expect(migracion).toContain("v_humano := c.modo not in (''ai_active'', ''human_ended'') and exists (select 1 from public.cc_messages h where h.conversation_id = p_conv")
    expect(migracion).toContain("when v_humano then ''humano_reciente''")
  })
  it('cliente reconocido sale del servidor (customer_id / profile_id) junto con el primer nombre del asesor', () => {
    expect(migracion).toContain("''cliente_reconocido'', (c.customer_id is not null or c.profile_id is not null),")
    expect(migracion).toContain("''asesor_nombre'', public._cc_ia_asesor_nombre(p_conv));")
    expect(sql).toMatch(/revoke all on function public\._cc_ia_asesor_nombre\(uuid\) from public, anon, authenticated;/)
    expect(sql).toMatch(/revoke all on function public\._cc_ia_plan_b\(\) from public, anon, authenticated;/)
  })
  it('examen: casos nuevos de la Tanda 1 con ids válidos', () => {
    const ids = [...migracion.matchAll(/\('(CV\d{2})', 'conversacion'/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThanOrEqual(10); for (const id of ids) expect(id).toMatch(/^[A-Z]{1,3}[0-9]{2,3}$/)
    expect(migracion).toMatch(/on conflict \(id\) do nothing;/)
  })
})

// ═══ 6 · RESPALDOS NATURALES Y FALSOS BLOQUEOS ══════════════════════════════════════════════════════════════════════════
describe('6 · respaldos que avanzan la venta; números y nombres del cliente no bloquean', () => {
  const c = { limiteClinico: false, evidencia: [] as string[], textoLimiteClinico: politica.MENSAJE_LIMITE_CLINICO_CANAL, textoGenerico: politica.MENSAJE_SIN_RESPUESTA_CANAL }
  it('B·C10 seq6: tras dar su cédula ya no recibe «Prefiero no afirmar nada de un producto que no consulté»', () => {
    const t = validacion.respuestaSeguraCanal('producto_no_autorizado', { ...c, rafaga: 'Ya me tiene registrada mi cédula es 11172305' })
    expect(t).not.toMatch(/Prefiero no afirmar|no consulté/); expect(t).toMatch(/^Gracias/); expect(preguntas(t)).toBe(1)
  })
  it('A·C15 seq4: «¿llega mañana si les pido Nabota?» ya no recibe «Por este medio no registro pedidos ni carritos»', () => {
    const t = validacion.respuestaSeguraCanal('pedido_sin_evidencia', { ...c, rafaga: 'Disculpen si les hago un pedido ahorita de Nabota si llega para el día de mañana?' })
    expect(t).not.toMatch(/no registro pedidos|portal/); expect(t).toContain('aquí mismo te ayudo con tu pedido'); expect(preguntas(t)).toBe(1)
  })
  it('B·C7 seq10: «Tnm» + «Porfavor.» (nadie preguntó precio) ya no recibe «Por este medio no puedo darte precios»', () => {
    const t = validacion.respuestaSeguraCanal('precio_sin_evidencia', { ...c, rafaga: 'Tnm\nPorfavor.' })
    expect(t).not.toMatch(/precio|portal|no puedo/i)
    // si SÍ preguntó precio, lo dice en positivo y avanza
    expect(validacion.respuestaSeguraCanal('precio_sin_evidencia', { ...c, rafaga: '¿cuánto cuesta?' })).toContain('El precio te lo doy en cuanto quede verificado tu registro')
    expect(validacion.respuestaSeguraCanal('precio_sin_evidencia', { ...c, rafaga: '¿cuánto cuesta?', reconocido: true, asesor: 'Alejandra' })).toContain('te lo da Alejandra con tu historial')
  })
  it('ningún respaldo del canal espanta, cifra, promete tiempos ni usa «(a)»', () => {
    for (const m of ['precio_sin_evidencia', 'stock_sin_evidencia', 'producto_no_autorizado', 'pedido_sin_evidencia', 'carrito_mutacion_sin_evidencia', 'carrito_lectura_sin_evidencia', 'promesa_humano_sin_evidencia', 'vacia', 'larga', 'rondas']) {
      for (const extra of [{}, { reconocido: true, asesor: 'Lucía' }, { rafaga: '11172305' }]) {
        const t = validacion.respuestaSeguraCanal(m, { ...c, ...extra })
        expect(t, m).not.toMatch(/Prefiero no afirmar|Por este medio no|No tengo esa información aprobada|en un momento|enseguida|\(a\)|\$\s?\d/)
        expect(t.length, m).toBeLessThanOrEqual(280)
      }
    }
    expect(politica.MENSAJE_SIN_RESPUESTA_CANAL).toBe('Déjame confirmarlo con el equipo para no darte un dato equivocado. Mientras, ¿qué producto y cuántas piezas necesitas?')
  })
  it('precio_sin_evidencia solo con un monto de verdad («cuesta 2 días», «precio de 1 pieza» no son montos)', () => {
    const v = (t: string) => validacion.validarRespuesta(t, { evidencia: [], nombresAutorizados: [], nombresCatalogo: [], limiteClinico: false })
    for (const t of ['Por paquetería cuesta 2 días que llegue.', 'El precio de 1 pieza te lo da tu asesora.', 'Tu cédula 11172305 quedó anotada.']) expect(v(t), t).toMatchObject({ ok: true })
    for (const t of ['Cuesta $4,000 la pieza.', 'Te queda en 3500 pesos.', 'El precio es de 1620.']) expect(v(t), t).toMatchObject({ ok: false, motivo: 'precio_sin_evidencia' })
  })
  it('un «nombre» de catálogo que solo son cifras/medidas nunca bloquea (una cédula no es un producto)', () => {
    expect(validacion.validarRespuesta('Gracias, tu cédula 1117 2305 quedó anotada.', { evidencia: [], nombresAutorizados: [], nombresCatalogo: ['1117 2305', '4.5 ML'], limiteClinico: false })).toMatchObject({ ok: true })
  })
  it('A·C7 seq5 «Me intensa Linurase»: el nombre que escribió el cliente cuenta como consultado; una cédula no autoriza nada', () => {
    expect(conversacion.nombresQueEscribioElCliente(CATALOGO.map((p) => p.nombre), ['Me intensa Linurase'])).toEqual(['Linurase 100 UI'])
    expect(conversacion.nombresQueEscribioElCliente(CATALOGO.map((p) => p.nombre), ['Ya me tiene registrada mi cédula es 11172305'])).toEqual([])
    expect(conversacion.nombresQueEscribioElCliente(['IMPLANTE COSMETICO 4.5 ML Piel', 'ULTRAFILTRADO GOLDEN V 2.5 ml'], ['quiero un implante cosmetico'])).toEqual([])
  })
  it('orquestador · A·C1 seq17 «Quisiera comprar Nabota»: el cliente lo escribió → la respuesta pasa a la primera (antes: «Prefiero no afirmar…»)', async () => {
    const db = base({ buscar: () => [] })   // ni siquiera la pre-búsqueda lo encontró
    const d = deps(db, [respuestaTexto('Sí manejamos NABOTA 100 UI y NABOTA 200 UI. ¿Cuál presentación y cuántas piezas?')],
      [{ actor: 'ai', content: '¡Hola! ¿En qué te ayudo?' }, { actor: 'visitor', content: 'Quisiera comprar Nabota' }])
    await ejecutarTurno(entrada('Quisiera comprar Nabota'), d)
    expect(d.proveedor.solicitudes).toHaveLength(1)
    expect(persistidos(db)).toEqual(['Sí manejamos NABOTA 100 UI y NABOTA 200 UI. ¿Cuál presentación y cuántas piezas?'])
  })
  it('orquestador · nombra un producto que nadie consultó ni escribió → el SERVIDOR lo busca y vuelve a responder con el catálogo (sin respaldo)', async () => {
    const db = base({ buscar: (q) => /nabota/i.test(q) ? CATALOGO.filter((p) => /NABOTA/.test(p.nombre)) : [] })
    const d = deps(db, [respuestaTexto('¡Claro! NABOTA 200 UI es excelente.'), respuestaTexto('Sí manejamos NABOTA 100 UI y NABOTA 200 UI. ¿Cuál presentación y cuántas piezas?')],
      [{ actor: 'ai', content: '¡Hola! ¿En qué te ayudo?' }, { actor: 'visitor', content: 'Quisiera comprar toxina' }], {}, { ...politicaCanal, prebuscarProductos: async () => [] })
    await ejecutarTurno(entrada('Quisiera comprar toxina'), d)
    expect(d.proveedor.solicitudes).toHaveLength(2)
    expect(d.proveedor.solicitudes[1].system).toContain('consulté «NABOTA 200 UI» en el catálogo por ti')
    expect(db.llamadas.some((l) => l.fn === 'cc_ia_herramienta_registrar' && l.args.p_tool === 'buscar_productos' && (l.args.p_detalle as { origen?: string }).origen === 'respaldo')).toBe(true)
    expect(persistidos(db)).toEqual(['Sí manejamos NABOTA 100 UI y NABOTA 200 UI. ¿Cuál presentación y cuántas piezas?'])
  })
})

describe('2 · el asesor del cliente reconocido se entera (señal de interés existente, una por hora)', () => {
  it('responder.ts manda cc_senal_interes «cliente_reconocido» cuando la IA respondió a un cliente reconocido en canal', () => {
    expect(responderSrc).toMatch(/if \(!comercial && canal !== 'portal' && r === 'respondio' && info\.reconocido\) \{\n\s*await admin\.rpc\('cc_senal_interes', \{ p_conv: conv, p_motivo: 'cliente_reconocido' \}\)/)
  })
  it('el orquestador marca el turno como reconocido (solo canal sin vínculo)', async () => {
    const db = base({ handoff: { cliente_reconocido: true, asesor_nombre: 'Alejandra' } })
    const r = await ejecutarTurno(entrada('hola'), deps(db, [respuestaTexto('¿Qué producto necesitas?')], [{ actor: 'ai', content: 'Hola' }, { actor: 'visitor', content: 'hola' }]))
    expect(r.reconocido).toBe(true)
    const db2 = base({ handoff: { cliente_reconocido: true } })
    const r2 = await ejecutarTurno(entrada('hola', 'portal'), deps(db2, [respuestaTexto('¿Qué producto necesitas?')], [{ actor: 'visitor', content: 'hola' }], {}, politica as never, validacion as never))
    expect(r2.reconocido).toBeUndefined()
  })
})
