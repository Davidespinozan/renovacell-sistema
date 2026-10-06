// CC-6 · Orquestador y checkout con proveedor FALSO: preparar_checkout es lectura; NO existe
// herramienta de confirmación (el modelo no puede fabricar la prueba de confirmación); "tu pedido
// fue creado" se bloquea siempre; intención ambigua no prepara nada; takeover descarta.
import { describe, it, expect } from 'vitest'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas, type RespuestaModelo, type SolicitudModelo } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { REGLAS_IA } from '../../../../../supabase/functions/_shared/conocimiento'

const A = '11111111-1111-4111-8111-111111111111', CONV = '99999999-9999-4999-8999-999999999999', CART = '55555555-5555-4555-8555-555555555555'
function baseFalsa(opts: { actor?: 'visitor' | 'doctor'; listo?: boolean; takeover?: boolean } = {}) {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []; const estado = { turno: null as null | { status: string; content?: string } }
  const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
    llamadas.push({ fn, args })
    switch (fn) {
      case 'cc_ia_contexto_actor': return { data: opts.actor === 'doctor' ? { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true } : { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      case 'cc_ia_turno_reclamar': estado.turno = { status: 'provider_running' }; return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:5' }, error: null }
      case 'cc_catalogo_para_ia': return { data: [{ product_id: A, nombre: 'Hyalux Deep 1 ml' }], error: null }
      case 'cc_carrito_abrir': return { data: { cart_id: CART }, error: null }
      case 'cc_carrito_preparar_checkout': return { data: opts.actor === 'doctor'
        ? { cart_id: CART, listo: opts.listo !== false, problemas: opts.listo === false ? ['REQUIERE_DIRECCION'] : [], proyeccion: { cart_id: CART, puede_precio: true, n_items: 1, items: [{ product_id: A, nombre: 'Hyalux Deep 1 ml', cantidad: 2, precio: { estado: 'autorizado', unitario: 1000, subtotal: 2000 }, disponibilidad: 'disponible' }], total: { estado: 'completo', monto: 2000, moneda: 'MXN' } }, lineas_crear_pedido: [{ product_id: A, qty: 2 }] }
        : { cart_id: CART, listo: false, problemas: ['REQUIERE_CUENTA'], proyeccion: { cart_id: CART, puede_precio: false, n_items: 1, items: [{ product_id: A, nombre: 'Hyalux Deep 1 ml', cantidad: 2, precio: { estado: 'requiere_verificacion' }, disponibilidad: 'requiere_verificacion' }], total: { estado: 'requiere_verificacion' } }, lineas_crear_pedido: [{ product_id: A, qty: 2 }] }, error: null }
      case 'cc_ia_herramienta_registrar': return { data: 'tc', error: null }
      case 'cc_ia_turno_responder': if (opts.takeover) { estado.turno = { status: 'discarded' }; return { data: { persistido: false, motivo: 'takeover_humano' }, error: null } } estado.turno = { status: 'completed', content: String(args.p_content) }; return { data: { persistido: true, message_id: 'm', seq: 7 }, error: null }
      case 'cc_ia_turno_fallar': return { data: {}, error: null }
      case 'cc_ia_aviso_no_disponible': return { data: {}, error: null }
    }
    return { data: null, error: { message: 'fn desconocida ' + fn } }
  }
  return { rpc, llamadas, estado }
}
const deps = (db: ReturnType<typeof baseFalsa>, guion: Array<RespuestaModelo | ((s: SolicitudModelo) => RespuestaModelo)>): DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> } => ({
  rpc: db.rpc, leerMensajes: async () => [{ actor: 'doctor', content: 'hola' }], proveedor: crearProveedorFalso(guion), config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 4, historial: 12 }, politica, herramientas, validacion, reglasConocimiento: REGLAS_IA,
})
const entrada = (texto: string, actor: 'visitor' | 'doctor' = 'doctor') => ({ conv: CONV, triggerSeq: 5, actor, profile: actor === 'doctor' ? 'uid-doc' : null, visitorHash: actor === 'visitor' ? 'h'.repeat(64) : null, textoUsuario: texto })

describe('checkout por la IA (CC-6)', () => {
  it('"quiero confirmar el pedido" → CHECKOUT → preparar_checkout (lectura) → total fundamentado + invitación al botón; sin crear nada', async () => {
    const db = baseFalsa({ actor: 'doctor' })
    const d = deps(db, [respuestaHerramientas([{ name: 'preparar_checkout', input: {} }]), respuestaTexto('Tu pedido quedaría en $2,000 MXN (Hyalux Deep 1 ml × 2) y está listo. Confírmalo con el botón "Confirmar pedido" de tu carrito.')])
    const r = await ejecutarTurno(entrada('quiero confirmar el pedido'), d)
    expect(r).toMatchObject({ estado: 'respondio', intencion: 'CHECKOUT' }); expect(r.evidencia).toEqual(expect.arrayContaining(['CHECKOUT_REVIEW_EVIDENCE', 'PRICE_EVIDENCE']))
    expect(db.llamadas.map((l) => l.fn)).not.toContain('cc_checkout_confirmar'); expect(d.proveedor.solicitudes[0].tools.map((t) => t.name)).not.toContain('confirmar_checkout')
    expect(d.proveedor.solicitudes[0].system).toContain('TAREA: el usuario quiere comprar/confirmar')
    expect(db.estado.turno?.content).toContain('quedaría en $2,000')
  })
  it('AO/Z · el modelo intenta "confirmar_checkout" o inventa un review_id → herramienta desconocida, nada ocurre; "tu pedido fue creado" → bloqueado SIEMPRE', async () => {
    const db = baseFalsa({ actor: 'doctor' })
    const r = await ejecutarTurno(entrada('sí, confirma'), deps(db, [respuestaHerramientas([{ name: 'confirmar_checkout', input: { review_id: 'fabricado', operation_id: 'x' } }]), respuestaTexto('Listo, tu pedido fue creado.')]))
    expect(db.llamadas.filter((l) => l.fn.startsWith('cc_checkout'))).toHaveLength(0)
    expect(db.llamadas.some((l) => l.fn === 'cc_ia_herramienta_registrar' && l.args.p_tool === 'confirmar_checkout' && l.args.p_status === 'rechazada')).toBe(true)
    expect(r.motivoValidacion).toBe('pedido_sin_evidencia'); expect(db.estado.turno?.content).toMatch(/Yo no creo pedidos/)
    for (const t of ['Ya hice el pedido por ti.', 'Tu orden quedó registrada.', 'Pedido confirmado, folio SC000001.']) expect(validacion.validarRespuesta(t, { evidencia: ['CHECKOUT_REVIEW_EVIDENCE', 'PRICE_EVIDENCE'], nombresAutorizados: [], nombresCatalogo: [], limiteClinico: false })).toMatchObject({ ok: false, motivo: 'pedido_sin_evidencia' })
    expect(validacion.validarRespuesta('Tu pedido quedaría en $2,000; confírmalo con el botón.', { evidencia: ['CHECKOUT_REVIEW_EVIDENCE', 'PRICE_EVIDENCE'], nombresAutorizados: [], nombresCatalogo: [], limiteClinico: false })).toMatchObject({ ok: true })
  })
  it('X · intención ambigua ("me interesa", "se ve bien") no es CHECKOUT; visitante: preparar dice que requiere cuenta y no hay cifras', async () => {
    for (const t of ['me interesa', 'se ve bien', 'creo que sí', 'quiero saber cuánto sale el deep']) expect(politica.clasificarIntencion(t), t).not.toBe('CHECKOUT')
    for (const t of ['confirmar pedido', 'haz el pedido', 'quiero comprar', 'sí, confirma mi pedido', 'cuánto sale todo']) expect(politica.clasificarIntencion(t), t).toBe('CHECKOUT')
    const db = baseFalsa({ actor: 'visitor' })
    const r = await ejecutarTurno(entrada('quiero comprar', 'visitor'), deps(db, [respuestaHerramientas([{ name: 'preparar_checkout', input: {} }]), respuestaTexto('Para confirmar tu pedido y ver tu precio, crea tu cuenta y verifica tu cédula; tu carrito se conserva.')]))
    expect(r.estado).toBe('respondio'); expect(r.evidencia).toContain('CHECKOUT_REVIEW_EVIDENCE'); expect(r.evidencia).not.toContain('PRICE_EVIDENCE')
    const db2 = baseFalsa({ actor: 'visitor' })
    const r2 = await ejecutarTurno(entrada('quiero comprar', 'visitor'), deps(db2, [respuestaHerramientas([{ name: 'preparar_checkout', input: {} }]), respuestaTexto('Tu pedido quedaría en $2,000.')]))
    expect(r2.motivoValidacion).toBe('precio_sin_evidencia')
  })
  it('AA · takeover humano mientras prepara → la respuesta se descarta; nada se confirmó', async () => {
    const db = baseFalsa({ actor: 'doctor', takeover: true })
    const r = await ejecutarTurno(entrada('confirmar pedido'), deps(db, [respuestaHerramientas([{ name: 'preparar_checkout', input: {} }]), respuestaTexto('Quedaría en $2,000 MXN; confírmalo con el botón.')]))
    expect(r).toMatchObject({ estado: 'descartada', clase: 'takeover_humano' }); expect(db.llamadas.filter((l) => l.fn.startsWith('cc_checkout'))).toHaveLength(0)
  })
})
