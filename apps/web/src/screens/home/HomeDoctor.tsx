// CHV2-B · INICIO del doctor: ligero, nada de KPIs. CHV2-B.1: NO es un segundo menú — Catálogo, Mis
// pedidos, Historial y Habla con Renovacell ya están en la navegación, y la burbuja flotante es LA
// superficie de conversación. Inicio solo muestra contexto real SUYO que importa ahora:
//   · su atención (una línea informativa: quién lo atiende; la acción vive en la burbuja),
//   · su carrito activo (proyección canónica del servidor; nunca se crea uno desde aquí),
//   · su pedido en curso o "volver a pedir" el último entregado (RLS: solo sus pedidos).
// 15 oct 2026 (dueño: "se ve vacío"): además, quién lo atiende (la acción sigue en la burbuja), productos DISPONIBLES del
// catálogo real (foto y precio; nunca promociones inventadas) y, si aún no compra, "Haz tu primer pedido".
// 18 oct 2026 (dueño: "se ve muy triste"): flyers (las piezas que mandan por WhatsApp e historias, PROMO-9) y las promociones
// vigentes con fotos y precios, las mismas que aplica el servidor.
// Sin nada de eso, un Inicio limpio está bien. La composición es una lista de BLOQUES: cuando existan
// autoridades de promociones, lanzamientos, seguimiento posventa o envíos activos, se agregan como
// bloques aquí sin rehacer la pantalla. No hay promociones hoy (no hay campañas aprobadas: no se inventan).
// Nunca lee colas de staff: el chat responde solo la conversación propia (JWT del doctor).
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { BotonAvisos } from '../../app/BotonAvisos'   // PROMO-8 · el doctor puede activar avisos (promos y respuestas del chat)
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
import { usePricing } from '../../data/hooks/usePricing'
import { useStock } from '../../data/hooks/useStock'
import { stockInfoFor } from '../../data/ops/stock'
import { isPortalProduct } from '../../data/hooks/useProducts'
import { money } from '../../lib/format'
import { flyersVigentes as flyersPorDefecto, type Flyer } from '../../data/ops/flyers'   // PROMO-9 · flyers del portal
import { subscribePromos, getPromosSnapshot } from '../../data/store/promosStore'
import { promoTarjeta as promoTarjetaPorDefecto, type DatosPromoDifusion } from '../../data/ops/promociones'
import { TarjetaPromo } from '../../app/TarjetaPromo'

// Solo el estado de la conversación: se pide desde un seq muy alto para no traer el historial.
const SIN_HISTORIAL = 2_000_000_000
// Pruebas / vista previa local: clientes por defecto inyectables (en producción, los reales).
let porDefecto: { chat: ClienteChat; carrito: ClienteCarrito; flyers: typeof flyersPorDefecto; promoTarjeta: typeof promoTarjetaPorDefecto } = { chat: chatPorDefecto, carrito: carritoPorDefecto, flyers: flyersPorDefecto, promoTarjeta: promoTarjetaPorDefecto }
export function configurarClientesInicioDoctor(c: Partial<typeof porDefecto>) { porDefecto = { ...porDefecto, ...c } }

export function HomeDoctor({ cliente = porDefecto.chat, clienteCarrito = porDefecto.carrito, flyers = porDefecto.flyers, promoTarjeta = porDefecto.promoTarjeta }: { cliente?: ClienteChat; clienteCarrito?: ClienteCarrito; flyers?: typeof flyersPorDefecto; promoTarjeta?: typeof promoTarjetaPorDefecto }) {
  const { user, setScreen, verified } = useRole()
  const { priceFor } = usePricing()
  const stockMap = useStock()
  const { data: orders } = useOrders()
  const { data: products } = useProducts()
  const nombreProducto = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const [conv, setConv] = useState<Conversacion | null>(null)
  const [cart, setCart] = useState<Carrito | null>(null)
  // PROMO-9 · flyers vigentes para este doctor (el servidor filtra por lista y vigencia) y el visor a pantalla completa.
  const [lista, setLista] = useState<Flyer[]>([])
  const [abierto, setAbierto] = useState<Flyer | null>(null)
  useEffect(() => { let vivo = true; void flyers().then((f) => { if (vivo) setLista(f) }); return () => { vivo = false } }, [flyers])
  useEffect(() => {
    if (!abierto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(null) }
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc)
  }, [abierto])
  // PROMO-9 · promociones vigentes (las mismas que aplica el servidor) como tarjetas con fotos y precios.
  const promos = useSyncExternalStore(subscribePromos, getPromosSnapshot)
  const promoIds = useMemo(() => [...new Set(promos.map((p) => p.promocion_id))], [promos])
  const [tarjetas, setTarjetas] = useState<DatosPromoDifusion[]>([])
  useEffect(() => {
    let vivo = true
    if (promoIds.length === 0) { setTarjetas([]); return }
    void Promise.all(promoIds.map((id) => promoTarjeta(id).catch(() => null))).then((ts) => { if (vivo) setTarjetas(ts.filter((t): t is DatosPromoDifusion => !!t)) })
    return () => { vivo = false }
  }, [promoIds, promoTarjeta])

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
  if (orders.length === 0 && !(cart && cart.n_items > 0)) bloques.push({ key: 'primero', nodo: (
    <TarjetaAtencion testid="doctor-primer-pedido" tono="neu" titulo="Haz tu primer pedido"
      lineas={[verified ? 'Elige del catálogo y te lo enviamos a tu consultorio.' : 'Conoce el catálogo; los precios se habilitan al verificar tu cuenta.']}
      ctas={[{ label: 'Ver catálogo', primaria: true, onClick: () => setScreen('catalogo') }]} />
  ) })
  // Productos con existencia del catálogo real (los primeros 4): foto, nombre y su precio si ya está verificado.
  const destacados = useMemo(() => products
    .filter((p) => isPortalProduct(p) && !p.parent_product_id && p.image_url && stockInfoFor(stockMap, p.id).qty > 0)
    .slice(0, 4), [products, stockMap])
  // (futuro) lanzamientos / contenido personalizado / envío activo / seguimiento posventa.

  return (
    <div className="rh" data-testid="home-doctor">
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} detalle={nombre ? '¿Qué necesitas hoy?' : 'Bienvenido a Renovacell. ¿Qué necesitas hoy?'} />
      {/* PROMO-8 · avisos en este dispositivo: promociones y respuestas de su asesora, aunque la pestaña esté cerrada. Ya activos, no se muestra. */}
      <div data-testid="home-doctor-avisos" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><BotonAvisos className="btn ghost sm" /></div>
      {conAsesor && conv && (
        // Solo informa: la conversación se abre desde la burbuja flotante (una sola superficie de chat).
        <div className={`rh-context${modo === 'human_active' ? '' : ' rh-context--neu'}`} role="status" data-testid="doctor-atencion">
          <span>{primerNombre(conv.asesor_nombre)
            ? <>Te atiende <b>{primerNombre(conv.asesor_nombre)}</b> · tu asesora{modo === 'human_active' ? ' · en conversación' : ''}</>
            : <><b>Tu atención</b> · {subtituloDe(conv, false)}</>}</span>
        </div>
      )}
      {lista.length > 0 && (
        <Seccion titulo="Novedades y promociones" nivel="info" id="flyers">
          <div className="rh-flyers" data-testid="doctor-flyers">
            {lista.map((f) => (
              <button key={f.id} type="button" className="rh-flyer" onClick={() => setAbierto(f)} aria-label={`Ver flyer: ${f.titulo}`} data-testid={`doctor-flyer-${f.id}`}>
                <img src={f.imagen_url} alt={f.titulo} loading="lazy" />
              </button>
            ))}
          </div>
        </Seccion>
      )}
      {abierto && (
        <div className="rh-visor" role="dialog" aria-modal="true" aria-label={abierto.titulo} onClick={() => setAbierto(null)} data-testid="doctor-flyer-visor">
          <button type="button" className="rh-visor-x" aria-label="Cerrar" onClick={() => setAbierto(null)} data-testid="doctor-flyer-x">×</button>
          <div className="rh-visor-cuerpo" onClick={(e) => e.stopPropagation()}>
            <img src={abierto.imagen_url} alt={abierto.titulo} />
            <div className="rh-visor-acciones">
              <button type="button" className="btn" onClick={() => { setAbierto(null); setScreen('catalogo') }} data-testid="doctor-flyer-catalogo">Ver en el catálogo y pedir</button>
              <button type="button" className="btn ghost" onClick={() => setAbierto(null)} data-testid="doctor-flyer-cerrar">Cerrar</button>
            </div>
          </div>
        </div>
      )}
      {bloques.length > 0 && (
        <Seccion titulo="Continúa donde te quedaste" nivel="continuar" id="continuar">
          <Tarjetas>{bloques.map((b) => <React.Fragment key={b.key}>{b.nodo}</React.Fragment>)}</Tarjetas>
        </Seccion>
      )}
      {tarjetas.length > 0 && (
        <Seccion titulo="Promociones vigentes" nivel="info" id="promos" accion={{ label: 'Ver todo el catálogo', onClick: () => setScreen('catalogo') }}>
          <div className="rh-promos" data-testid="doctor-promos">
            {tarjetas.map((t, i) => <TarjetaPromo key={promoIds[i] ?? i} datos={{ ...t, flyer_url: null }} onCatalogo={() => setScreen('catalogo')} compacta />)}
          </div>
        </Seccion>
      )}
      {destacados.length > 0 && (
        <Seccion titulo="Disponibles para ti" nivel="info" id="destacados" accion={{ label: 'Ver todo el catálogo', onClick: () => setScreen('catalogo') }}>
          <div className="rh-productos" data-testid="doctor-destacados">
            {destacados.map((p) => {
              const precio = verified ? priceFor(p.id, p.price) : null
              return (
                <button key={p.id} type="button" className="rh-producto" onClick={() => setScreen('catalogo')}>
                  <span className="rh-producto-foto"><img src={p.image_url!} alt="" loading="lazy" /></span>
                  <span className="rh-producto-nombre">{p.name}</span>
                  <span className="rh-producto-precio">{precio != null ? money(precio) : 'Ver en catálogo'}</span>
                </button>
              )
            })}
          </div>
        </Seccion>
      )}
    </div>
  )
}
