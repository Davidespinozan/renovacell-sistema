// @vitest-environment jsdom
// Chat V2-C3 · Historial de sesiones (H1–H15, T16–T25). Cliente falso que registra cada acción: el historial
// solo LEE (sesiones / leer_sesion); con HISTORIAL visible no se marca leído y la actividad nueva se avisa.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { HistorialConversacion, type CacheSesion } from './HistorialSesiones'
import { Customer360Page } from '../../app/Customer360'
import { ClienteChat, type Conversacion, type Mensaje, type SesionListada } from '../../data/ops/chat'
import { ClienteCarrito, type Carrito } from '../../data/ops/carrito'
import { ClienteC360, type Cliente360 } from '../../data/ops/customer360'
import { ClienteAtencion } from '../../data/ops/atencion'
import { etiquetaActor, motivoCierre, quienAtendio, rangoSesion } from '../../data/ops/sesionesPresentacion'
import fuenteLector from './HistorialSesiones.tsx?raw'

afterEach(cleanup)

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const m = (seq: number, actor: Mensaje['actor'], content: string, propio = false): Mensaje => ({ id: 'm' + seq, seq, actor, content, created_at: hace(200 - seq), propio })
const ses = (id: string, x: Partial<SesionListada> = {}): SesionListada => ({ id, ordinal: 1, estado: 'cerrada', origen: 'cliente', first_seq: 1, last_seq: 9, opened_at: hace(140), closed_at: hace(100), close_reason: 'asesor_finalizo', actual: false, last_activity_at: hace(100), n_mensajes: 9, asesor_nombre: 'Lucía · Ventas', ...x })
const conv = (x: Partial<Conversacion>): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: 0, mensajes: [], leido_hasta: 0, ...x })

const S1_MSGS = [m(1, 'doctor', 'Quiero cotizar 3 cajas.', true), m(2, 'seller', 'Con gusto, doctor.'), m(3, 'system', 'La asesoría terminó.')]
const S1 = ses('S1', { last_seq: 3, n_mensajes: 3 })
const S2 = ses('S2', { ordinal: 2, estado: 'abierta', closed_at: null, close_reason: null, actual: true, asesor_nombre: null, first_seq: 4, last_seq: null, n_mensajes: 2 })
const ACTUAL = [m(4, 'doctor', 'Hola de nuevo.', true), m(5, 'ai', 'Hola, ¿en qué te ayudo hoy?')]
const convActual = (extra: Mensaje[] = []) => conv({ ultimo_seq: 5 + extra.length, mensajes: [...ACTUAL, ...extra], sesion: { ...S2 } })
const convSinAbierta = () => conv({ ultimo_seq: 3, leido_hasta: 3, mensajes: S1_MSGS, sesion: { ...S1 } })

const LECTURA = new Set(['abrir', 'leer', 'sesiones', 'leer_sesion'])
type Body = Record<string, unknown>
function servidor(init: { conv: Conversacion; sesiones?: SesionListada[]; detalle?: Record<string, Mensaje[]>; sinAcceso?: boolean; ignorarDesde?: boolean }) {
  const st = { conv: init.conv, sesiones: init.sesiones ?? [], detalle: init.detalle ?? { S1: S1_MSGS }, ignorarDesde: !!init.ignorarDesde }
  const llamadas: Body[] = []
  const negado = () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'no_autorizado', message: 'No tienes acceso a esta conversación.' })) } })
  const cliente = new ClienteChat(async (_fn, { body }) => {
    llamadas.push(body)
    const a = body.action as string
    if (a === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: st.conv.modo, nuevo: false }, error: null }
    if (a === 'leer') { const d = st.ignorarDesde ? 0 : Number(body.desde_seq ?? 0); return { data: { ...st.conv, mensajes: st.conv.mensajes.filter((x) => x.seq > d) }, error: null } }
    if (a === 'sesiones') return init.sinAcceso ? negado() : { data: { conversation_id: body.conversation_id, sesiones: st.sesiones }, error: null }
    if (a === 'leer_sesion') {
      const msgs = st.detalle[body.session_id as string]
      if (init.sinAcceso || !msgs) return negado()
      const meta = st.sesiones.find((s) => s.id === body.session_id) ?? S1
      return { data: { sesion: meta, rol: 'dueno', solo_lectura: true, mensajes: msgs.filter((x) => x.seq > Number(body.desde_seq ?? 0)).slice(0, 100) }, error: null }
    }
    if (a === 'enviar') {   // C1: el servidor abre la sesión nueva al recibir el mensaje (aquí, simulado)
      st.conv = conv({ ultimo_seq: 4, mensajes: [m(4, 'doctor', String(body.content), true)], sesion: { ...S2 } })
      return { data: { id: 'n', seq: 4, idempotente: false, modo: 'ai_active', ia: 'respondio' }, error: null }
    }
    return { data: { ok: true }, error: null }
  }, () => null)
  const acciones = () => llamadas.map((b) => b.action as string)
  const mutaciones = () => acciones().filter((a) => !LECTURA.has(a) && a !== 'leido')
  return { cliente, st, llamadas, acciones, mutaciones }
}
const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function abrirLista() { fireEvent.click(await screen.findByTestId('btn-historial')); return screen.findByTestId('historial') }

describe('H · historial de sesiones', () => {
  it('H1 · una cerrada y ninguna abierta: ACTUAL vacío + tarjeta, sin mensajes de la anterior y sin crear sesión', async () => {
    const s = servidor({ conv: convSinAbierta(), sesiones: [S1] })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    const tarjeta = await screen.findByTestId('tarjeta-anterior')
    expect(tarjeta.textContent).toMatch(/^Tu conversación anterior · (Hoy|Ayer|\d+ \w+)Ver$/)
    expect(screen.queryByText('Con gusto, doctor.')).toBeNull()
    expect(screen.getByTestId('msg-bienvenida')).toBeTruthy()
    expect((screen.getByLabelText('Escribe tu mensaje') as HTMLTextAreaElement).disabled).toBe(false)
    expect(s.mutaciones()).toEqual([])
  })
  it('H1b · la tarjeta abre directamente la conversación anterior', async () => {
    const s = servidor({ conv: convSinAbierta(), sesiones: [S1] })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    fireEvent.click(await screen.findByTestId('tarjeta-anterior-ver'))
    expect(await screen.findByText('Con gusto, doctor.')).toBeTruthy()
    expect(screen.getByTestId('hist-banda').textContent).toMatch(/^Conversación anterior/)
  })
  it('H2 · actual + cerrada: "Actual" arriba y entrar en ella vuelve a la superficie ACTUAL', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S2, S1] })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    await abrirLista()
    const items = await screen.findAllByRole('button', { name: /mensaje/ })
    expect(items[0].getAttribute('data-testid')).toBe('hist-actual')
    expect(items[0].textContent).toContain('Actual')
    fireEvent.click(items[0])
    expect(screen.queryByTestId('historial')).toBeNull()
    expect(screen.getByLabelText('Escribe tu mensaje')).toBeTruthy()
  })
  it('H3 / T19 / T20 · la sesión histórica es de solo lectura (sin redactor, carrito, handoff ni acciones)', async () => {
    const cart: Carrito = { cart_id: 'K', estado: 'active', rev: 1, dueno: 'profile', audiencia: 'verified', puede_precio: true, conversation_id: 'C1', n_items: 1, cantidad_total: 1, total: { estado: 'completo', monto: 350 }, items: [{ product_id: 'P', nombre: 'Golden Placenta Mask', presentacion: 'Caja', imagen_url: null, cantidad: 1, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado', unitario: 350, subtotal: 350 } }] }
    const carrito = new ClienteCarrito(async () => ({ data: cart, error: null }), () => null)
    const s = servidor({ conv: convActual(), sesiones: [S2, S1] })
    render(<ChatCanonico panel cliente={s.cliente} clienteCarrito={carrito} intervaloMs={600_000} />)
    expect(await screen.findByTestId('carrito-panel')).toBeTruthy()
    await abrirLista()
    fireEvent.click(await screen.findByTestId('hist-sesion'))
    expect(await screen.findByText('Con gusto, doctor.')).toBeTruthy()
    for (const id of ['carrito-panel', 'btn-enviar', 'btn-asesor', 'btn-reanudar', 'btn-iniciar', 'btn-terminar', 'aviso-handoff']) expect(screen.queryByTestId(id)).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(/Prefieres/)).toBeNull()
    expect(screen.getByTestId('hist-volver-actual').textContent).toBe('Volver a la conversación actual')
    expect(s.mutaciones()).toEqual([])
  })
  it('H4 · al volver, ACTUAL queda intacto (mismos mensajes y mismo cursor)', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S2, S1] })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={60} />)
    expect(await screen.findByText('Hola, ¿en qué te ayudo hoy?')).toBeTruthy()
    await abrirLista()
    fireEvent.click(await screen.findByTestId('hist-sesion'))
    await screen.findByText('Con gusto, doctor.')
    fireEvent.click(screen.getByTestId('hist-volver-actual'))
    expect(screen.getByText('Hola, ¿en qué te ayudo hoy?')).toBeTruthy()
    expect(screen.getByText('Hola de nuevo.')).toBeTruthy()
    expect(screen.queryByText('Con gusto, doctor.')).toBeNull()
    await esperar(150)
    const leer = s.llamadas.filter((b) => b.action === 'leer')
    expect(leer.slice(1).every((b) => b.desde_seq === 5)).toBe(true)   // el historial no movió el cursor de ACTUAL
  })
  for (const [n, nuevo] of [['H5 · mensaje del vendedor', m(6, 'seller', 'Doctor, ya quedó.')], ['H6 · respuesta de IA', m(6, 'ai', 'Te comparto el precio.')], ['H7 · handoff', m(6, 'system', 'Registramos tu solicitud de asesor.')]] as const) {
    it(`${n} con HISTORIAL visible → aviso, sin navegar`, async () => {
      const s = servidor({ conv: convActual(), sesiones: [S2, S1] })
      render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={50} />)
      await screen.findByText('Hola de nuevo.')
      await abrirLista()
      fireEvent.click(await screen.findByTestId('hist-sesion'))
      await screen.findByText('Con gusto, doctor.')
      s.st.conv = convActual([nuevo])
      const aviso = await screen.findByTestId('aviso-nuevo-actual')
      expect(aviso.getAttribute('role')).toBe('status')
      expect(aviso.getAttribute('aria-live')).toBe('polite')
      expect(aviso.textContent).toContain('Nuevo mensaje en la conversación actual')
      expect(screen.getByTestId('hist-banda')).toBeTruthy()          // sigue en el historial
      expect(screen.queryByText(nuevo.content)).toBeNull()
    })
  }
  it('H8 · cambio de cursor/estado sin mensajes → sin aviso; mensaje propio → sin aviso', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S2, S1] })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={40} />)
    await screen.findByText('Hola de nuevo.')
    await abrirLista()
    s.st.conv = { ...convActual(), leido_hasta: 5, modo: 'human_requested' }
    await esperar(150)
    expect(screen.queryByTestId('aviso-nuevo-actual')).toBeNull()
    s.st.conv = convActual([m(6, 'doctor', 'Lo escribí en otra pestaña.', true)])
    await esperar(150)
    expect(screen.queryByTestId('aviso-nuevo-actual')).toBeNull()
  })
  it('H9 / T18 · polling duplicado → un solo aviso; sin `leido` en HISTORIAL; "Ver" vuelve y marca leído una vez', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S2, S1], ignorarDesde: true })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={30} />)
    await screen.findByText('Hola de nuevo.')
    await waitFor(() => expect(s.llamadas.some((b) => b.action === 'leido' && b.seq === 5)).toBe(true))
    await abrirLista()
    s.st.conv = convActual([m(6, 'seller', 'Doctor, ya quedó.')])
    await screen.findByTestId('aviso-nuevo-actual')
    await esperar(200)
    expect(screen.getAllByTestId('aviso-nuevo-actual')).toHaveLength(1)
    expect(s.llamadas.filter((b) => b.action === 'leido' && b.seq === 6)).toHaveLength(0)
    fireEvent.click(screen.getByTestId('aviso-nuevo-ver'))
    expect(await screen.findByText('Doctor, ya quedó.')).toBeTruthy()
    expect(screen.queryByTestId('historial')).toBeNull()
    expect(screen.getAllByText('Doctor, ya quedó.')).toHaveLength(1)
    await waitFor(() => expect(s.llamadas.filter((b) => b.action === 'leido' && b.seq === 6)).toHaveLength(1))
    // Reentrar al historial: lo ya anunciado no se vuelve a avisar
    await abrirLista(); await esperar(150)
    expect(screen.queryByTestId('aviso-nuevo-actual')).toBeNull()
  })
  it('H10–H13 · copia humana de la lista (asesor, IA, motivo)', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S2, S1, ses('S0', { asesor_nombre: null, close_reason: 'inactividad', n_mensajes: 2 })] })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    await abrirLista()
    const [, hum, ia] = await screen.findAllByRole('button', { name: /mensaje/ })
    expect(hum.textContent).toContain('Atendida por Lucía · 3 mensajes')
    expect(hum.textContent).toContain('Finalizada por tu asesora')
    expect(hum.textContent).not.toMatch(/asesor_finalizo|Ventas/)
    expect(ia.textContent).toContain('Asistente · 2 mensajes')
    expect(ia.textContent).toContain('Cerrada por inactividad')
  })
  it('H14 · sin autorización → estado seguro, sin mensajes', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S2, S1], sinAcceso: true })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    await abrirLista()
    expect((await screen.findByTestId('hist-error')).textContent).toBe('No tienes acceso a esta conversación anterior.')
  })
  it('H15 · 120 sesiones: lista ligera (sin leer mensajes); 150 mensajes: 100 + "Cargar más"; caché inmutable', async () => {
    const muchas = Array.from({ length: 120 }, (_, i) => ses(`S${i + 10}`, { n_mensajes: 150, last_seq: 150 }))
    const largo = Array.from({ length: 150 }, (_, i) => m(i + 1, i % 2 ? 'ai' : 'doctor', `Texto ${i + 1}`, i % 2 === 0))
    const s = servidor({ conv: convActual(), sesiones: [S2, ...muchas], detalle: { S10: largo } })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    await abrirLista()
    expect(await screen.findAllByTestId('hist-sesion')).toHaveLength(120)
    expect(s.acciones().filter((a) => a === 'leer_sesion')).toHaveLength(0)
    fireEvent.click(screen.getAllByTestId('hist-sesion')[0])
    expect(await screen.findByText('Texto 100')).toBeTruthy()
    expect(screen.queryByText('Texto 101')).toBeNull()
    fireEvent.click(screen.getByTestId('hist-cargar-mas'))
    expect(await screen.findByText('Texto 150')).toBeTruthy()
    expect(s.llamadas.filter((b) => b.action === 'leer_sesion').map((b) => b.desde_seq)).toEqual([0, 100])
    expect(screen.queryByTestId('hist-cargar-mas')).toBeNull()
    fireEvent.click(screen.getByTestId('hist-atras'))
    fireEvent.click((await screen.findAllByTestId('hist-sesion'))[0])
    expect(await screen.findByText('Texto 150')).toBeTruthy()
    expect(s.acciones().filter((a) => a === 'leer_sesion')).toHaveLength(2)   // la sesión cerrada sale de la caché
  })
  it('Escape: SESIÓN → LISTA → ACTUAL (sin que el cajón se cierre)', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S2, S1] })
    let cerrado = false
    const onDoc = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrado = true }
    document.addEventListener('keydown', onDoc)
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    await abrirLista()
    fireEvent.click(await screen.findByTestId('hist-sesion'))
    const banda = await screen.findByTestId('hist-banda')
    await waitFor(() => expect(document.activeElement).toBe(banda))
    fireEvent.keyDown(banda, { key: 'Escape' })
    expect(await screen.findByTestId('hist-volver')).toBeTruthy()
    fireEvent.keyDown(screen.getByTestId('hist-volver'), { key: 'Escape' })
    expect(screen.queryByTestId('historial')).toBeNull()
    expect(cerrado).toBe(false)
    document.removeEventListener('keydown', onDoc)
  })
})

describe('T · invariantes', () => {
  it('T16 / T17 · abrir 🕘 y una sesión solo hace lecturas (ninguna mutación conversacional)', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S2, S1] })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    await screen.findByText('Hola de nuevo.')
    const antes = s.llamadas.length
    await abrirLista()
    fireEvent.click(await screen.findByTestId('hist-sesion'))
    await screen.findByText('Con gusto, doctor.')
    expect(s.llamadas.slice(antes).map((b) => b.action)).toEqual(['sesiones', 'leer_sesion'])
    expect(s.acciones().filter((a) => a === 'abrir')).toHaveLength(1)   // solo el montaje
  })
  it('T21 · ACTUAL sin sesión abierta permite escribir; la sesión nueva la crea el servidor al enviar', async () => {
    const s = servidor({ conv: convSinAbierta(), sesiones: [S1] })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    await screen.findByTestId('tarjeta-anterior')
    expect(s.acciones()).not.toContain('enviar')
    fireEvent.change(screen.getByLabelText('Escribe tu mensaje'), { target: { value: 'Vuelvo a escribir' } })
    fireEvent.click(screen.getByTestId('btn-enviar'))
    expect(await screen.findByText('Vuelvo a escribir')).toBeTruthy()
    expect(screen.queryByTestId('tarjeta-anterior')).toBeNull()
    expect(s.acciones().filter((a) => a === 'enviar')).toHaveLength(1)
  })
  it('T22 · el doctor ve "Tú" en sus mensajes previos (no propios en la sesión)', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S2, S1], detalle: { S1: [m(1, 'visitor', 'Antes de registrarme', false), m(2, 'ai', 'Claro')] } })
    render(<ChatCanonico panel cliente={s.cliente} conCarrito={false} intervaloMs={600_000} />)
    await abrirLista()
    fireEvent.click(await screen.findByTestId('hist-sesion'))
    await screen.findByText('Antes de registrarme')
    expect(within(screen.getByTestId('hist-msg-visitor')).getByText('Tú')).toBeTruthy()
  })
  it('T23 · el personal NO ve al doctor como "Tú" (nombre del servidor, o "Doctor")', async () => {
    const asesor = conv({ rol: 'supervisor', modo: 'human_active', ultimo_seq: 2, mensajes: [m(1, 'doctor', 'Hola, soy el doctor'), m(2, 'admin', 'Hola', true)], sesion: { ...S2 } })
    const s = servidor({ conv: asesor, sesiones: [S2] })
    render(<ChatCanonico panel asesor conversationId="C1" cliente={s.cliente} conCarrito={false} intervaloMs={600_000} nombreCliente="david espinoza" />)
    const d = await screen.findByTestId('msg-doctor')
    expect(within(d).getByText('David Espinoza')).toBeTruthy()
    expect(screen.queryByText('Tú')).toBeNull()
    cleanup()
    const s2 = servidor({ conv: asesor, sesiones: [S2] })
    render(<ChatCanonico panel asesor conversationId="C1" cliente={s2.cliente} conCarrito={false} intervaloMs={600_000} />)
    expect(within(await screen.findByTestId('msg-doctor')).getByText('Doctor')).toBeTruthy()
    expect(screen.queryByText('Tú')).toBeNull()
  })
  it('T24 · Cliente 360 → Conversación → "Ver historial" (lectura por la autoridad del servidor)', async () => {
    const ficha = {
      customer_id: 'K1', rol: 'vendedor', permisos: { contacto: [], telefonos: false, domicilios: false, fiscal: false, notas: false, cartera: false, adoptar_alta: false },
      resumen: { nombre: 'david espinoza', activo: true, creado_at: null, origen: 'portal', portal: { tiene: true, verificado: true, activo: true }, vendedor: null, vendedor_historico: null },
      contacto: { email: null, ciudad: null, pais: null, telefonos: [], alta: null, notas: [] }, domicilios: { lista: [], archivados: 0, alta: null }, facturacion: [],
      comercial: { historial: [], atribucion: { origen: null, referido: null, prospecto: null }, carrito: null, conversacion: { id: 'C1', modo: 'ai_active', estado: 'abierta', ultimo_mensaje_at: null, origen: null, ruteo_motivo: null, asesor: 'Lucía' } },
      pedidos: [], resumen_pedidos: { n: 0, total: 0, ultimo: null }, facturas: [], actividad: [],
    } as unknown as Cliente360
    const c360 = new ClienteC360(async () => ({ data: ficha, error: null }))
    const s = servidor({ conv: convSinAbierta(), sesiones: [S1], detalle: { S1: [m(1, 'doctor', 'Quiero cotizar 3 cajas.'), m(2, 'seller', 'Con gusto, doctor.')] } })
    render(<Customer360Page customerId="K1" onBack={() => {}} cliente={c360} atencion={new ClienteAtencion(async () => ({ data: [], error: null }) as never)} lectorChat={s.cliente} onAsesorias={() => {}} />)
    fireEvent.click(await screen.findByTestId('tab-conversacion'))
    expect(screen.getByTestId('c360-asesorias')).toBeTruthy()
    fireEvent.click(screen.getByTestId('c360-historial'))
    const item = await screen.findByTestId('hist-sesion')
    expect(item.textContent).toContain('Finalizada por Lucía')       // vista del personal
    fireEvent.click(item)
    const doc = await screen.findByTestId('hist-msg-doctor')
    expect(within(doc).getByText('David Espinoza')).toBeTruthy()     // personal: nombre del cliente, nunca "Tú"
    expect(within(doc).queryByText('Tú')).toBeNull()
    expect(s.llamadas.map((b) => b.action)).toEqual(['sesiones', 'leer_sesion'])
    expect(s.llamadas[0].conversation_id).toBe('C1')
    fireEvent.click(screen.getByTestId('hist-volver-actual'))
    expect(screen.queryByTestId('c360-historial-panel')).toBeNull()
  })
  it('T25 · un id ajeno no se puede forzar: el servidor niega y la UI no muestra nada; el cliente no manda identidad', async () => {
    const s = servidor({ conv: convActual(), sesiones: [S1], detalle: {} })
    render(<HistorialConversacion conversationId="C1" lector={s.cliente} visor="cliente" cache={new Map<string, CacheSesion>()} inicial="AJENA" onActual={() => {}} />)
    expect((await screen.findByTestId('hist-error')).textContent).toBe('No tienes acceso a esta conversación anterior.')
    expect(screen.queryByTestId('hist-msg-doctor')).toBeNull()
    const ls = s.llamadas.find((b) => b.action === 'leer_sesion')!
    expect(Object.keys(ls).sort()).toEqual(['action', 'desde_seq', 'session_id', 'token'])
  })
  it('guarda · el lector no importa ChatCanonico, carrito ni mutaciones', () => {
    const src = String(fuenteLector)
    expect(src).not.toMatch(/ChatCanonico|CarritoPanel|data\/ops\/carrito/)
    expect(src).not.toMatch(/\.(enviar|leido|iniciar|terminar|solicitarAsesor|rechazarAsesor|reanudarIA|liberar|reasignar|abrir|cerrar)\(/)
    expect(src).not.toMatch(/<textarea|<form/)
    const usados = [...src.matchAll(/lector\.(\w+)\(/g)].map((x) => x[1])
    expect(new Set(usados)).toEqual(new Set(['sesiones', 'leerSesion']))
  })
})

describe('presentación', () => {
  it('fechas en la zona del negocio y copia por motivo/visor', () => {
    expect(rangoSesion({ opened_at: '2026-01-07T00:00:00Z', closed_at: '2026-01-07T03:00:00Z' })).toBe('6 ene · 17:00–20:00')
    expect(rangoSesion({ opened_at: '2026-01-06T04:46:00Z', closed_at: '2026-01-08T01:55:00Z' })).toBe('5 ene · 21:46 – 7 ene · 18:55')
    expect(rangoSesion({ opened_at: hace(30), closed_at: null })).toMatch(/^Hoy · desde \d{2}:\d{2}$|^Ayer · desde/)
    expect(quienAtendio('Lucía · Ventas')).toBe('Atendida por Lucía')
    expect(quienAtendio(null)).toBe('Asistente')
    expect(motivoCierre('asesor_finalizo', 'personal', 'Lucía · Ventas')).toBe('Finalizada por Lucía')
    expect(motivoCierre('asesor_finalizo', 'cliente', 'Lucía')).toBe('Finalizada por tu asesora')
    expect(motivoCierre('direccion_finalizo', 'cliente')).toBe('Finalizada por Renovacell')
    expect(motivoCierre('solicitud_expirada', 'cliente')).toBe('Sin asesor disponible')
    expect(motivoCierre('solicitud_expirada', 'personal')).toBe('Solicitud expirada')
    expect(motivoCierre('conversacion_cerrada', 'cliente')).toBe('Conversación cerrada')
    expect(motivoCierre('consolidada', 'cliente')).toBe('Unida a tu cuenta')
    expect(etiquetaActor({ actor: 'doctor', propio: false }, 'personal', { etiquetaAsesor: 'Asesora' })).toBe('Doctor')
    expect(etiquetaActor({ actor: 'doctor', propio: false }, 'cliente', { etiquetaAsesor: 'Asesora' })).toBe('Tú')
    expect(etiquetaActor({ actor: 'visitor', propio: false }, 'personal', { etiquetaAsesor: 'Asesora' })).toBe('Visitante')
  })
})
