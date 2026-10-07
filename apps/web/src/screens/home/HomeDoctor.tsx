// CHV2-B · INICIO del doctor: ligero, nada de KPIs. CHV2-B.1: NO es un segundo menú — Catálogo, Mis
// pedidos, Historial y Habla con Renovacell ya están en la navegación, y la burbuja flotante es LA
// superficie de conversación. Inicio solo muestra contexto real SUYO que importa ahora:
//   · su atención (una línea informativa: quién lo atiende; la acción vive en la burbuja),
//   · su carrito activo (proyección canónica del servidor; nunca se crea uno desde aquí),
//   · su pedido en curso o "volver a pedir" el último entregado (RLS: solo sus pedidos).
// Sin nada de eso, un Inicio limpio está bien. La composición es una lista de BLOQUES: cuando existan
// autoridades de promociones, lanzamientos, seguimiento posventa o envíos activos, se agregan como
// bloques aquí sin rehacer la pantalla. No hay promociones hoy (no hay campañas aprobadas: no se inventan).
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
import { Bienvenida, Seccion, TarjetaAtencion, Tarjetas } from './primitives'
import { primerNombre, saludo } from '../../lib/nombres'

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
  const nombre = primerNombre(user?.name)

  // Bloques de contexto, en orden de relevancia. Cada uno aparece solo si hay un dato real que lo respalde.
  const bloques: Array<{ key: string; nodo: React.ReactNode }> = []
  if (cart && cart.n_items > 0) bloques.push({ key: 'carrito', nodo: (
    <TarjetaAtencion testid="doctor-carrito" tono="neu" titulo="Tu carrito"
      lineas={[`${cart.n_items} producto${cart.n_items === 1 ? '' : 's'}${cart.total.estado === 'completo' && cart.total.monto != null ? ` · ${formatoMXN(cart.total.monto)}` : ''}`, cart.items[0]?.nombre]}
      ctas={[{ label: 'Continuar compra', primaria: true, onClick: () => setScreen('catalogo') }]} />
  ) })
  enCurso.slice(0, 1).forEach((o) => bloques.push({ key: 'pedido', nodo: (
    <TarjetaAtencion testid="doctor-pedido" tono="neu" titulo={`Pedido ${o.external_ref ?? ''}`.trim()} estado={statusView(o.status).label}
      lineas={[enCurso.length > 1 ? `Y ${enCurso.length - 1} pedido${enCurso.length - 1 === 1 ? '' : 's'} más en curso` : null]}
      ctas={[{ label: 'Ver seguimiento', onClick: () => setScreen('pedidosdr') }]} />
  ) }))
  if (ultimo && enCurso.length === 0) bloques.push({ key: 'reorden', nodo: (
    <TarjetaAtencion testid="doctor-ultimo" tono="neu" titulo="Tu último pedido" estado="Entregado"
      lineas={[ultimo.items.slice(0, 2).map((it) => `${it.qty} × ${nombreProducto.get(it.product_id ?? '') ?? 'producto'}`).join(' · ') || null]}
      ctas={[{ label: 'Volver a pedir', onClick: () => { seedReorder(ultimo.items.map((it) => ({ product_id: it.product_id ?? '', qty: it.qty }))); setScreen('catalogo') } }]} />
  ) })
  // (futuro) promociones / lanzamientos / contenido personalizado / envío activo / seguimiento posventa.

  return (
    <div className="rh" data-testid="home-doctor">
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} detalle={nombre ? '¿Qué necesitas hoy?' : 'Bienvenido a Renovacell. ¿Qué necesitas hoy?'} />
      {conAsesor && conv && (
        // Solo informa: la conversación se abre desde la burbuja flotante (una sola superficie de chat).
        <div className={`rh-context${modo === 'human_active' ? '' : ' rh-context--neu'}`} role="status" data-testid="doctor-atencion">
          <span><b>Tu atención</b> · {subtituloDe(conv, false)}{modo === 'human_active' ? ' · En conversación' : ''}</span>
        </div>
      )}
      {bloques.length > 0 && (
        <Seccion titulo="Continúa donde te quedaste" nivel="continuar" id="continuar">
          <Tarjetas>{bloques.map((b) => <React.Fragment key={b.key}>{b.nodo}</React.Fragment>)}</Tarjetas>
        </Seccion>
      )}
    </div>
  )
}
