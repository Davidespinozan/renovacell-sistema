// R4-C7 · Atención comercial impecable en canal (WhatsApp/Instagram/Messenger). Proveedor de IA FALSO y base FALSA: sin
// Anthropic, sin red, sin Meta. Comprueba: (A) si el modelo nombra un producto sin consultarlo, UNA corrección interna y
// responde con el catálogo (el usuario nunca ve el texto de respaldo); (B) compra, recompra y negociación: la IA confirma el
// producto y una persona del equipo comercial toma la venta con el aviso neutro del servidor, DESPUÉS de la respuesta;
// negaciones sin transferir; el portal sin cambios.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { REGLAS_IA } from '../../../../../supabase/functions/_shared/conocimiento'
import { responderIA } from '../../../../../supabase/functions/_shared/ia/responder'

const N1 = '11111111-1111-4111-8111-111111111111', N2 = '22222222-2222-4222-8222-222222222222', N3 = '33333333-3333-4333-8333-333333333333'
const CONV = '99999999-9999-4999-8999-999999999999'
const validacionCanal = { ...validacion, respuestaSegura: validacion.respuestaSeguraCanal }
const politicaCanal = { ...politica, clasificarIntencion: politica.clasificarIntencionCanal, MENSAJE_SIN_RESPUESTA: politica.MENSAJE_SIN_RESPUESTA_CANAL, MENSAJE_LIMITE_CLINICO: politica.MENSAJE_LIMITE_CLINICO_CANAL }
const NABOTA = [{ product_id: N1, nombre: 'Nabota 100 UI' }, { product_id: N2, nombre: 'Nabota 150 UI' }, { product_id: N3, nombre: 'Nabota 200 UI' }]

function base() {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
    llamadas.push({ fn, args })
    switch (fn) {
      case 'cc_ia_contexto_actor': return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      case 'cc_ia_turno_reclamar': return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:17', attempts: 1 }, error: null }
      case 'cc_ia_estado_handoff': return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active' }, error: null }
      case 'cc_catalogo_para_ia': return { data: NABOTA, error: null }
      case 'cc_buscar_productos': return { data: NABOTA.map((p) => ({ ...p, familia: 'Nabota', categoria: 'Toxinas', audiencia: 'public' })), error: null }
      case 'cc_ia_herramienta_registrar': return { data: 'tc', error: null }
      case 'cc_ia_turno_responder': return { data: { persistido: true, idempotente: false, message_id: 'm-ai', seq: 18 }, error: null }
      case 'cc_ia_turno_fallar': return { data: { estado: 'failed' }, error: null }
    }
    return { data: null, error: { message: 'fn desconocida ' + fn } }
  }
  return { rpc, llamadas }
}
const deps = (db: ReturnType<typeof base>, guion: Parameters<typeof crearProveedorFalso>[0], pol = politicaCanal, val = validacionCanal) => ({
  rpc: db.rpc, leerMensajes: async () => [{ actor: 'visitor', content: 'Quisiera comprar Nabota' }],
  proveedor: crearProveedorFalso(guion), config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 4, historial: 12 },
  politica: pol, herramientas, validacion: val, reglasConocimiento: REGLAS_IA,
}) as DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> }
const entrada = (texto: string, canal: 'whatsapp' | 'portal' = 'whatsapp') => ({ conv: CONV, triggerSeq: 17, actor: 'visitor' as const, profile: null, visitorHash: 'h'.repeat(64), textoUsuario: texto, canal })
const persistidos = (db: ReturnType<typeof base>) => db.llamadas.filter((l) => l.fn === 'cc_ia_turno_responder').map((l) => String(l.args.p_content))
const RESPALDO = 'Prefiero no afirmar nada de un producto que no consulté'

describe('A · nunca nombra un producto sin consultarlo (y el cliente nunca ve el texto de respaldo)', () => {
  it('«Quisiera comprar Nabota»: el modelo lo nombra sin consultar → corrección interna → consulta → responde con las presentaciones reales', async () => {
    const db = base()
    const d = deps(db, [
      respuestaTexto('¡Claro! Nabota 100 UI es excelente.'),
      respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'nabota' } }]),
      respuestaTexto('¡Claro! Manejamos Nabota 100 UI, Nabota 150 UI y Nabota 200 UI. ¿Qué presentación y cuántas piezas necesitas? Un asesor de Renovacell continuará contigo por aquí para completar la compra.'),
    ])
    const r = await ejecutarTurno(entrada('Quisiera comprar Nabota'), d)
    expect(r.estado).toBe('respondio')
    expect(persistidos(db)).toHaveLength(1)
    expect(persistidos(db)[0]).toContain('Nabota 150 UI'); expect(persistidos(db)[0]).not.toContain(RESPALDO)
    const correccion = JSON.stringify(d.proveedor.solicitudes[1].messages)
    expect(correccion).toContain('CORRECCIÓN INTERNA'); expect(correccion).toContain('Nabota 100 UI')
    expect(db.llamadas.filter((l) => l.fn === 'cc_ia_herramienta_registrar' && l.args.p_tool === 'validacion_salida')).toHaveLength(1)
  })
  it('una sola corrección: si vuelve a nombrarlo sin consultar, sale el texto seguro (nunca lo inventado)', async () => {
    const db = base()
    const d = deps(db, [respuestaTexto('Nabota 100 UI es lo mejor.'), respuestaTexto('Te recomiendo Nabota 200 UI.')])
    await ejecutarTurno(entrada('¿qué tal el nabota?'), d)
    expect(persistidos(db)).toEqual([validacion.respuestaSeguraCanal('producto_no_autorizado', { limiteClinico: false, evidencia: [], textoLimiteClinico: '', textoGenerico: '' })])
    expect(d.proveedor.solicitudes).toHaveLength(2)
  })
  it('el portal no cambia: sin corrección, texto seguro inmediato', async () => {
    const db = base()
    const d = deps(db, [respuestaTexto('Nabota 100 UI es excelente.'), respuestaTexto('no debería pedirse')], politica as never, validacion as never)
    await ejecutarTurno(entrada('Quisiera comprar Nabota', 'portal'), d)
    expect(d.proveedor.solicitudes).toHaveLength(1)
    expect(persistidos(db)[0]).toContain(RESPALDO)
  })
  it('el contexto del canal exige consultar cada producto en el turno', () => {
    expect(politica.contextoCanal('whatsapp')).toContain('consúltalo con buscar_productos en ESTE turno antes de responder')
  })
})

describe('B · compra, recompra y negociación → la IA confirma y un asesor cierra', () => {
  const compra = ['Quisiera comprar Nabota', 'quiero comprar 3 cajas', 'Quiero pedir Hyalux', '¿Cómo compro?', '¿dónde puedo comprar el s2rm?', 'quiero hacer un pedido',
    'me vendes 2 viales?', 'mándame 5 piezas de nabota', '¿cómo les pago?', 'necesito 10 cajas de Hyalux Deep', 'me interesa comprar Nabota 200']
  for (const f of compra) it(`compra: «${f}»`, () => { expect(politica.atencionComercial(f)).toBe('compra'); expect(politica.clasificarIntencionCanal(f)).toBe('CHECKOUT') })
  const recompra = ['Quiero lo de siempre', 'lo mismo de la última vez', 'quiero volver a pedir', '¿me puedes repetir mi pedido?', 'quiero resurtir', 'como la vez pasada, 4 cajas']
  for (const f of recompra) it(`recompra: «${f}»`, () => expect(politica.atencionComercial(f)).toBe('recompra'))
  const negocia = ['¿Manejan mayoreo?', '¿dan crédito?', 'necesito una cotización formal', '¿tienen descuento por volumen?', 'quiero ser distribuidor', '¿precio especial para clínica?']
  for (const f of negocia) it(`negociación: «${f}»`, () => { expect(politica.atencionComercial(f)).toBe('negociacion'); expect(politica.clasificarIntencionCanal(f)).toBe('CHECKOUT') })
  const nada = ['No quiero comprar todavía, ¿qué es el Nabota?', 'todavía no voy a comprar', 'hola', '¿qué es el S2RM?', '¿cuánto cuesta el nabota?', '¿hay existencias?',
    'busco rellenos', '¿qué dosis le aplico a mi paciente?', 'quiero hablar con un asesor']
  for (const f of nada) it(`NO es atención comercial: «${f}»`, () => expect(politica.atencionComercial(f)).toBeNull())
  it('negación de compra con pregunta de producto → sigue como información', () => {
    expect(politica.clasificarIntencionCanal('No quiero comprar todavía, ¿qué es el Nabota?')).toBe('PRODUCT_INFO')
  })
  it('la tarea de compra: confirmar con el catálogo, pedir presentación y cantidad, asesor por aquí, sin precios ni portal por defecto, sin solicitar_asesor', () => {
    const t = politica.tareaCanal('CHECKOUT', false)
    for (const x of ['buscar_productos', 'presentación y cantidad', 'continuará contigo por aquí', 'NO uses solicitar_asesor', 'Sin precios, existencias ni tiempos', 'No mandes al portal salvo que lo pida', 'FUERA_DE_HORARIO']) expect(t, x).toContain(x)
  })
})

describe('B · responderIA: transfiere con el aviso neutro DESPUÉS del turno de la IA', () => {
  function adminFalso(transferido: boolean) {
    const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
    return { llamadas, rpc: async (fn: string, args: Record<string, unknown>) => { llamadas.push({ fn, args }); return fn === '_cc_canal_transferir' ? { data: transferido, error: null } : { data: {}, error: null } } }
  }
  beforeEach(() => { vi.stubGlobal('Deno', { env: { get: () => undefined } }) })   // sin llave: el turno deja su aviso y aun así se transfiere
  it('«Quisiera comprar Nabota» por WhatsApp → turno de IA y luego _cc_canal_transferir (aviso neutro, respiro de 12 h)', async () => {
    const a = adminFalso(true)
    const r = await responderIA(a, CONV, 17, 'visitor', null, 'h'.repeat(64), 'Quisiera comprar Nabota', 'wa:1', 'whatsapp')
    expect(r).toBe('transferida')   // la IA no pudo responder (sin llave) y aun así el comprador queda con un asesor
    expect(a.llamadas.map((l) => l.fn)).toEqual(['cc_ia_aviso_no_disponible', '_cc_canal_transferir'])
    expect(a.llamadas[1].args).toEqual({ p_conv: CONV, p_origen: 'whatsapp', p_prefijo: 'wa', p_motivo: 'atencion_comercial', p_respiro: true })
  })
  it('Instagram usa su propio prefijo de aviso', async () => {
    const a = adminFalso(true)
    await responderIA(a, CONV, 17, 'visitor', null, 'h'.repeat(64), '¿Manejan mayoreo?', 'meta:1', 'instagram')
    expect(a.llamadas.find((l) => l.fn === '_cc_canal_transferir')!.args).toMatchObject({ p_origen: 'instagram', p_prefijo: 'instagram' })
  })
  it('ya transferida antes (respiro o conversación con asesor) → no hay segundo aviso', async () => {
    const a = adminFalso(false)
    expect(await responderIA(a, CONV, 17, 'visitor', null, 'h'.repeat(64), 'quiero comprar 3 cajas', 'wa:1', 'whatsapp')).toBe('no_disponible')
  })
  it('sin intención comercial o con negación → no transfiere', async () => {
    for (const f of ['¿qué es el Nabota?', 'No quiero comprar todavía', '¿cuánto cuesta?']) {
      const a = adminFalso(true)
      await responderIA(a, CONV, 17, 'visitor', null, 'h'.repeat(64), f, 'wa:1', 'whatsapp')
      expect(a.llamadas.some((l) => l.fn === '_cc_canal_transferir'), f).toBe(false)
    }
  })
  it('persona explícita sigue con la transferencia determinista de siempre (sin aviso comercial)', async () => {
    const a = { llamadas: [] as string[], rpc: async (fn: string) => { a.llamadas.push(fn); return { data: { idempotente: false }, error: null } } }
    expect(await responderIA(a, CONV, 17, 'visitor', null, 'h'.repeat(64), 'quiero hablar con un asesor', 'wa:1', 'whatsapp')).toBe('transferida')
    expect(a.llamadas).toEqual(['cc_solicitar_asesor'])
  })
  it('portal → nunca transfiere por compra (contrato del portal intacto)', async () => {
    const a = adminFalso(true)
    await responderIA(a, CONV, 17, 'doctor', 'p1', null, 'Quisiera comprar Nabota', 'uid:p1')
    expect(a.llamadas.some((l) => l.fn === '_cc_canal_transferir')).toBe(false)
  })
})
