// Vista previa SOLO en desarrollo (import.meta.env.DEV y ?preview=home): monta Inicio por rol, la alerta
// comercial en vivo, Conversaciones (apertura profunda) y Atención comercial con clientes FALSOS en estados
// fijos, para revisión visual (escritorio y móvil) sin tocar el servidor. No existe en producción.
//   ?preview=home&rol=vendedor|direccion|almacen|chofer|doctor&estado=…&vista=home|alerta|asesorias|atencion&modal=reasignar|cartera
//   Chat V2-C4 · ?preview=home&rol=doctor&vista=c4&paso=abre|modal|cerrar|e2 (auto-apertura reactiva del lanzador)
import React, { useEffect, useState } from 'react'
import { useRole } from '../auth/RoleContext'
import { AppShell } from '../app/AppShell'
import { ClienteChat, type ColaItem, type Conversacion, type Mensaje } from '../data/ops/chat'
import { ClienteCarrito, type Carrito } from '../data/ops/carrito'
import { ClienteAtencion, type Pendientes, type PendienteRuteo } from '../data/ops/atencion'
import type { Atencion, EstadoAtencion } from '../data/ops/atencionComercial'
import { configurarClientesAtencion } from '../data/store/atencionStore'
import { configurarClientesInicioDoctor } from '../screens/home/HomeDoctor'
import { _configurarClienteLanzador } from '../app/ChatFlotante'
import { chatUi } from '../data/store/chatUiStore'
import { _simularLlegada } from '../data/store/notificationsStore'
import { pedirIntento } from '../data/store/navIntentStore'
import { Asesorias } from '../screens/chat/Asesorias'
import { AtencionComercial } from '../screens/admin/AtencionComercial'
import type { RoleKey } from '../app/roles'

const at = (estado: EstadoAtencion, x: Partial<Atencion> = {}): Atencion => ({
  estado, modo: estado === 'activo' ? 'human_active' : estado === 'solicitado_sin_vendedor' ? 'human_requested' : 'human_assigned', handoff_estado: 'solicitado', handler_id: 'S1', ruteo_motivo: null,
  solicitado_at: null, handler_asignado_at: null, iniciado_at: null, terminado_at: null, espera_total_min: 9, espera_total_habil_min: null, espera_handler_min: 9, espera_handler_habil_min: null,
  reloj_sla_min: null, horario_configurado: false, en_horario: null, pausa_fuera_horario: true, umbral_aviso_min: 3, umbral_escalamiento_min: 7, ia_activa: estado !== 'activo', ...x,
})
const conHorario = (estado: EstadoAtencion, reloj: number): Atencion => at(estado, { horario_configurado: true, en_horario: true, reloj_sla_min: reloj, espera_handler_habil_min: reloj })
const item = (x: Partial<ColaItem>): ColaItem => ({ conversation_id: 'C1', modo: 'human_assigned', seller_profile_id: 'S1', asesoria_solicitada_at: null, last_message_at: null, es_mia: true, sin_leer: 0, dueno: 'Dr. David Espinoza', handoff_origen: 'carrito', n_items: 1, edad_min: 9, iniciada: false, ...x })

const COLAS: Record<string, ColaItem[]> = {
  vacio: [],
  esperando: [item({ atencion: at('horario_sin_configurar') })],
  aviso: [item({ atencion: conHorario('aviso', 4) }), item({ conversation_id: 'C2', dueno: 'Dra. Ana Ruiz', n_items: 3, edad_min: 2, atencion: conHorario('asignado_esperando', 1) })],
  escalado: [item({ atencion: conHorario('escalado', 8), edad_min: 12 })],
  activo: [item({ modo: 'human_active', iniciada: true, sin_leer: 2, atencion: at('activo') })],
}
const pend = (x: Partial<PendienteRuteo>): PendienteRuteo => ({ conversation_id: 'C1', dueno: 'doctor', profile_id: 'D1', nombre: 'Dr. David Espinoza', modo: 'human_assigned', seller_id: 'S1', seller_nombre: 'Lucía · Ventas', ruteo_motivo: null, origen: 'carrito', fuera_horario: false, solicitado_at: null, edad_min: 12, iniciada: false, cart_id: 'K', n_items: 1, ...x })
const horarioSin = { configurado: false, abierto: false, zona: 'America/Mazatlan', motivo: 'sin_configurar' }
const horarioOk = { configurado: true, abierto: true, zona: 'America/Mazatlan', motivo: 'abierto' }
const PENDIENTES: Record<string, Pendientes> = {
  normal: { resumen: { horario: horarioSin, sin_vendedor: 0, reasignacion: 0, handoffs_sin_asignar: 0, handoffs_pendientes: 0, vendedores_elegibles: 2 }, conversaciones: [pend({ modo: 'human_active', iniciada: true, atencion: at('activo') })], carritos_pendientes: [] },
  sin_vendedor: { resumen: { horario: horarioSin, sin_vendedor: 1, reasignacion: 0, handoffs_sin_asignar: 1, handoffs_pendientes: 0, vendedores_elegibles: 2 }, conversaciones: [pend({ conversation_id: 'C3', profile_id: 'D3', nombre: 'Dra. Carmen López', modo: 'human_requested', seller_id: null, seller_nombre: null, ruteo_motivo: 'sin_vendedor', n_items: 2, edad_min: 5, atencion: at('solicitado_sin_vendedor', { handler_id: null }) })], carritos_pendientes: [] },
  escalado: { resumen: { horario: horarioOk, sin_vendedor: 0, reasignacion: 0, handoffs_sin_asignar: 0, handoffs_pendientes: 0, vendedores_elegibles: 2 }, conversaciones: [pend({ atencion: conHorario('escalado', 8) }), pend({ conversation_id: 'C2', profile_id: 'D2', nombre: 'Dra. Ana Ruiz', edad_min: 2, atencion: conHorario('asignado_esperando', 1) })], carritos_pendientes: [] },
}

const ok = (data: unknown) => ({ data, error: null })
function chatFalso(cola: ColaItem[], conv?: Conversacion) {
  let lista = cola
  return new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string
    if (a === 'cola') return ok({ cola: lista })
    if (a === 'iniciar') { lista = lista.map((c) => (c.conversation_id === body.conversation_id ? { ...c, modo: 'human_active', iniciada: true, atencion: at('activo') } : c)); return ok({ modo: 'human_active' }) }
    if (a === 'abrir') return ok({ conversation_id: 'C1', estado: 'abierta', modo: conv?.modo ?? 'ai_active', nuevo: false })
    if (a === 'leer') return ok(conv ?? { conversation_id: body.conversation_id, estado: 'abierta', modo: 'human_active', rol: 'asesor', asesor_soy_yo: true, asesor_nombre: 'Lucía', ultimo_seq: 3, mensajes: MENSAJES, handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: null, asignado: true, puede_rechazar: false } })
    return ok({ ok: true })
  }, () => null)
}
const MENSAJES: Mensaje[] = [
  { id: 'm1', seq: 1, actor: 'doctor', content: '¿La Golden Placenta Mask tiene precio por volumen?', created_at: '2026-10-06T22:50:00Z', propio: false },
  { id: 'm2', seq: 2, actor: 'ai', content: 'Sí: a partir de 3 piezas aplica precio por volumen. Tu asesora te confirma el total.', created_at: '2026-10-06T22:50:10Z', propio: false },
  { id: 'm3', seq: 3, actor: 'system', content: 'Lucía se unió a la conversación.', created_at: '2026-10-06T22:55:00Z', propio: false },
]
function atencionFalsa(p: Pendientes) {
  const vendedores = [{ id: 'S1', nombre: 'Lucía · Ventas', activo: true, conversaciones: true, nuevos_clientes: true, elegible: true, elegible_nuevos: true, clientes: 1 }, { id: 'S2', nombre: 'Ana · Ventas', activo: true, conversaciones: true, nuevos_clientes: true, elegible: true, elegible_nuevos: true, clientes: 0 }]
  return new ClienteAtencion(async (fn) => {
    if (fn === 'cc_ruteo_pendientes') return ok(p)
    if (fn === 'cc_vendedores') return ok(vendedores)
    if (fn === 'cc_cartera_listar') return ok([{ profile_id: 'D1', nombre: 'Dr. David Espinoza', verificado: true, activo: true, vendedor_id: 'S1', vendedor_nombre: 'Lucía · Ventas', vendedor_elegible: true, requiere_reasignacion: false, asignado_at: null, vendedor_historico: null }])
    if (fn === 'cc_atencion_config_ver') return ok({ aviso_min: 3, escalamiento_min: 7, pausar_fuera_horario: true, updated_at: null, horario: p.resumen.horario })
    if (fn === 'cc_horario_ver') return ok({ zona: 'America/Mazatlan', configurado: false, actualizado_at: '', semana: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia: d, abierto: false, abre: null, cierra: null })), excepciones: [], estado: p.resumen.horario })
    return ok({})
  })
}
const cartDoctor = (n: number): Carrito => ({ cart_id: 'K', estado: 'active', rev: 5, dueno: 'profile', audiencia: 'verified', puede_precio: true, conversation_id: 'C1', n_items: n, cantidad_total: n, total: { estado: 'completo', monto: 350 * n }, items: n ? [{ product_id: 'P', nombre: 'Golden Placenta Mask', presentacion: null, imagen_url: null, cantidad: n, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado', unitario: 350, subtotal: 350 * n } }] : [] })

// Chat V2-C4 · conversación del doctor que "recibe" mensajes: contrato real de `leer` (seq, propio, sesión abierta).
const C4 = (() => {
  const mensajes: Mensaje[] = [
    { id: 'c1', seq: 1, actor: 'doctor', content: '¿Tienen la Golden Placenta Mask en caja de 5?', created_at: new Date(Date.now() - 600_000).toISOString(), propio: true },
    { id: 'c2', seq: 2, actor: 'ai', content: 'Sí, la manejamos en caja de 5 piezas. ¿Quieres que tu asesora te confirme el precio por volumen?', created_at: new Date(Date.now() - 590_000).toISOString(), propio: false },
  ]
  let leido = 2
  const sesion = { id: 'S2', ordinal: 2, estado: 'abierta' as const, origen: 'cliente', first_seq: 1, last_seq: null, opened_at: new Date(Date.now() - 600_000).toISOString(), closed_at: null, close_reason: null }
  const cliente = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string
    const ult = mensajes.length
    if (a === 'abrir') return ok({ conversation_id: 'C1', estado: 'abierta', modo: 'human_active', nuevo: false })
    if (a === 'leer') { const d = Number(body.desde_seq ?? 0); return ok({ conversation_id: 'C1', estado: 'abierta', modo: 'human_active', rol: 'dueno', ultimo_seq: ult, leido_hasta: leido, asesor_nombre: 'Lucía', sesion, cart_id: null, handoff: { origen: 'manual', cart_id: null, fuera_horario: false, asignado: true, puede_rechazar: false }, mensajes: mensajes.filter((m) => m.seq > d) }) }
    if (a === 'leido') { leido = Math.max(leido, Number(body.seq)); return ok({ ok: true }) }
    if (a === 'sesiones') return ok({ conversation_id: 'C1', sesiones: [] })
    return ok({ ok: true })
  }, () => null)
  const llega = (actor: Mensaje['actor'], content: string) => { const seq = mensajes.length + 1; mensajes.push({ id: 'c' + seq, seq, actor, content, created_at: new Date().toISOString(), propio: false }) }
  return { cliente, llega }
})()

const PERFILES: Record<string, { role: RoleKey; name: string; email: string; caps: string[] }> = {
  vendedor: { role: 'pos', name: 'Lucía Hernández · Ventas', email: 'ventas1@renovacell.mx', caps: ['conversaciones'] },
  direccion: { role: 'admin', name: 'Alberto Gutiérrez · Dirección', email: 'admin@renovacell.mx', caps: [] },
  almacen: { role: 'warehouse', name: 'Alberto · Almacén', email: 'almacen@renovacell.mx', caps: [] },
  chofer: { role: 'driver', name: 'Beto · Chofer', email: 'chofer2@renovacell.mx', caps: [] },
  doctor: { role: 'doctor', name: 'Dr. David Espinoza', email: 'david@renovacell.mx', caps: [] },
}

export function HomePreview() {
  const q = new URLSearchParams(window.location.search)
  const rol = q.get('rol') ?? 'vendedor'
  const estado = q.get('estado') ?? 'esperando'
  const vista = q.get('vista') ?? 'home'
  const perfil = PERFILES[rol] ?? PERFILES.vendedor
  const { login, mode } = useRole()
  const [listo, setListo] = useState(false)

  useEffect(() => {
    const p = PENDIENTES[estado] ?? PENDIENTES.normal
    const cola = COLAS[estado] ?? COLAS.esperando
    configurarClientesAtencion({ chat: chatFalso(cola), atencion: atencionFalsa(p) })
    const doctorConv: Conversacion | undefined = estado === 'asesoria' || estado === 'asesoria_sin_carrito' ? { conversation_id: 'C1', estado: 'abierta', modo: 'human_active', ultimo_seq: 8, asesor_nombre: 'Lucía', mensajes: [], handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: null, asignado: true, puede_rechazar: false }, cart_id: 'K' }
      : estado === 'carrito' ? { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', ultimo_seq: 2, mensajes: [], cart_id: 'K' }
        : { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', ultimo_seq: 0, mensajes: [], cart_id: null }
    const chatDoctor = chatFalso([], vista === 'autoapertura' || vista === 'cerrado' ? { conversation_id: 'C1', estado: 'abierta', modo: 'human_requested', ultimo_seq: 2, leido_hasta: 0, mensajes: MENSAJES.slice(0, 2).map((m) => (m.actor === 'doctor' ? { ...m, propio: true } : m)), handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: null, asignado: false, puede_rechazar: true }, cart_id: 'K' } : doctorConv)
    configurarClientesInicioDoctor({ chat: chatDoctor, carrito: new ClienteCarrito(async () => ok(cartDoctor(estado === 'asesoria' ? 1 : estado === 'carrito' ? 2 : 0)), () => null) })
    _configurarClienteLanzador(vista === 'c4' ? C4.cliente : chatDoctor)
    login(perfil.role, true, { name: perfil.name, email: perfil.email }, perfil.caps)
    setListo(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Doctor: simula la respuesta del servidor a la mutación del primer artículo (handoff nuevo) → presentación.
  useEffect(() => {
    if (!listo || (vista !== 'autoapertura' && vista !== 'cerrado')) return
    try { sessionStorage.clear() } catch { /* sin storage */ }
    const t1 = setTimeout(() => chatUi.solicitarApertura({ motivo: 'first_item_handoff', conversationId: 'C1', cartId: 'K-' + Date.now() }), 700)
    const t2 = vista === 'cerrado' ? setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), 1300) : undefined
    return () => { clearTimeout(t1); if (t2) clearTimeout(t2) }
  }, [listo, vista])

  // Chat V2-C4 · llega actividad nueva (asesor) y se fuerza el tick de la burbuja (visibilitychange) para no esperar 30 s.
  useEffect(() => {
    if (!listo || vista !== 'c4') return
    try { sessionStorage.clear() } catch { /* sin storage */ }
    const paso = q.get('paso') ?? 'abre'
    const tick = () => document.dispatchEvent(new Event('visibilitychange'))
    const ts: number[] = []
    const en = (ms: number, f: () => void) => { ts.push(window.setTimeout(f, ms)) }
    if (paso === 'modal') en(600, () => { const o = document.createElement('div'); o.className = 'overlay'; o.id = 'c4-modal'; o.innerHTML = '<div class="modal" style="padding:24px;max-width:360px;background:#fff;border-radius:14px"><b>Reportar pago</b><p style="margin:8px 0 0;font-size:14px">Modal crítico abierto: la auto-apertura se difiere.</p></div>'; document.body.appendChild(o) })
    en(1500, () => { C4.llega('seller', 'Doctor, ya le preparé el pedido con precio por volumen. ¿Lo confirmamos?'); tick() })
    if (paso === 'cerrar' || paso === 'e2') en(2600, () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    if (paso === 'cerrar' || paso === 'e2') en(3400, tick)
    if (paso === 'e2') en(4200, () => { C4.llega('seller', 'Le confirmo: sale hoy por paquetería.'); tick() })
    return () => ts.forEach((t) => clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, vista])

  // Alerta: simula la llegada en vivo de un aviso ya emitido por el servidor (misma ruta que Realtime).
  useEffect(() => {
    if (!listo || vista !== 'alerta') return
    const t = setTimeout(() => {
      const direccion = perfil.role === 'admin'
      const conv = direccion ? (estado === 'sin_vendedor' ? 'C3' : 'C1') : 'C1'
      const kind = direccion ? (estado === 'sin_vendedor' ? 'handoff_sin_vendedor' : 'handoff_escalado') : estado === 'aviso' ? 'handoff_aviso' : 'handoff_asignado'
      _simularLlegada({ id: 'prev-' + Date.now(), text: 'Solicitud de asesor', at: '2026-10-06T22:55:00Z', read: false, kind, conversationId: conv, eventKey: `preview:${kind}:${Date.now()}`, screen: direccion ? 'av_atencion' : 'asesorias', userIds: direccion ? undefined : ['S1'], roles: direccion ? ['admin'] : undefined })
    }, 700)
    return () => clearTimeout(t)
  }, [listo, vista, estado, perfil.role])

  if (vista === 'asesorias') return <PreviewAsesorias estado={estado} deep={q.get('deep') !== '0'} />
  if (vista === 'atencion') return <PreviewAtencion estado={estado} modal={q.get('modal')} />
  if (!listo || mode !== 'app') return null
  return <AppShell />
}

function AbrirCartera() {
  useEffect(() => { const t = setTimeout(() => (document.querySelector('[data-testid="btn-cambiar-cartera"]') as HTMLButtonElement | null)?.click(), 600); return () => clearTimeout(t) }, [])
  return null
}

function PreviewAsesorias({ estado, deep }: { estado: string; deep: boolean }) {
  const [c] = useState(() => { if (deep) pedirIntento({ destino: 'asesorias', conversationId: 'C1', iniciar: true, origen: 'inicio' }); return chatFalso(COLAS[estado] ?? COLAS.esperando) })
  return <div style={{ padding: 20, background: 'var(--bg-2)', minHeight: '100dvh' }}><Asesorias cliente={c} intervaloMs={600_000} /></div>
}
function PreviewAtencion({ estado, modal }: { estado: string; modal: string | null }) {
  const [clientes] = useState(() => {
    const p = PENDIENTES[estado] ?? PENDIENTES.escalado
    pedirIntento({ destino: 'av_atencion', conversationId: p.conversaciones[0].conversation_id, reasignar: modal === 'reasignar', origen: 'inicio' })
    return { a: atencionFalsa(p), c: chatFalso([]) }
  })
  return <div style={{ padding: 20, background: 'var(--bg-2)', minHeight: '100dvh' }}><AtencionComercial cliente={clientes.a} chat={clientes.c} onAbrir={() => {}} />{modal === 'cartera' && <AbrirCartera />}</div>
}
