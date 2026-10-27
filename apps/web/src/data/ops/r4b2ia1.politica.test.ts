// R4-B2-IA1 · Política comercial IA-first de canal (WhatsApp/Instagram/Messenger). Proveedor de IA FALSO y base FALSA:
// sin Anthropic, sin red, sin Meta. Comprueba: clasificador del canal sin falsos positivos y con solicitudes explícitas
// (variaciones y negaciones), transferencia determinista (persona / pedido-reclamación) e idempotente, tarea y contexto del
// canal (precio y existencias orientan al portal, sin cifras), el flujo completo del orquestador con la política de canal,
// mensajes seguros sin promesas y el PORTAL idéntico a su línea base.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { REGLAS_IA } from '../../../../../supabase/functions/_shared/conocimiento'
import { URL_SISTEMA } from '../../../../../supabase/functions/_shared/invitacion'
import { responderIA } from '../../../../../supabase/functions/_shared/ia/responder'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'

const A = '11111111-1111-4111-8111-111111111111', CONV = '99999999-9999-4999-8999-999999999999'
const validacionCanal = { ...validacion, respuestaSegura: validacion.respuestaSeguraCanal }
const politicaCanal = { ...politica, clasificarIntencion: politica.clasificarIntencionCanal, MENSAJE_SIN_RESPUESTA: politica.MENSAJE_SIN_RESPUESTA_CANAL, MENSAJE_LIMITE_CLINICO: politica.MENSAJE_LIMITE_CLINICO_CANAL }

describe('portal: idéntico a su línea base (antes de R4-B2-IA1)', () => {
  it('clasificarIntencion del portal da exactamente lo mismo', () => {
    const base: Record<string, string> = { 'hola': 'GENERAL_CHAT', '¿tienen WhatsApp?': 'HUMAN_REQUEST', 'soy persona de compras': 'HUMAN_REQUEST', 'quiero hablar con un asesor': 'HUMAN_REQUEST',
      '¿cuánto cuesta el hyalux?': 'PRICE', '¿hay existencias?': 'UNKNOWN', 'mi pedido no llega': 'ORDER_STATUS', 'quiero comprar 3': 'CHECKOUT', 'compara hyalux y deep': 'UNKNOWN',
      'qué es el s2rm': 'PRODUCT_INFO', '¿qué dosis le aplico a mi paciente?': 'CLINICAL_BOUNDARY', 'llamar': 'HUMAN_REQUEST', 'alguien me ayuda': 'HUMAN_REQUEST', 'no necesito asesor': 'HUMAN_REQUEST',
      'agrega 2 al carrito': 'CART_ADD', 'busco rellenos': 'PRODUCT_DISCOVERY', '': 'UNKNOWN' }
    for (const [f, i] of Object.entries(base)) expect(politica.clasificarIntencion(f), f).toBe(i)
  })
  it('el prompt del portal y sus mensajes no cambian (huella)', () => {
    const ctxs = [{ actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }]
    const h = createHash('md5')
    for (const c of ctxs) for (const i of ['GENERAL_CHAT', 'PRICE', 'HUMAN_REQUEST', 'CHECKOUT', 'ORDER_STATUS', 'UNKNOWN', 'CLINICAL_BOUNDARY']) for (const e of [[], ['HANDOFF_EN_CURSO', 'FUERA_DE_HORARIO'], ['PRICE_EVIDENCE']])
      h.update(politica.construirSistema({ ctx: c, intencion: i, limiteClinico: i === 'CLINICAL_BOUNDARY', reglasConocimiento: ['R1', 'R2'], evidencia: e }))
    expect(h.digest('hex')).toBe('eefce30b09867d3cc2a1f6d48048bc81')
    expect(createHash('md5').update(politica.MENSAJE_SIN_RESPUESTA + '|' + politica.MENSAJE_LIMITE_CLINICO).digest('hex')).toBe('a80fa072fa6a2330676fe4a1716d30d1')
  })
})

describe('canal: falsos positivos eliminados y solicitudes explícitas reconocidas', () => {
  const noPideHumano = ['WhatsApp', '¿Tienen WhatsApp?', 'persona', 'Persona', 'alguien', 'Alguien', 'llamar', 'Soy persona de compras', '¿Cuánto cuesta este producto?', '¿Hay existencias?',
    'No necesito asesor', 'no necesito un asesor, solo el precio', 'no quiero que me llamen', 'sin asesor por favor', 'Mi asistente me pidió información', '¿A qué número puedo llamar?', 'Hola, ¿cómo están?']
  for (const f of noPideHumano) it(`NO es solicitud de persona: «${f}»`, () => {
    expect(politica.esSolicitudHumanaExplicita(f)).toBe(false)
    expect(politica.clasificarIntencionCanal(f)).not.toBe('HUMAN_REQUEST')
  })
  const pideHumano = ['Quiero hablar con un asesor', 'quiero hablar con una asesora', '¿Me puede atender una persona?', '¿me pueden atender una persona?', 'Pásame con alguien de ventas', 'pasame con un vendedor',
    'Quiero que me llamen', '¿pueden marcarme? quiero que me marquen', 'Necesito atención humana', 'Quisiera atención personalizada', 'necesito un asesor', 'prefiero un humano',
    'Comunícame con un ejecutivo', '¿Hay alguien que me atienda?', 'no quiero hablar con un bot', 'NO, quiero hablar con un asesor', 'Me gustaría hablar con alguien de Renovacell']
  for (const f of pideHumano) it(`SÍ es solicitud de persona: «${f}»`, () => {
    expect(politica.esSolicitudHumanaExplicita(f)).toBe(true)
    expect(politica.clasificarIntencionCanal(f)).toBe('HUMAN_REQUEST')
  })
  it('intenciones del canal: precio, existencias, comparación, compra, pedido/reclamación, clínico, producto', () => {
    expect(politica.clasificarIntencionCanal('¿Cuánto cuesta este producto?')).toBe('PRICE')
    expect(politica.clasificarIntencionCanal('¿Manejan mayoreo o crédito?')).toBe('CHECKOUT')   // R4-C7 · negociación = atención comercial
    expect(politica.clasificarIntencionCanal('¿Hay existencias?')).toBe('AVAILABILITY')
    expect(politica.clasificarIntencionCanal('compara hyalux y deep')).toBe('PRODUCT_COMPARE')
    expect(politica.clasificarIntencionCanal('quiero comprar 3 cajas por aquí')).toBe('CHECKOUT')
    expect(politica.clasificarIntencionCanal('¿Dónde está mi pedido?')).toBe('ORDER_STATUS')
    expect(politica.clasificarIntencionCanal('Quiero hacer una devolución, me llegó roto')).toBe('ORDER_STATUS')
    expect(politica.clasificarIntencionCanal('¿Qué dosis le aplico a mi paciente?')).toBe('CLINICAL_BOUNDARY')
    expect(politica.clasificarIntencionCanal('¿qué es el S2RM?')).toBe('PRODUCT_INFO')
    expect(politica.clasificarIntencionCanal('busco rellenos')).toBe('PRODUCT_DISCOVERY')
    expect(politica.clasificarIntencionCanal('¿hacen envíos a Mazatlán?')).not.toBe('ORDER_STATUS')
  })
  it('transferencia determinista: solo persona explícita y pedido/reclamación', () => {
    expect(politica.transferenciaDeterminista('Quiero hablar con un asesor')).toBe('cliente_pide_persona')
    expect(politica.transferenciaDeterminista('¿Dónde está mi pedido?')).toBe('soporte_pedido')
    expect(politica.transferenciaDeterminista('Tengo una queja')).toBe('soporte_pedido')
    for (const f of ['¿Cuánto cuesta?', '¿Hay existencias?', '¿Tienen WhatsApp?', 'No necesito asesor', 'quiero comprar', '¿qué dosis le pongo a mi paciente?', 'hola']) expect(politica.transferenciaDeterminista(f), f).toBeNull()
  })
})

describe('canal: tarea, contexto y mensajes', () => {
  const ctxV = { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }
  const sys = (intencion: string, limiteClinico = false) => politica.construirSistema({ ctx: ctxV, intencion, limiteClinico, reglasConocimiento: [], evidencia: [], canal: 'whatsapp' })
  it('precio: orienta al portal con enlace_portal, sin cifras y sin transferir por defecto; condiciones especiales → asesor', () => {
    const s = sys('PRICE'); expect(s).toContain('enlace_portal'); expect(s).toContain('NO transfieras solo porque pregunta el precio'); expect(s).toContain('mayoreo, crédito, cotización formal')
  })
  it('compra (R4-C7): confirma el producto con el catálogo y la cierra un asesor; nunca confirma pedidos; sin botón de checkout', () => {
    const s = sys('CHECKOUT'); expect(s).toContain('cerrará la venta en este mismo chat'); expect(s).toContain('NO uses solicitar_asesor'); expect(s).toContain('Nunca digas que registraste'); expect(politica.tareaCanal('CHECKOUT', false)).not.toContain('Confirmar pedido')
  })
  it('pedido/reclamación: no inventa estado y transfiere; clínico: límite y asesor COMERCIAL (no clínico)', () => {
    expect(sys('ORDER_STATUS')).toContain('no inventes estados'); expect(sys('ORDER_STATUS')).toContain('solicitar_asesor')
    const c = sys('CLINICAL_BOUNDARY', true); expect(c).toContain('equipo comercial de Renovacell (no personal clínico)')
  })
  it('contexto del canal: transferir solo ante necesidad, una vez y sin promesas', () => {
    const s = sys('GENERAL_CHAT'); expect(s).toContain('R4-B2 · TRANSFERENCIA'); expect(s).toContain('avisa UNA sola vez'); expect(s).toContain('no ofrezcas un asesor por costumbre')
  })
  it('mensajes seguros del canal: sin promesas y sin presentar a un asesor como personal clínico', () => {
    for (const m of [politica.MENSAJE_SIN_RESPUESTA_CANAL, politica.MENSAJE_LIMITE_CLINICO_CANAL]) { expect(m).not.toMatch(/en (un )?momento|enseguida|ahorita|de inmediato/i); expect(m).not.toMatch(/m[eé]dico|cl[ií]nico de Renovacell/i) }
    expect(politica.MENSAJE_LIMITE_CLINICO_CANAL).toContain('equipo comercial')
  })
})

// ── Flujo completo del orquestador con la política de canal (proveedor falso guionado) ────────────────────────
function base(opts: { idempotente?: boolean } = {}) {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
    llamadas.push({ fn, args })
    switch (fn) {
      case 'cc_ia_contexto_actor': return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      case 'cc_ia_turno_reclamar': return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:5', attempts: 1 }, error: null }
      case 'cc_ia_estado_handoff': return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active' }, error: null }
      case 'cc_catalogo_para_ia': return { data: [{ product_id: A, nombre: 'Hyalux Deep 1 ml' }], error: null }
      case 'cc_buscar_productos': return { data: [{ product_id: A, nombre: 'Hyalux Deep 1 ml', familia: 'Hyalux', categoria: 'Rellenos', audiencia: 'public' }], error: null }
      case 'cc_ia_precio': return { data: { autorizado: false, motivo: 'PRICE_REQUIRES_VERIFICATION' }, error: null }
      case 'cc_solicitar_asesor': return { data: { modo: 'human_requested', asesor: false, idempotente: opts.idempotente ?? false }, error: null }
      case 'cc_ia_herramienta_registrar': return { data: 'tc', error: null }
      case 'cc_ia_turno_responder': return { data: { persistido: true, idempotente: false, message_id: 'm-ai', seq: 7 }, error: null }
      case 'cc_ia_turno_fallar': return { data: { estado: 'failed' }, error: null }
      case 'cc_ia_aviso_no_disponible': return { data: {}, error: null }
    }
    return { data: null, error: { message: 'fn desconocida ' + fn } }
  }
  return { rpc, llamadas }
}
const deps = (db: ReturnType<typeof base>, guion: Parameters<typeof crearProveedorFalso>[0]) => ({
  rpc: db.rpc, leerMensajes: async () => [{ actor: 'visitor', content: 'hola' }],
  proveedor: crearProveedorFalso(guion), config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 3, historial: 12 },
  politica: politicaCanal, herramientas, validacion: validacionCanal, reglasConocimiento: REGLAS_IA,
}) as DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> }
const entrada = (texto: string) => ({ conv: CONV, triggerSeq: 5, actor: 'visitor' as const, profile: null, visitorHash: 'h'.repeat(64), textoUsuario: texto, canal: 'whatsapp' as const })
const persistido = (db: ReturnType<typeof base>) => String(db.llamadas.find((l) => l.fn === 'cc_ia_turno_responder')?.args.p_content ?? '')

describe('canal: conversaciones simuladas (orquestador real + proveedor falso)', () => {
  it('«¿Cuánto cuesta el Hyalux Deep?» → orienta al portal con el enlace oficial; sin cifras; SIN transferencia', async () => {
    const db = base()
    const d = deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'hyalux deep' } }, { name: 'enlace_portal', input: {} }]),
      respuestaTexto('El precio de Hyalux Deep 1 ml se consulta en el portal para profesionales verificados: ' + URL_SISTEMA + ' ¿Te cuento algo más del producto?')])
    const r = await ejecutarTurno(entrada('¿Cuánto cuesta el Hyalux Deep?'), d)
    expect(r.estado).toBe('respondio')
    expect(d.proveedor.solicitudes[0].system).toContain('TAREA: precio o condiciones comerciales')
    expect(db.llamadas.some((l) => l.fn === 'cc_solicitar_asesor')).toBe(false)
    expect(persistido(db)).toContain(URL_SISTEMA); expect(persistido(db)).not.toMatch(/\$\s?\d/)
  })
  it('el modelo inventa un precio → el validador lo bloquea y sale el mensaje seguro del canal', async () => {
    const db = base()
    const d = deps(db, [respuestaTexto('Cuesta $4,000 la pieza.'), respuestaTexto('Cuesta $4,000 la pieza.'), respuestaTexto('Cuesta $4,000 la pieza.')])
    await ejecutarTurno(entrada('¿cuánto cuesta?'), d)
    expect(persistido(db)).toContain('se consultan en el portal'); expect(persistido(db)).not.toMatch(/\$\s?\d|lo reviso/)
  })
  it('«¿Manejan mayoreo con crédito?» → el modelo transfiere con solicitar_asesor y confirma UNA vez, sin prometer tiempos', async () => {
    const db = base()
    const d = deps(db, [respuestaHerramientas([{ name: 'solicitar_asesor', input: { motivo: 'mayoreo y crédito' } }]), respuestaTexto('Listo, le pedí a un asesor de Renovacell que te ayude con mayoreo y crédito.')])
    const r = await ejecutarTurno(entrada('¿Manejan mayoreo con crédito?'), d)
    expect(r.estado).toBe('respondio'); expect(db.llamadas.filter((l) => l.fn === 'cc_solicitar_asesor')).toHaveLength(1)
    expect(persistido(db)).not.toMatch(/en (un )?momento|enseguida|ahorita|de inmediato/i)
  })
  it('promesa de atención inmediata sin evidencia → bloqueada y SIN afirmar que hay una solicitud registrada', async () => {
    const db = base()
    const d = deps(db, [respuestaTexto('En un momento te atiende un asesor.'), respuestaTexto('En un momento te atiende un asesor.'), respuestaTexto('En un momento te atiende un asesor.')])
    await ejecutarTurno(entrada('quiero que alguien me revise esto'), d)
    expect(persistido(db)).toBe(politica.MENSAJE_SIN_RESPUESTA_CANAL)
  })
  it('pregunta clínica → la tarea pide el límite y aclara asesor comercial (no clínico)', async () => {
    const db = base()
    const d = deps(db, [respuestaTexto('No puedo indicarte qué aplicar a tu paciente; si quieres seguimiento, un asesor del equipo comercial de Renovacell puede atenderte.')])
    await ejecutarTurno(entrada('¿Qué dosis le aplico a mi paciente?'), d)
    expect(d.proveedor.solicitudes[0].system).toContain('no personal clínico')
  })
  it('información insuficiente → dice que no tiene lo aprobado; no inventa ni transfiere por su cuenta', async () => {
    const db = base()
    const d = deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'producto x' } }]), respuestaTexto('No tengo información aprobada de ese producto. ¿Buscas algo de rellenos o bioestimulación?')])
    await ejecutarTurno(entrada('¿tienen el producto X de otra marca?'), d)
    expect(db.llamadas.some((l) => l.fn === 'cc_solicitar_asesor')).toBe(false)
  })
})

describe('responderIA (canal): transferencia determinista, idempotente y sin respuesta duplicada', () => {
  function adminFalso(idempotente: boolean) {
    const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
    return { llamadas, rpc: async (fn: string, args: Record<string, unknown>) => { llamadas.push({ fn, args }); return fn === 'cc_solicitar_asesor' ? { data: { modo: 'human_requested', idempotente }, error: null } : { data: {}, error: null } } }
  }
  beforeEach(() => { vi.stubGlobal('Deno', { env: { get: () => undefined } }) })   // sin llave del proveedor: si se llega al modelo, aviso
  it('«Quiero hablar con un asesor» por WhatsApp → transfiere sin llamar al modelo (un solo aviso: el del sistema)', async () => {
    const a = adminFalso(false)
    const r = await responderIA(a, CONV, 5, 'visitor', null, 'h'.repeat(64), 'Quiero hablar con un asesor', 'wa:1', 'whatsapp')
    expect(r).toBe('transferida')
    expect(a.llamadas.map((l) => l.fn)).toEqual(['cc_solicitar_asesor'])
    expect(a.llamadas[0].args).toEqual({ p_conv: CONV, p_actor_type: 'visitor', p_visitor_hash: 'h'.repeat(64), p_profile: null })
  })
  it('«¿Dónde está mi pedido?» por Instagram → transfiere (soporte de pedido)', async () => {
    const a = adminFalso(false)
    expect(await responderIA(a, CONV, 5, 'visitor', null, 'h'.repeat(64), '¿Dónde está mi pedido?', 'meta:1', 'instagram')).toBe('transferida')
  })
  it('ya había solicitud (idempotente) → no se repite el aviso; la IA sigue el turno normal', async () => {
    const a = adminFalso(true)
    const r = await responderIA(a, CONV, 5, 'visitor', null, 'h'.repeat(64), 'Quiero hablar con un asesor', 'wa:1', 'whatsapp')
    expect(r).toBe('no_disponible')   // sin llave en esta prueba: el turno normal deja el aviso del servidor
    expect(a.llamadas.map((l) => l.fn)).toEqual(['cc_solicitar_asesor', 'cc_ia_aviso_no_disponible'])
  })
  it('precio por WhatsApp → NO transfiere (sigue al turno de IA)', async () => {
    const a = adminFalso(false)
    await responderIA(a, CONV, 5, 'visitor', null, 'h'.repeat(64), '¿Cuánto cuesta?', 'wa:1', 'whatsapp')
    expect(a.llamadas.some((l) => l.fn === 'cc_solicitar_asesor')).toBe(false)
  })
  it('portal → nunca transfiere de forma determinista (política del portal intacta)', async () => {
    const a = adminFalso(false)
    await responderIA(a, CONV, 5, 'doctor', 'p1', null, 'Quiero hablar con un asesor', 'uid:p1')
    expect(a.llamadas.some((l) => l.fn === 'cc_solicitar_asesor')).toBe(false)
  })
  it('meta-webhook despacha también tras una transferencia (el aviso sale de inmediato)', () => {
    expect(webhook).toMatch(/if \(ia === 'respondio' \|\| ia === 'transferida'\) await despacharWhatsApp\(admin\)/)
    expect(webhook).toMatch(/if \(ia === 'respondio' \|\| ia === 'transferida'\) await despacharMeta\(admin\)/)
  })
})

describe('validación de canal: textos seguros honestos', () => {
  const ctx = { limiteClinico: false, evidencia: [] as string[], textoLimiteClinico: politica.MENSAJE_LIMITE_CLINICO_CANAL, textoGenerico: politica.MENSAJE_SIN_RESPUESTA_CANAL }
  it('sin solicitud real no dice "quedó registrada"; con evidencia del servidor sí', () => {
    expect(validacion.respuestaSeguraCanal('promesa_humano_sin_evidencia', ctx)).toBe(politica.MENSAJE_SIN_RESPUESTA_CANAL)
    expect(validacion.respuestaSeguraCanal('promesa_humano_sin_evidencia', { ...ctx, evidencia: ['HUMAN_REQUESTED'] })).toContain('quedó registrada')
  })
  it('precio, existencias, pedido y carrito: remite al portal; nunca "lo reviso" ni botones del carrito', () => {
    for (const m of ['precio_sin_evidencia', 'stock_sin_evidencia', 'pedido_sin_evidencia', 'carrito_mutacion_sin_evidencia', 'carrito_lectura_sin_evidencia']) {
      const t = validacion.respuestaSeguraCanal(m, ctx); expect(t, m).toContain('portal'); expect(t, m).not.toMatch(/lo reviso|Confirmar pedido|tu carrito/)
    }
  })
  it('el portal conserva sus textos', () => {
    expect(validacion.respuestaSegura('precio_sin_evidencia', { ...ctx, textoGenerico: politica.MENSAJE_SIN_RESPUESTA, textoLimiteClinico: politica.MENSAJE_LIMITE_CLINICO })).toBe('Para darte un precio necesito consultarlo con tu cuenta verificada. ¿Te confirmo el producto exacto y lo reviso?')
  })
})
