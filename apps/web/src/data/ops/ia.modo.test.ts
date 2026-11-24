// IA-MODO (24 nov 2026, dueño) · «Solo recepción»: la IA recibe, reconoce y pasa con el asesor. Proveedor y base FALSOS.
//   · el modelo solo ve herramientas de reconocer/informar/pasar (sin precio, cotización, carrito, checkout ni pedido);
//   · si aun así pide una de venta, se rechaza y no llega a la base;
//   · la TAREA del turno es la de recepción (sin la política de vendedor ni el perfil comercial con montos);
//   · en «Venta completa» (por defecto) todo queda como antes;
//   · responder.ts lee cc_ia_config.modo y, en recepción, pasa la conversación al asesor (_cc_canal_transferir).
import { describe, it, expect } from 'vitest'
import { ejecutarTurno, type DepsOrquestador, type CanalTurno } from '../../../../../supabase/functions/_shared/ia/orquestador'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { crearProveedorFalso, respuestaTexto, respuestaHerramientas } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { REGLAS_IA } from '../../../../../supabase/functions/_shared/conocimiento'
import responderSrc from '../../../../../supabase/functions/_shared/ia/responder.ts?raw'
import migracion from '../../../../../supabase/migrations/20270407840000_ia_modo.sql?raw'

const A = '11111111-1111-4111-8111-111111111111', CONV = '99999999-9999-4999-8999-999999999999'
function base() {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const rpc: DepsOrquestador['rpc'] = async (fn, args) => {
    llamadas.push({ fn, args })
    switch (fn) {
      case 'cc_ia_contexto_actor': return { data: { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }, error: null }
      case 'cc_ia_turno_reclamar': return { data: { estado: 'reclamado', turn_id: 't1' }, error: null }
      case 'cc_ia_estado_handoff': return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active' }, error: null }
      case 'cc_catalogo_para_ia': return { data: [{ product_id: A, nombre: 'Hyalux Deep 1 ml' }], error: null }
      case 'cc_buscar_productos': return { data: [{ product_id: A, nombre: 'Hyalux Deep 1 ml' }], error: null }
      case 'cc_ia_perfil_comercial': return { data: { tipo: 'doctor', compras: [{ product_id: A, nombre: 'Hyalux Deep 1 ml', precio: 1000 }] }, error: null }
      case 'cc_ia_precio': return { data: { autorizado: true, product_id: A, precio_unitario: 1000, total: 1000 }, error: null }
      case 'cc_solicitar_asesor': return { data: { modo: 'human_requested', asesor: true }, error: null }
      case 'cc_ia_herramienta_registrar': return { data: 'tc', error: null }
      case 'cc_ia_turno_responder': return { data: { persistido: true }, error: null }
      case 'cc_ia_media_caja': return { data: [], error: null }
    }
    return { data: null, error: null }
  }
  return { rpc, llamadas }
}
const deps = (db: ReturnType<typeof base>, guion: Parameters<typeof crearProveedorFalso>[0]) => ({
  rpc: db.rpc, leerMensajes: async () => [{ actor: 'doctor', content: '¿cuánto cuesta hyalux deep? quiero 3' }],
  proveedor: crearProveedorFalso(guion), config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 3, historial: 12 },
  politica, herramientas, validacion, reglasConocimiento: REGLAS_IA,
})
const entrada = (recepcion: boolean, canal: CanalTurno = 'portal') => ({ conv: CONV, triggerSeq: 5, actor: 'doctor' as const, profile: 'uid-doc', visitorHash: null, textoUsuario: '¿cuánto cuesta hyalux deep? quiero 3', canal, ...(recepcion ? { recepcion } : {}) })
const VENTA = ['obtener_precio', 'cotizar', 'recomendar_productos', 'candidatos_comerciales', 'obtener_disponibilidad', 'ver_carrito', 'agregar_al_carrito', 'actualizar_carrito', 'quitar_del_carrito', 'vaciar_carrito', 'preparar_checkout', 'declinar_asesor', 'revisar_pedido', 'confirmar_pedido', 'pedir_link_pago', 'guardar_direccion']

describe('IA-MODO · Solo recepción', () => {
  it('portal · el modelo no ve herramientas de venta; la tarea es de recepción; sin perfil comercial con montos', async () => {
    const db = base(); const d = deps(db, [respuestaTexto('¡Hola, doctor! Con gusto. Su asesora le confirma el precio de Hyalux Deep en un momento.')])
    const r = await ejecutarTurno(entrada(true), d)
    expect(r.estado).toBe('respondio')
    const s = d.proveedor.solicitudes[0]
    const t = s.tools.map((x: { name: string }) => x.name)
    for (const n of VENTA) expect(t, n).not.toContain(n)
    expect(t).toEqual(expect.arrayContaining(['buscar_productos', 'solicitar_asesor']))
    expect(s.system).toContain('MODO RECEPCIÓN')
    expect(s.system).not.toContain(politica.POLITICA_VENDEDOR)
    expect(db.llamadas.some((l) => l.fn === 'cc_ia_perfil_comercial')).toBe(false)
  })
  it('whatsapp · si el modelo pide una herramienta de venta se rechaza y no llega a la base', async () => {
    const db = base(); const d = deps(db, [
      respuestaHerramientas([{ name: 'obtener_precio', input: { product_id: A } }, { name: 'agregar_al_carrito', input: { product_id: A, cantidad: 3 } }]),
      respuestaTexto('Con gusto lo atiende su asesora con el precio exacto.'),
    ])
    const r = await ejecutarTurno(entrada(true, 'whatsapp'), d)
    expect(r.estado).toBe('respondio')
    expect(db.llamadas.some((l) => l.fn === 'cc_ia_precio' || l.fn.startsWith('cc_carrito'))).toBe(false)
    const rechazos = db.llamadas.filter((l) => l.fn === 'cc_ia_herramienta_registrar' && l.args.p_status === 'no_autorizada').map((l) => l.args.p_tool)
    expect(rechazos).toEqual(expect.arrayContaining(['obtener_precio', 'agregar_al_carrito']))
  })
  it('Venta completa (por defecto) · todo como antes: precio y política de vendedor en el portal', async () => {
    const db = base(); const d = deps(db, [respuestaTexto('Hola, doctor.')])
    await ejecutarTurno(entrada(false), d)
    const s = d.proveedor.solicitudes[0]
    expect(s.tools.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(['obtener_precio', 'agregar_al_carrito']))
    expect(s.system).not.toContain('MODO RECEPCIÓN')
    expect(db.llamadas.some((l) => l.fn === 'cc_ia_perfil_comercial')).toBe(true)
  })
  it('responder · lee el modo de cc_ia_config (falla → completo) y en recepción pasa la conversación al asesor', () => {
    expect(responderSrc).toMatch(/from\('cc_ia_config'\)\.select\('modo'\)/)
    expect(responderSrc).toMatch(/catch \{ return 'completo' \}/)
    expect(responderSrc).toMatch(/recepcion && \(r === 'respondio' \|\| r === 'no_disponible'\)[\s\S]{0,400}_cc_canal_transferir[\s\S]{0,200}p_motivo: 'recepcion_ia'/)
  })
  it('migración · solo Dirección cambia el modo, queda en bitácora y el seguimiento proactivo solo avisa al vendedor', () => {
    expect(migracion).toMatch(/check \(modo in \('completo', 'recepcion'\)\)/)
    expect(migracion).toMatch(/function public\.ia_modo_guardar[\s\S]*_cc_exige_admin\(\)[\s\S]*log_audit/)
    expect(migracion).toMatch(/or v_recepcion then/)
  })
})
