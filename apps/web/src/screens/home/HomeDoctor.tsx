// CHV2-B · INICIO del doctor: ligero, nada de KPIs. Solo bloques respaldados por datos reales SUYOS:
//   · su asesoría (modo y nombre del asesor que da el servidor; la IA sigue mientras espera),
//   · su carrito activo (proyección canónica del servidor; nunca se crea uno desde aquí),
//   · su pedido en curso y "volver a pedir" el último entregado (RLS: solo sus pedidos),
//   · accesos a Catálogo y Habla con Renovacell.
// No hay promociones: no existe todavía una autoridad de contenido/campañas aprobadas (no se inventan).
// Nunca lee colas de staff: el chat responde solo la conversación propia (JWT del doctor).
import React, { useEffect, useMemo, useState } from 'react'
import { useRole } from '../../auth/RoleContext'
import { chat as chatPorDefecto, type ClienteChat, type Conversacion } from '../../data/ops/chat'
import { carrito as carritoPorDefecto, formatoMXN, type Carrito, type ClienteCarrito } from '../../data/ops/carrito'
import { useOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { seedReorder } from '../../data/store/reorderStore'
import { isPast, statusView } from '../doctor/orderStatus'
import { subtituloDe } from '../chat/ChatCanonico'
import { Accesos, Bienvenida, Seccion, TarjetaAtencion, Tarjetas, Vacio, nombreCorto, type Acceso } from './primitives'

// Solo el estado de la conversación: se pide desde un seq muy alto para no traer el historial.
const SIN_HISTORIAL = 2_000_000_000
// Pruebas / vista previa local: clientes por defecto inyectables (en producción, los reales).
let porDefecto: { chat: ClienteChat; carrito: ClienteCarrito } = { chat: chatPorDefecto, carrito: carritoPorDefecto }
export function configurarClientesInicioDoctor(c: Partial<{ chat: ClienteChat; carrito: ClienteCarrito }>) { porDefecto = { ...porDefecto, ...c } }

export function HomeDoctor({ cliente = porDefecto.chat, clienteCarrito = porDefecto.carrito }: { cliente?: ClienteChat; clienteCarrito?: ClienteCarrito }) {
  const { user, setScreen } = useRole()
  const { data: orders } = useOrders()
  const { data: products } = useProducts()
  const nombreProducto = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const [conv, setConv] = useState<Conversacion | null>(null)
  const [cart, setCart] = useState<Carrito | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const a = await cliente.abrir()   // idempotente: la misma conversación que abre el lanzador
      if (!vivo || !a.ok) return
      const l = await cliente.leer(a.data.conversation_id, SIN_HISTORIAL)
      if (!vivo || !l.ok) return
      setConv(l.data)
      if (l.data.cart_id) { const k = await clienteCarrito.ver(l.data.cart_id); if (vivo && k.ok) setCart(k.data) }
    })()
    return () => { vivo = false }
  }, [cliente, clienteCarrito])

  const enCurso = useMemo(() => orders.filter((o) => !isPast(o.status)), [orders])
  const ultimo = useMemo(() => orders.filter((o) => o.status === 'delivered' || o.status === 'fulfilled').sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0], [orders])
  const modo = conv?.modo
  const conAsesor = modo === 'human_requested' || modo === 'human_assigned' || modo === 'human_active'
  const nombre = nombreCorto(user?.name)
  const accesos: Acceso[] = [
    { key: 'catalogo', label: 'Catálogo', icon: 'grid', onClick: () => setScreen('catalogo') },
    { key: 'chat_cc', label: 'Habla con Renovacell', icon: 'chat', detalle: 'Asistente y tu asesor', onClick: () => setScreen('chat_cc') },
    { key: 'pedidosdr', label: 'Mis pedidos', icon: 'bag', onClick: () => setScreen('pedidosdr') },
    { key: 'hist', label: 'Historial', icon: 'clock', onClick: () => setScreen('hist') },
  ]
  const hayAlgo = conAsesor || (cart?.n_items ?? 0) > 0 || enCurso.length > 0 || !!ultimo

  return (
    <div className="rh" data-testid="home-doctor">
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={nombre ? `Hola, ${nombre}` : 'Hola'} detalle="¿Qué necesitas hoy?" />
      {hayAlgo ? (
        <Seccion titulo="Continúa donde te quedaste" nivel="continuar" id="continuar">
          <Tarjetas>
            {conAsesor && conv && (
              <TarjetaAtencion testid="doctor-asesoria" tono={modo === 'human_active' ? 'ok' : 'neu'} titulo={modo === 'human_active' ? `${conv.asesor_nombre ?? 'Tu asesor'} está contigo` : 'Tu asesor personal'}
                lineas={[subtituloDe(conv, false)]}
                ctas={[{ label: 'Abrir conversación', primaria: true, onClick: () => setScreen('chat_cc') }]} />
            )}
            {cart && cart.n_items > 0 && (
              <TarjetaAtencion testid="doctor-carrito" tono="neu" titulo="Tu carrito"
                lineas={[`${cart.n_items} producto${cart.n_items === 1 ? '' : 's'}${cart.total.estado === 'completo' && cart.total.monto != null ? ` · ${formatoMXN(cart.total.monto)}` : ''}`, cart.items[0]?.nombre]}
                ctas={[{ label: 'Continuar compra', primaria: !conAsesor, onClick: () => setScreen('catalogo') }]} />
            )}
            {enCurso.slice(0, 1).map((o) => (
              <TarjetaAtencion key={o.id} testid="doctor-pedido" tono="neu" titulo={`Pedido ${o.external_ref ?? ''}`.trim()} estado={statusView(o.status).label}
                lineas={[enCurso.length > 1 ? `Y ${enCurso.length - 1} pedido${enCurso.length - 1 === 1 ? '' : 's'} más en curso` : null]}
                ctas={[{ label: 'Ver mis pedidos', onClick: () => setScreen('pedidosdr') }]} />
            ))}
            {ultimo && enCurso.length === 0 && (
              <TarjetaAtencion testid="doctor-ultimo" tono="neu" titulo="Tu último pedido" estado="Entregado"
                lineas={[ultimo.items.slice(0, 2).map((it) => `${it.qty} × ${nombreProducto.get(it.product_id ?? '') ?? 'producto'}`).join(' · ') || null]}
                ctas={[{ label: 'Volver a pedir', onClick: () => { seedReorder(ultimo.items.map((it) => ({ product_id: it.product_id ?? '', qty: it.qty }))); setScreen('catalogo') } }]} />
            )}
          </Tarjetas>
        </Seccion>
      ) : (
        <Vacio icon="leaf" titulo={nombre ? `Hola, ${nombre}. ¿Qué necesitas hoy?` : '¿Qué necesitas hoy?'} detalle="Explora el catálogo o escríbenos: el asistente te responde y un asesor personal te acompaña en tu compra." testid="doctor-vacio" />
      )}
      <Seccion titulo="Accesos" nivel="info" id="accesos"><Accesos items={accesos} /></Seccion>
    </div>
  )
}
