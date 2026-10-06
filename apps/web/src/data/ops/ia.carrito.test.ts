// CC-5 · Orquestador + carrito con proveedor FALSO y base FALSA: agregar exacto, ambigüedad sin
// mutación, actualizar/quitar/ver, reintento idempotente por operation_id estable, error de
// herramienta sin afirmar, visitante sin precio, handoff del servidor (CC-7: rechazo, horario, asignado;
// declinada), takeover durante interacción de carrito, grounding de afirmaciones.
import { describe, it, expect } from 'vitest'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas, type RespuestaModelo, type SolicitudModelo } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { REGLAS_IA } from '../../../../../supabase/functions/_shared/conocimiento'

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', CONV = '99999999-9999-4999-8999-999999999999', CART = '55555555-5555-4555-8555-555555555555'

function baseFalsa(opts: { actor?: 'visitor' | 'doctor'; takeover?: boolean; fallaRpc?: string[]; handoffPrevio?: 'solicitado' | 'rechazado'; horario?: 'en' | 'fuera' | 'sin'; asignado?: boolean } = {}) {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const items = new Map<string, number>(); const ops = new Map<string, unknown>()
  const estado = { turno: null as null | { status: string; content?: string }, handoff: (opts.handoffPrevio ?? null) as string | null, items }
  const horario = opts.horario ?? 'en'
  const proy = () => ({ cart_id: CART, estado: 'active', rev: 1 + ops.size, dueno: opts.actor === 'doctor' ? 'profile' : 'visitor', puede_precio: opts.actor === 'doctor', n_items: items.size, cantidad_total: [...items.values()].reduce((s, q) => s + q, 0),
    items: [...items.entries()].map(([id, q]) => ({ product_id: id, nombre: id === A ? 'Hyalux Deep 1 ml' : 'Hyalux Lips 1 ml', cantidad: q, vendible: true, visible: true, disponibilidad: opts.actor === 'doctor' ? 'disponible' : 'requiere_verificacion', precio: opts.actor === 'doctor' ? { estado: 'autorizado', unitario: 1000, subtotal: 1000 * q } : { estado: 'requiere_verificacion' } })),
    total: items.size === 0 ? { estado: 'vacio' } : opts.actor === 'doctor' ? { estado: 'completo', monto: 1000 * [...items.values()].reduce((s, q) => s + q, 0), moneda: 'MXN' } : { estado: 'requiere_verificacion' }, handoff: { estado: estado.handoff } })
  const mutar = (args: Record<string, unknown>, accion: string) => {
    const op = String(args.p_op); const payload = JSON.stringify({ accion, p: args.p_product, q: args.p_qty })
    if (ops.has(op)) { const prev = ops.get(op) as { payload: string; res: unknown }; if (prev.payload !== payload) return { data: null, error: { message: 'IDEMPOTENCIA_CONFLICTO' } }; return { data: { ...(prev.res as object), idempotente: true }, error: null } }
    const nAntes = items.size; const antes = items.get(String(args.p_product)) ?? 0; let despues = antes
    if (accion === 'agregar') { despues = Math.min(antes + Number(args.p_qty), 999); items.set(String(args.p_product), despues) }
    else if (accion === 'actualizar') { despues = Number(args.p_qty); if (despues === 0) items.delete(String(args.p_product)); else items.set(String(args.p_product), despues) }
    else if (accion === 'quitar') { items.delete(String(args.p_product)); despues = 0 }
    else if (accion === 'vaciar') { items.clear() }
    const res = { cart_id: CART, accion, product_id: args.p_product ?? null, qty_antes: antes, qty_despues: despues, n_items: items.size, rev: 2 + ops.size, idempotente: false,
      // CC-7 · el SERVIDOR dispara el handoff al primer artículo (un ciclo por carrito)
      handoff: nAntes === 0 && items.size > 0 && estado.handoff === null ? (estado.handoff = 'solicitado', { estado: 'solicitado', fuera_horario: horario !== 'en', horario_configurado: horario !== 'sin', asignado: !!opts.asignado }) : null }
    ops.set(op, { payload, res }); return { data: res, error: null }
  }
  const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
    llamadas.push({ fn, args })
    if (opts.fallaRpc?.includes(fn)) return { data: null, error: { message: 'boom' } }
    switch (fn) {
      case 'cc_ia_contexto_actor': return { data: opts.actor === 'doctor' ? { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true } : { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      case 'cc_ia_turno_reclamar': estado.turno = { status: 'provider_running' }; return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:5' }, error: null }
      case 'cc_catalogo_para_ia': return { data: [{ product_id: A, nombre: 'Hyalux Deep 1 ml' }, { product_id: B, nombre: 'Hyalux Lips 1 ml' }, { product_id: 'c', nombre: 'Colagex Plus' }], error: null }
      case 'cc_buscar_productos': { const q = String(args.p_q).toLowerCase(); return { data: q.includes('deep') ? [{ product_id: A, nombre: 'Hyalux Deep 1 ml' }] : q.includes('hyalux') ? [{ product_id: A, nombre: 'Hyalux Deep 1 ml' }, { product_id: B, nombre: 'Hyalux Lips 1 ml' }] : [], error: null } }
      case 'cc_carrito_abrir': return { data: proy(), error: null }
      case 'cc_carrito_ver': return { data: { ...proy(), rol: 'dueno' }, error: null }
      case 'cc_carrito_agregar': return mutar(args, 'agregar')
      case 'cc_carrito_actualizar': return mutar(args, 'actualizar')
      case 'cc_carrito_quitar': return mutar(args, 'quitar')
      case 'cc_carrito_vaciar': return mutar(args, 'vaciar')
      case 'cc_ia_estado_handoff': return { data: { modo: estado.handoff === 'solicitado' ? (opts.asignado ? 'human_assigned' : 'human_requested') : 'ai_active', origen: estado.handoff ? 'carrito' : null, horario_configurado: horario !== 'sin', en_horario: horario === 'en', asignado: estado.handoff === 'solicitado' && !!opts.asignado, rechazado_carrito: estado.handoff === 'rechazado' }, error: null }
      case 'cc_handoff_rechazar': estado.handoff = 'rechazado'; return { data: { rechazado: true, modo: 'ai_active' }, error: null }
      case 'cc_solicitar_asesor': return { data: { modo: 'human_requested', asesor: false }, error: null }
      case 'cc_ia_precio': return { data: { autorizado: false, motivo: 'PRICE_REQUIRES_VERIFICATION' }, error: null }
      case 'cc_ia_herramienta_registrar': return { data: 'tc', error: null }
      case 'cc_ia_turno_responder': if (opts.takeover) { estado.turno = { status: 'discarded' }; return { data: { persistido: false, motivo: 'takeover_humano' }, error: null } } estado.turno = { status: 'completed', content: String(args.p_content) }; return { data: { persistido: true, message_id: 'm', seq: 7 }, error: null }
      case 'cc_ia_turno_fallar': estado.turno = { status: 'failed' }; return { data: {}, error: null }
      case 'cc_ia_aviso_no_disponible': return { data: {}, error: null }
    }
    return { data: null, error: { message: 'fn desconocida ' + fn } }
  }
  return { rpc, llamadas, estado, items }
}
const deps = (db: ReturnType<typeof baseFalsa>, guion: Array<RespuestaModelo | ((s: SolicitudModelo) => RespuestaModelo)>, cfg: Partial<DepsOrquestador['config']> = {}): DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> } => ({
  rpc: db.rpc, leerMensajes: async () => [{ actor: 'visitor', content: 'hola' }], proveedor: crearProveedorFalso(guion), config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 4, historial: 12, ...cfg },
  politica, herramientas, validacion, reglasConocimiento: REGLAS_IA,
})
const entrada = (texto: string, actor: 'visitor' | 'doctor' = 'visitor') => ({ conv: CONV, triggerSeq: 5, actor, profile: actor === 'doctor' ? 'uid-doc' : null, visitorHash: actor === 'visitor' ? 'h'.repeat(64) : null, textoUsuario: texto })

describe('carrito por la IA', () => {
  it('"agrega dos de hyalux deep" → buscar (unívoco) → agregar_al_carrito ×2 con operation_id turno:llamada → respuesta con CART_MUTATION_EVIDENCE; el carrito se abrió ligado a la conversación', async () => {
    const db = baseFalsa()
    const d = deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'hyalux deep' } }]), respuestaHerramientas([{ id: 'tu_7', name: 'agregar_al_carrito', input: { product_id: A, cantidad: 2 } }]), respuestaTexto('Listo, ya agregué 2 piezas de Hyalux Deep 1 ml a tu carrito. Si quieres, un asesor de Renovacell puede revisar contigo las opciones.')])
    const r = await ejecutarTurno(entrada('agrega dos de hyalux deep'), d)
    expect(r).toMatchObject({ estado: 'respondio', intencion: 'CART_ADD' })
    expect(r.evidencia).toEqual(expect.arrayContaining(['KNOWLEDGE_EVIDENCE', 'CART_MUTATION_EVIDENCE', 'HANDOFF_SOLICITADO', 'EN_HORARIO', 'ASESOR_SIN_ASIGNAR']))
    expect(db.items.get(A)).toBe(2)
    const add = db.llamadas.find((l) => l.fn === 'cc_carrito_agregar')!
    expect(add.args).toMatchObject({ p_cart: CART, p_actor_type: 'ai', p_visitor_hash: 'h'.repeat(64), p_profile: null, p_product: A, p_qty: 2 }); expect(String(add.args.p_op)).toMatch(/^t1:r1:agregar_al_carrito:/)
    expect(db.llamadas.find((l) => l.fn === 'cc_carrito_abrir')!.args).toMatchObject({ p_actor_type: 'visitor', p_conv: CONV })
    // AK · "ya agregué" pasó por evidencia de mutación; CC-7: el handoff lo disparó el servidor (la IA no registra ofertas)
    expect(db.estado.turno?.content).toContain('ya agregué'); expect(db.estado.handoff).toBe('solicitado')
    expect(db.llamadas.some((l) => l.fn === 'cc_carrito_oferta')).toBe(false)
    expect(d.proveedor.solicitudes[2].system).toContain('ATENCIÓN HUMANA (decidida por el servidor)')
  })
  it('AP · producto ambiguo: el modelo pregunta, sin mutación; si intenta agregar sin búsqueda previa → id_no_autorizado', async () => {
    const db = baseFalsa()
    const r = await ejecutarTurno(entrada('agrega hyalux'), deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'hyalux' } }]), respuestaTexto('Tengo dos opciones: Hyalux Deep 1 ml y Hyalux Lips 1 ml. ¿Cuál agrego?')]))
    expect(r.estado).toBe('respondio'); expect(db.items.size).toBe(0); expect(db.llamadas.filter((l) => l.fn === 'cc_carrito_agregar')).toHaveLength(0)
    const db2 = baseFalsa()
    await ejecutarTurno(entrada('agrega el deep'), deps(db2, [respuestaHerramientas([{ name: 'agregar_al_carrito', input: { product_id: A, cantidad: 1 } }]), respuestaTexto('No pude identificar el producto; ¿me dices el nombre exacto?')]))
    expect(db2.items.size).toBe(0); expect(db2.llamadas.some((l) => l.fn === 'cc_ia_herramienta_registrar' && l.args.p_status === 'no_autorizada')).toBe(true)
  })
  it('AL · reintento del TURNO (re-run tras timeout; el modelo repite la misma mutación con otro tool id) no duplica: X×2, no X×4; misma llamada dos veces en la ronda → cache; mismo id con payload distinto → conflicto', async () => {
    const db = baseFalsa()
    const guion = () => [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'hyalux deep' } }]), respuestaHerramientas([{ id: 'tu_' + Math.random().toString(36).slice(2), name: 'agregar_al_carrito', input: { product_id: A, cantidad: 2 } }]), respuestaTexto('Agregué 2 de Hyalux Deep 1 ml al carrito.')]
    await ejecutarTurno(entrada('agrega dos deep'), deps(db, guion()))
    const d2 = deps(db, guion()); await ejecutarTurno(entrada('agrega dos deep'), d2)   // mismo turno t1 (reclamo re-reclamado), tool id distinto
    expect(db.items.get(A)).toBe(2)
    const res2 = (d2.proveedor.solicitudes[2].messages[4].content as unknown as Array<{ content: string }>)[0].content; expect(res2).toContain('"idempotente":true')
    const ops = db.llamadas.filter((l) => l.fn === 'cc_carrito_agregar').map((l) => l.args.p_op); expect(ops).toHaveLength(2); expect(ops[0]).toBe(ops[1]); expect(String(ops[0])).toMatch(/^t1:r1:agregar_al_carrito:/)
    const db3 = baseFalsa()
    const d3 = deps(db3, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'deep' } }]), respuestaHerramientas([{ name: 'agregar_al_carrito', input: { product_id: A, cantidad: 1 } }, { name: 'agregar_al_carrito', input: { product_id: A, cantidad: 1 } }]), respuestaTexto('Agregué 1 de Hyalux Deep 1 ml al carrito.')])
    await ejecutarTurno(entrada('agrega deep'), d3)
    expect(db3.items.get(A)).toBe(1)   // dos llamadas idénticas en la misma ronda = una mutación
  })
  it('ver → actualizar → quitar: ids del carrito leído son retrieval autorizado; "tu carrito tiene" solo con lectura', async () => {
    const db = baseFalsa({ actor: 'doctor' }); db.items.set(A, 2); db.items.set(B, 1)
    const d = deps(db, [respuestaHerramientas([{ name: 'ver_carrito', input: {} }]), respuestaHerramientas([{ name: 'actualizar_carrito', input: { product_id: A, cantidad: 5 } }, { name: 'quitar_del_carrito', input: { product_id: B } }]), respuestaTexto('Tu carrito tiene 5 piezas de Hyalux Deep 1 ml; quité Hyalux Lips 1 ml. Total $5,000 MXN.')])
    const r = await ejecutarTurno(entrada('cambia deep a 5 y quita lips', 'doctor'), d)
    expect(r.estado).toBe('respondio'); expect(db.items.get(A)).toBe(5); expect(db.items.has(B)).toBe(false)
    expect(r.evidencia).toEqual(expect.arrayContaining(['CART_READ_EVIDENCE', 'CART_MUTATION_EVIDENCE']))
    expect(r.evidencia).toContain('PRICE_EVIDENCE')   // el precio de la proyección viene de la misma autoridad (cc_ia_precio) → la cifra está fundamentada
    expect(r.motivoValidacion).toBeUndefined()
  })
  it('AK · "ya lo agregué" sin mutación exitosa → bloqueado; herramienta de carrito fallida → el modelo no puede afirmar', async () => {
    const db = baseFalsa({ fallaRpc: ['cc_carrito_agregar'] })
    const d = deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'deep' } }]), respuestaHerramientas([{ name: 'agregar_al_carrito', input: { product_id: A } }]), respuestaTexto('Ya agregué Hyalux Deep 1 ml a tu carrito.')])
    const r = await ejecutarTurno(entrada('agrega deep'), d)
    expect(r).toMatchObject({ estado: 'respondio', motivoValidacion: 'carrito_mutacion_sin_evidencia' })
    expect(db.estado.turno?.content).toMatch(/No pude confirmar el cambio/)
    expect(JSON.stringify(d.proveedor.solicitudes[2].messages)).toContain('No inventes el dato')
    const db2 = baseFalsa()
    const r2 = await ejecutarTurno(entrada('qué tengo'), deps(db2, [respuestaTexto('Tu carrito tiene 3 productos.')]))
    expect(r2.motivoValidacion).toBe('carrito_lectura_sin_evidencia')
  })
  it('AD · visitante: la proyección no trae precio; una cifra en la respuesta se bloquea (sin PRICE_EVIDENCE)', async () => {
    const db = baseFalsa(); db.items.set(A, 1)
    const r = await ejecutarTurno(entrada('mi carrito'), deps(db, [respuestaHerramientas([{ name: 'ver_carrito', input: {} }]), respuestaTexto('Tu carrito tiene Hyalux Deep 1 ml ×1, que cuesta $1,000.')]))
    expect(r.intencion).toBe('CART_VIEW'); expect(r.motivoValidacion).toBe('precio_sin_evidencia')
  })
  it('CC-7 · declinar = rechazo canónico del handoff (conversación); sin oferta ni enfriamiento; ya no se reofrece', async () => {
    const db = baseFalsa({ handoffPrevio: 'solicitado' })
    const r = await ejecutarTurno(entrada('no, prefiero seguir contigo'), deps(db, [respuestaHerramientas([{ name: 'declinar_asesor', input: {} }]), respuestaTexto('Perfecto, seguimos. ¿Te muestro otra opción?')]))
    expect(db.llamadas.find((l) => l.fn === 'cc_handoff_rechazar')!.args).toMatchObject({ p_conv: CONV, p_actor_type: 'ai', p_visitor_hash: 'h'.repeat(64), p_profile: null })
    expect(db.estado.handoff).toBe('rechazado'); expect(r.evidencia).toContain('HANDOFF_RECHAZADO')
    const db2 = baseFalsa({ handoffPrevio: 'rechazado' })
    const d2 = deps(db2, [respuestaTexto('Claro, te ayudo con eso.')])
    await ejecutarTurno(entrada('qué más tienen'), d2)
    expect(d2.proveedor.solicitudes[0].system).toContain('no se lo vuelvas a ofrecer')
  })
  it('CC-7 · fuera de horario: "un asesor te atenderá en breve" se BLOQUEA (respuesta segura); la política lo prohíbe', async () => {
    const db = baseFalsa({ horario: 'fuera', asignado: true })
    const d = deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'deep' } }]), respuestaHerramientas([{ name: 'agregar_al_carrito', input: { product_id: A } }]), respuestaTexto('Agregué Hyalux Deep 1 ml a tu carrito. Un asesor te atenderá en breve.')])
    const r = await ejecutarTurno(entrada('agrega deep'), d)
    expect(r.evidencia).toEqual(expect.arrayContaining(['FUERA_DE_HORARIO', 'HANDOFF_SOLICITADO']))
    expect(r.motivoValidacion).toBe('promesa_humano_sin_evidencia')
    expect(db.estado.turno?.content).not.toMatch(/en breve/); expect(db.estado.turno?.content).toMatch(/quedó registrada/)
    expect(d.proveedor.solicitudes[2].system).toContain('El equipo de asesores NO está disponible ahora')
  })
  it('CC-7 · horario sin configurar: tampoco se promete atención inmediata', async () => {
    const db = baseFalsa({ horario: 'sin', handoffPrevio: 'solicitado' })
    const d = deps(db, [respuestaTexto('Tu asesor te contactará en unos minutos.')])
    const r = await ejecutarTurno(entrada('y el asesor?'), d)
    expect(r.evidencia).toContain('HORARIO_DESCONOCIDO'); expect(r.motivoValidacion).toBe('promesa_humano_sin_evidencia')
  })
  it('CC-7 · en horario y con asesor asignado: "tu asesor se unirá en un momento" SÍ pasa; la IA sigue respondiendo en human_assigned', async () => {
    const db = baseFalsa({ horario: 'en', asignado: true, handoffPrevio: 'solicitado' })
    const r = await ejecutarTurno(entrada('y mi asesor?'), deps(db, [respuestaTexto('Tu asesor personal se unirá a esta conversación en un momento; mientras, te ayudo.')]))
    expect(r.estado).toBe('respondio'); expect(r.motivoValidacion).toBeUndefined()
    expect(r.evidencia).toEqual(expect.arrayContaining(['EN_HORARIO', 'ASESOR_ASIGNADO', 'HANDOFF_EN_CURSO']))
  })
  it('AQ · takeover humano durante una interacción de carrito: la mutación ya ocurrió (es del usuario), la respuesta se descarta y la oferta NO se registra', async () => {
    const db = baseFalsa({ takeover: true })
    const r = await ejecutarTurno(entrada('agrega deep'), deps(db, [respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'deep' } }]), respuestaHerramientas([{ name: 'agregar_al_carrito', input: { product_id: A } }]), respuestaTexto('Agregué Hyalux Deep 1 ml.')]))
    expect(r).toMatchObject({ estado: 'descartada', clase: 'takeover_humano' }); expect(db.items.get(A)).toBe(1); expect(db.llamadas.some((l) => l.fn === 'cc_carrito_oferta')).toBe(false)
  })
  it('intenciones de carrito deterministas; "me interesa" no es carrito', () => {
    expect(politica.clasificarIntencion('agrega dos cajas de hyalux')).toBe('CART_ADD')
    expect(politica.clasificarIntencion('quítame el lips del carrito')).toBe('CART_REMOVE')
    expect(politica.clasificarIntencion('vacía mi carrito')).toBe('CART_REMOVE')
    expect(politica.clasificarIntencion('cambia a 3 piezas')).toBe('CART_UPDATE')
    expect(politica.clasificarIntencion('ver mi carrito')).toBe('CART_VIEW')
    expect(politica.clasificarIntencion('me interesa el hyalux')).not.toMatch(/CART_/)
  })
})
