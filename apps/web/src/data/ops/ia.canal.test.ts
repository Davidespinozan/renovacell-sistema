// LIVE C1 · Seguridad de identidad por CANAL y contexto de canal en la IA (proveedor FALSO, base FALSA; nunca Anthropic ni red).
//   · WhatsApp/Instagram/Messenger: la IA opera SIEMPRE con audiencia pública aunque la conversación sea de un doctor
//     verificado (coincidencia de teléfono/PSID): el perfil nunca llega a cc_ia_contexto_actor ni a precio/stock/pedidos;
//     sin carrito, checkout ni pedidos; la petición del modelo de esas herramientas se rechaza; enlace_portal disponible.
//   · Portal: el doctor conserva exactamente lo de antes (prompt idéntico, herramientas de cuenta y carrito).
//   · La vinculación comercial (actor/perfil de la conversación para solicitar_asesor, cartera) se conserva.
import { describe, it, expect } from 'vitest'
import { ejecutarTurno, type DepsOrquestador, type CanalTurno } from '../../../../../supabase/functions/_shared/ia/orquestador'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { REGLAS_IA } from '../../../../../supabase/functions/_shared/conocimiento'
import { URL_SISTEMA } from '../../../../../supabase/functions/_shared/invitacion'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'
import chatEdge from '../../../../../supabase/functions/chat/index.ts?raw'
import responderSrc from '../../../../../supabase/functions/_shared/ia/responder.ts?raw'
import orqSrc from '../../../../../supabase/functions/_shared/ia/orquestador.ts?raw'

const A = '11111111-1111-4111-8111-111111111111', CONV = '99999999-9999-4999-8999-999999999999'
const DOC = 'uid-doctor-verificado'

/** Base falsa mínima: el contexto del actor depende SOLO de p_profile (como cc_ia_contexto_actor real). */
function base() {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
    llamadas.push({ fn, args })
    switch (fn) {
      case 'cc_ia_contexto_actor':
        return args.p_profile
          ? { data: { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }, error: null }
          : { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      case 'cc_ia_turno_reclamar': return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:5', attempts: 1 }, error: null }
      case 'cc_ia_estado_handoff': return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active' }, error: null }
      case 'cc_catalogo_para_ia': return { data: [{ product_id: A, nombre: 'Hyalux Deep 1 ml' }], error: null }
      case 'cc_buscar_productos': return { data: [{ product_id: A, nombre: 'Hyalux Deep 1 ml', familia: 'Hyalux', categoria: 'Rellenos', audiencia: args.p_audiencia }], error: null }
      case 'cc_ia_precio': return { data: args.p_profile ? { autorizado: true, product_id: args.p_product, nombre: 'Hyalux Deep 1 ml', cantidad: 1, precio_unitario: 1000, total: 1000 } : { autorizado: false, motivo: 'PRICE_REQUIRES_VERIFICATION' }, error: null }
      case 'cc_ia_disponibilidad': return { data: args.p_profile ? { autorizado: true, estado: 'disponible' } : { autorizado: false, motivo: 'AVAILABILITY_REQUIRES_VERIFICATION' }, error: null }
      case 'cc_ia_estado_pedido': return { data: args.p_profile ? { autorizado: true, pedidos: [{ folio: 'S100001', estado: 'paid' }] } : { autorizado: false }, error: null }
      case 'cc_carrito_abrir': return { data: { cart_id: 'cart-1' }, error: null }
      case 'cc_carrito_ver': return { data: { cart_id: 'cart-1', items: [], puede_precio: !!args.p_profile }, error: null }
      case 'cc_solicitar_asesor': return { data: { modo: 'human_requested', asesor: true }, error: null }
      case 'cc_ia_herramienta_registrar': return { data: 'tc', error: null }
      case 'cc_ia_turno_responder': return { data: { persistido: true, idempotente: false, message_id: 'm-ai', seq: 7 }, error: null }
      case 'cc_ia_turno_fallar': return { data: { estado: 'failed' }, error: null }
      case 'cc_ia_aviso_no_disponible': return { data: {}, error: null }
    }
    return { data: null, error: { message: 'fn desconocida ' + fn } }
  }
  return { rpc, llamadas }
}
const deps = (db: ReturnType<typeof base>, guion: Parameters<typeof crearProveedorFalso>[0]): DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> } => ({
  rpc: db.rpc, leerMensajes: async () => [{ actor: 'doctor', content: 'hola' }],
  proveedor: crearProveedorFalso(guion), config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 3, historial: 12 },
  politica, herramientas, validacion, reglasConocimiento: REGLAS_IA,
})
/** Conversación de un DOCTOR VERIFICADO (como la que abre cc_wa_entrante al coincidir el teléfono). */
const entradaDoctor = (canal?: CanalTurno) => ({ conv: CONV, triggerSeq: 5, actor: 'doctor' as const, profile: DOC, visitorHash: null, textoUsuario: '¿cuánto cuesta hyalux deep y cómo va mi pedido?', canal })
const entradaVisitante = (canal: CanalTurno) => ({ conv: CONV, triggerSeq: 5, actor: 'visitor' as const, profile: null, visitorHash: 'h'.repeat(64), textoUsuario: 'hola, ¿tienen hyalux?', canal })
const nombres = (d: { proveedor: { solicitudes: Array<{ tools: Array<{ name: string }> }> } }, i = 0) => d.proveedor.solicitudes[i].tools.map((t) => t.name)

describe('LIVE C1 · identidad por canal: fuera del portal la IA es audiencia pública', () => {
  for (const canal of ['whatsapp', 'instagram', 'messenger'] as const) {
    it(`${canal} · número/PSID coincidente con doctor VERIFICADO → la IA NO recibe el perfil: audiencia pública, precio y pedidos NO autorizados, sin carrito`, async () => {
      const db = base()
      const d = deps(db, [
        respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'hyalux deep' } }]),
        respuestaHerramientas([{ name: 'obtener_precio', input: { product_id: A } }, { name: 'obtener_estado_pedido', input: {} }, { name: 'ver_carrito', input: {} }, { name: 'obtener_disponibilidad', input: { product_id: A } }]),
        respuestaTexto('Para ver precio y disponibilidad necesitas tu cuenta verificada en el portal.'),
      ])
      const r = await ejecutarTurno(entradaDoctor(canal), d)
      expect(r.estado).toBe('respondio')
      // 1) el contexto del actor se pidió SIN perfil
      expect(db.llamadas.find((l) => l.fn === 'cc_ia_contexto_actor')!.args).toEqual({ p_profile: null })
      // 2) herramientas ofrecidas al modelo: nada de cuenta ni carrito; sí enlace_portal
      const t = nombres(d)
      for (const n of ['ver_carrito', 'agregar_al_carrito', 'actualizar_carrito', 'quitar_del_carrito', 'vaciar_carrito', 'preparar_checkout', 'obtener_estado_pedido']) expect(t, n).not.toContain(n)
      expect(t).toEqual(expect.arrayContaining(['buscar_productos', 'obtener_precio', 'obtener_disponibilidad', 'solicitar_asesor', 'enlace_portal']))
      // 3) precio y disponibilidad se consultaron con perfil NULL → no autorizados; sin evidencia de precio
      expect(db.llamadas.find((l) => l.fn === 'cc_ia_precio')!.args).toMatchObject({ p_profile: null })
      expect(db.llamadas.find((l) => l.fn === 'cc_ia_disponibilidad')!.args).toMatchObject({ p_profile: null })
      expect(r.evidencia).not.toContain('PRICE_EVIDENCE'); expect(r.evidencia).not.toContain('STOCK_EVIDENCE'); expect(r.evidencia).not.toContain('ORDER_EVIDENCE')
      // 4) pedidos y carrito pedidos por el modelo: rechazados ANTES de tocar la base
      expect(db.llamadas.some((l) => l.fn === 'cc_ia_estado_pedido' || l.fn === 'cc_carrito_abrir' || l.fn === 'cc_carrito_ver')).toBe(false)
      const rechazos = db.llamadas.filter((l) => l.fn === 'cc_ia_herramienta_registrar' && ['rechazada', 'no_autorizada'].includes(String(l.args.p_status))).map((l) => l.args.p_tool)
      expect(rechazos).toEqual(expect.arrayContaining(['obtener_estado_pedido', 'ver_carrito']))
      // 5) el prompt declara el canal y la identidad no verificada
      const sys = d.proveedor.solicitudes[0].system
      expect(sys).toContain('CANAL: el usuario escribe por'); expect(sys).toContain('SIN sesión iniciada'); expect(sys).toContain('enlace_portal'); expect(sys).toContain('visitante sin cuenta')
      expect(sys).not.toContain('VERIFICADO. Puede ver información técnica')
    })
  }
  it('prospecto desconocido por WhatsApp → audiencia pública (igual que un visitante del portal) y el enlace oficial sin datos', async () => {
    const db = base()
    const d = deps(db, [respuestaHerramientas([{ name: 'enlace_portal', input: {} }]), respuestaTexto('Puedes registrarte en el portal: ' + URL_SISTEMA)])
    const r = await ejecutarTurno(entradaVisitante('whatsapp'), d)
    expect(r.estado).toBe('respondio'); expect(r.evidencia).toContain('PORTAL_LINK_EVIDENCE')
    expect(db.llamadas.find((l) => l.fn === 'cc_ia_contexto_actor')!.args).toEqual({ p_profile: null })
    const msgs = d.proveedor.solicitudes[1].messages; const resultado = JSON.stringify(msgs[msgs.length - 1])
    expect(resultado).toContain(URL_SISTEMA); expect(resultado).not.toMatch(/token|uid|hash|\?[a-z]+=/i)
    expect(herramientas.URL_PORTAL_PUBLICA).toBe(URL_SISTEMA); expect(herramientas.ejecutarEnlacePortal()).toEqual({ url: URL_SISTEMA, uso: expect.stringContaining('verifica') })
  })
  it('portal · el mismo doctor verificado conserva TODO: perfil al contexto, precio autorizado, pedidos y carrito ofrecidos, prompt sin bloque de canal', async () => {
    const db = base()
    const d = deps(db, [
      respuestaHerramientas([{ name: 'buscar_productos', input: { consulta: 'hyalux deep' } }]),
      respuestaHerramientas([{ name: 'obtener_precio', input: { product_id: A } }, { name: 'obtener_estado_pedido', input: {} }]),
      respuestaTexto('Hyalux Deep 1 ml cuesta $1,000 MXN y tu pedido S100001 está pagado.'),
    ])
    const r = await ejecutarTurno(entradaDoctor(), d)   // sin canal = portal
    expect(r.estado).toBe('respondio'); expect(r.evidencia).toEqual(expect.arrayContaining(['PRICE_EVIDENCE', 'ORDER_EVIDENCE']))
    expect(db.llamadas.find((l) => l.fn === 'cc_ia_contexto_actor')!.args).toEqual({ p_profile: DOC })
    expect(db.llamadas.find((l) => l.fn === 'cc_ia_precio')!.args).toMatchObject({ p_profile: DOC })
    expect(db.llamadas.find((l) => l.fn === 'cc_ia_estado_pedido')!.args).toMatchObject({ p_profile: DOC })
    const t = nombres(d); expect(t).toEqual(expect.arrayContaining(['obtener_estado_pedido', 'ver_carrito', 'preparar_checkout'])); expect(t).not.toContain('enlace_portal')
    const sys = d.proveedor.solicitudes[0].system
    expect(sys).not.toContain('CANAL:'); expect(sys).toContain('VERIFICADO')
    // el prompt del portal es byte a byte el de antes: construir con canal 'portal' o sin canal da lo mismo
    const entradaSys = { ctx: { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }, intencion: 'PRICE', limiteClinico: false, reglasConocimiento: REGLAS_IA, evidencia: ['EN_HORARIO'] }
    expect(politica.construirSistema({ ...entradaSys, canal: 'portal' })).toBe(politica.construirSistema(entradaSys))
    expect(politica.construirSistema(entradaSys)).not.toContain('CANAL:')
  })
  it('portal · doctor NO verificado sigue con restricciones públicas (la base decide): precio no autorizado; visitante del portal recibe enlace_portal', () => {
    const t = herramientas.herramientasPara(false, 'portal').map((h) => h.name)
    expect(t).toContain('enlace_portal'); expect(t).toContain('ver_carrito'); expect(t).not.toContain('obtener_estado_pedido')
    expect(herramientas.herramientasPara(true, 'portal').map((h) => h.name)).not.toContain('enlace_portal')
    const ctx = politica.contextoAutoridad({ actor: 'doctor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: true, verificado: false })
    expect(ctx).toContain('AÚN NO verificado')
  })
  it('validarLlamada: fuera del portal rechaza carrito/checkout/pedidos aunque el modelo las pida; en el portal, igual que antes', () => {
    const ctx = { conCuenta: true, idsAutorizados: new Set([A]), canal: 'whatsapp' as const }
    for (const n of herramientas.SOLO_PORTAL) expect(herramientas.validarLlamada(n, { product_id: A, cantidad: 1 }, ctx), n).toMatchObject({ ok: false, motivo: 'no_autorizada' })
    expect(herramientas.validarLlamada('buscar_productos', { consulta: 'x' }, ctx)).toMatchObject({ ok: true })
    expect(herramientas.validarLlamada('enlace_portal', {}, ctx)).toEqual({ ok: true, nombre: 'enlace_portal', args: {}, ids: [] })
    expect(herramientas.validarLlamada('ver_carrito', {}, { conCuenta: true, idsAutorizados: new Set([A]) })).toMatchObject({ ok: true })
    expect(herramientas.validarLlamada('obtener_estado_pedido', {}, { conCuenta: true, idsAutorizados: new Set(), canal: 'portal' })).toMatchObject({ ok: true })
    expect(herramientas.SOLO_PORTAL).toEqual(['ver_carrito', 'agregar_al_carrito', 'actualizar_carrito', 'quitar_del_carrito', 'vaciar_carrito', 'preparar_checkout', 'obtener_estado_pedido'])
  })
  it('contexto de canal en la política: texto plano, límite por canal, sin documentos; nada en portal', () => {
    expect(politica.contextoCanal('portal')).toBe('')
    const ig = politica.contextoCanal('instagram'); expect(ig).toContain('Instagram'); expect(ig).toContain('900 caracteres'); expect(ig).toContain('sin Markdown'); expect(ig).toContain('nunca pidas cédula, INE')
    expect(politica.contextoCanal('whatsapp')).toContain('WhatsApp'); expect(politica.contextoCanal('messenger')).toContain('Facebook Messenger')
    const sys = politica.construirSistema({ ctx: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, intencion: 'PRICE', limiteClinico: false, reglasConocimiento: REGLAS_IA, evidencia: [], canal: 'whatsapp' })
    expect(sys).toContain('CANAL: el usuario escribe por WhatsApp'); expect(sys.indexOf('CANAL:')).toBeGreaterThan(sys.indexOf('TAREA:'))
  })
  it('la vinculación comercial se conserva: solicitar_asesor desde WhatsApp sigue usando el actor/perfil de la CONVERSACIÓN (cartera), no el de la IA', async () => {
    const db = base()
    const d = deps(db, [respuestaHerramientas([{ name: 'solicitar_asesor', input: { motivo: 'quiere hablar con alguien' } }]), respuestaTexto('Ya pedí que un asesor te atienda aquí mismo.')])
    const r = await ejecutarTurno({ ...entradaDoctor('whatsapp'), textoUsuario: 'quiero hablar con un asesor' }, d)
    expect(r.estado).toBe('respondio'); expect(r.evidencia).toContain('HUMAN_REQUESTED')
    expect(db.llamadas.find((l) => l.fn === 'cc_solicitar_asesor')!.args).toMatchObject({ p_conv: CONV, p_actor_type: 'doctor', p_profile: DOC })   // la conversación del doctor → su vendedora de cartera
    expect(db.llamadas.find((l) => l.fn === 'cc_ia_contexto_actor')!.args).toEqual({ p_profile: null })                                           // pero la IA sigue siendo pública
  })
})

describe('LIVE C1 · guardas de fuente: el canal viaja hasta la política y el portal no cambia', () => {
  const sin = (s: string) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  it('meta-webhook pasa el canal real; el chat del portal NO pasa canal (por defecto portal); responder lo reenvía al orquestador', () => {
    expect(sin(webhook)).toMatch(/responderIA\(admin, r\.conversation_id, r\.seq, r\.actor, r\.profile_id, r\.visitor_hash, m\.texto, 'wa:' \+ m\.wa_id, 'whatsapp', adjunto\)/)   // R4-C13: + la imagen/PDF que la IA ve
    expect(sin(webhook)).toMatch(/responderIA\(admin, r\.conversation_id, r\.seq, 'visitor', null, r\.visitor_hash, m\.texto, 'meta:' \+ m\.psid, m\.canal\)/)
    expect(sin(chatEdge)).toMatch(/responderIA\(admin, conv, r\.seq, dueno, actor\.profile, hash, c\.texto, sujeto, 'portal', null, contacto\)/)   // portal explícito + datos de contacto pendientes
    expect(sin(responderSrc)).toMatch(/canal: CanalTurno = 'portal', adjunto: EntradaTurno\['adjunto'\] \| null = null, contacto: EntradaTurno\['contacto'\] = null\)/); expect(sin(responderSrc)).toMatch(/textoUsuario: texto, canal, \.\.\.\(adjunto \? \{ adjunto \} : \{\}\), \.\.\.\(contacto \? \{ contacto \} : \{\}\) \}/)   // R4-C13 + CONTACTO CONVERSACIONAL
    expect(sin(responderSrc)).toMatch(/canal === 'portal' \? contacto : null\)/)   // los datos de contacto solo existen en el portal
    expect(sin(orqSrc)).toMatch(/const perfilIA: string \| null = canal === 'portal' \? e\.profile : null/)
    expect(sin(orqSrc)).toMatch(/rpc\('cc_ia_contexto_actor', \{ p_profile: perfilIA \}\)/)
    for (const fn of ['cc_ia_precio', 'cc_ia_disponibilidad', 'cc_ia_estado_pedido']) expect(sin(orqSrc)).toMatch(new RegExp(`rpc\\('${fn}', \\{ p_profile: t\\.perfilIA`))
    expect(sin(orqSrc)).not.toMatch(/rpc\('cc_ia_(precio|disponibilidad|estado_pedido)', \{ p_profile: e\.profile/)
    // la IA sigue callada en human_active: la compuerta IA_PUEDE del webhook no cambió
    expect(sin(webhook)).toMatch(/if \(IA_PUEDE\(r\.modo as never\)\)/)
  })
})
