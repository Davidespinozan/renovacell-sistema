// CHV2-B · INICIO del doctor: ligero, nada de KPIs. CHV2-B.1: NO es un segundo menú — Catálogo, Mis
// pedidos, Historial y Habla con Renovacell ya están en la navegación, y la burbuja flotante es LA
// superficie de conversación. Inicio solo muestra contexto real SUYO que importa ahora:
//   · su atención (una línea informativa: quién lo atiende; la acción vive en la burbuja),
//   · su carrito activo (proyección canónica del servidor; nunca se crea uno desde aquí),
//   · su pedido en curso o "volver a pedir" el último entregado (RLS: solo sus pedidos).
// 15 oct 2026 (dueño: "se ve vacío"): además, quién lo atiende (la acción sigue en la burbuja), productos DISPONIBLES del
// catálogo real (foto y precio; nunca promociones inventadas) y, si aún no compra, "Haz tu primer pedido".
// 18 oct 2026 (dueño: "se ve muy triste" / "buen diseño estamos muy lejos"): composición tipo CuboPolar en móvil:
//   recepción (saludo + quién lo atiende + avisos como chip), tira de flyers (PROMO-9, piezas 9:16), "Continúa" como
//   LISTA en una tarjeta (filas con ícono, chevron; sin botones gigantes), promociones vigentes densas y productos
//   disponibles en tira deslizable. Todo con los verdes de marca y los tokens cp.
// Sin nada de eso, un Inicio limpio está bien. La composición es una lista de BLOQUES: cuando existan
// autoridades de lanzamientos, seguimiento posventa o envíos activos, se agregan como bloques aquí sin rehacer la pantalla.
// Nunca lee colas de staff: el chat responde solo la conversación propia (JWT del doctor).
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ChevronRight, Minus, Package, Plus, RotateCcw, Search, ShoppingBag, Sparkles, Star, Trash2 } from 'lucide-react'
import { useMasPedidos } from '../../data/ops/masPedidos'
import { hasSupabase } from '../../lib/supabase'
import { useCarritoCanonico } from '../../data/hooks/useCarritoCanonico'
import { BarraCarrito } from '../doctor/BarraCarrito'
import { pedirBusqueda, pedirRevisarPedido } from '../../data/store/catalogoIntento'
import type { ProductSafe } from '../../data/types'
import { BotonAvisos } from '../../app/BotonAvisos'   // PROMO-8 · el doctor puede activar avisos (promos y respuestas del chat)
import { useRole } from '../../auth/RoleContext'
import { chat as chatPorDefecto, type ClienteChat, type Conversacion } from '../../data/ops/chat'
import { carrito as carritoPorDefecto, formatoMXN, type Carrito, type ClienteCarrito } from '../../data/ops/carrito'
import { useOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { seedReorder } from '../../data/store/reorderStore'
import { isPast, statusView } from '../doctor/orderStatus'
import { subtituloDe } from '../chat/ChatCanonico'
import { Bienvenida, Seccion } from './primitives'
import { primerNombre, saludo } from '../../lib/nombres'
import { usePricing } from '../../data/hooks/usePricing'
import { useStock } from '../../data/hooks/useStock'
import { stockInfoFor } from '../../data/ops/stock'
import { isPortalProduct } from '../../data/hooks/useProducts'
import { money } from '../../lib/format'
import { cantidadVista, esMediaCaja, numeroVista, precioVista } from '../../lib/cajas'
import { flyersVigentes as flyersPorDefecto, type Flyer } from '../../data/ops/flyers'   // PROMO-9 · flyers del portal
import { subscribePromos, getPromosSnapshot } from '../../data/store/promosStore'
import { promoTarjeta as promoTarjetaPorDefecto, type DatosPromoDifusion } from '../../data/ops/promociones'
import { TarjetaPromo } from '../../app/TarjetaPromo'
import { Recomendar } from './Recomendar'
import { miEnlace, type MiEnlace } from '../../data/ops/enlaces'

// Solo el estado de la conversación: se pide desde un seq muy alto para no traer el historial.
const SIN_HISTORIAL = 2_000_000_000
// Pruebas / vista previa local: clientes por defecto inyectables (en producción, los reales).
let porDefecto: { chat: ClienteChat; carrito: ClienteCarrito; flyers: typeof flyersPorDefecto; promoTarjeta: typeof promoTarjetaPorDefecto; recomendar: () => Promise<MiEnlace | null> } = { chat: chatPorDefecto, carrito: carritoPorDefecto, flyers: flyersPorDefecto, promoTarjeta: promoTarjetaPorDefecto, recomendar: () => miEnlace() }
export function configurarClientesInicioDoctor(c: Partial<typeof porDefecto>) { porDefecto = { ...porDefecto, ...c } }

/** Fila de "Continúa donde te quedaste": ícono, título, detalle, estado opcional y chevron; toda la fila navega. */
function Fila({ icono, titulo, detalle, estado, pill, onClick, testid }: { icono: React.ReactNode; titulo: string; detalle?: string | null; estado?: string; pill?: string; onClick: () => void; testid?: string }) {
  return (
    <button type="button" className="taskrow rh-fila" onClick={onClick} data-testid={testid}>
      <span className="taskrow-ic rh-fila-ic" aria-hidden>{icono}</span>
      <span className="taskrow-tx">
        <span className="taskrow-t">{titulo}</span>
        {detalle && <span className="taskrow-d">{detalle}</span>}
      </span>
      {estado && <span className={`pill ${pill ?? 'p-neu'}`}>{estado}</span>}
      <span className="taskrow-ch" aria-hidden><ChevronRight /></span>
    </button>
  )
}

export function HomeDoctor({ cliente = porDefecto.chat, clienteCarrito = porDefecto.carrito, flyers = porDefecto.flyers, promoTarjeta = porDefecto.promoTarjeta, recomendar = porDefecto.recomendar }: { cliente?: ClienteChat; clienteCarrito?: ClienteCarrito; flyers?: typeof flyersPorDefecto; promoTarjeta?: typeof promoTarjetaPorDefecto; recomendar?: () => Promise<MiEnlace | null> }) {
  const { user, setScreen, verified } = useRole()
  const { priceFor } = usePricing()
  const stockMap = useStock()
  const { data: orders } = useOrders()
  const { data: products } = useProducts()
  const porId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
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

  // Filas de contexto, en orden de relevancia. Cada una aparece solo si hay un dato real que la respalde.
  const filas: React.ReactNode[] = []
  if (cart && cart.n_items > 0) filas.push(
    <Fila key="carrito" testid="doctor-carrito" icono={<ShoppingBag />} titulo={`Tu carrito${cart.total.estado === 'completo' && cart.total.monto != null ? ` · ${formatoMXN(cart.total.monto)}` : ''}`}
      detalle={`${cart.n_items} producto${cart.n_items === 1 ? '' : 's'}${cart.items[0]?.nombre ? ` · ${cart.items[0].nombre}` : ''} · Continuar compra`} onClick={() => setScreen('catalogo')} />)
  enCurso.slice(0, 1).forEach((o) => filas.push(
    <Fila key="pedido" testid="doctor-pedido" icono={<Package />} titulo={`Pedido ${o.external_ref ?? ''}`.trim()} estado={statusView(o.status).label} pill={statusView(o.status).pill}
      detalle={enCurso.length > 1 ? `Ver seguimiento · ${enCurso.length - 1} más en curso` : 'Ver seguimiento'} onClick={() => setScreen('pedidosdr')} />))
  if (ultimo && enCurso.length === 0) filas.push(
    <Fila key="reorden" testid="doctor-ultimo" icono={<RotateCcw />} titulo="Volver a pedir tu último pedido"
      // CAJAS-MEDIOS · la cantidad se lee en cajas con medios
      detalle={ultimo.items.slice(0, 2).map((it) => { const p = porId.get(it.product_id ?? ''); return `${cantidadVista(p, it.qty)} × ${p?.name ?? 'producto'}` }).join(' · ') || null}
      onClick={() => { seedReorder(ultimo.items.map((it) => ({ product_id: it.product_id ?? '', qty: it.qty }))); setScreen('catalogo') }} />)
  if (orders.length === 0 && !(cart && cart.n_items > 0)) filas.push(
    <Fila key="primero" testid="doctor-primer-pedido" icono={<Sparkles />} titulo="Haz tu primer pedido"
      detalle={verified ? 'Elige del catálogo y te lo enviamos a tu consultorio.' : 'Conoce el catálogo; los precios se habilitan al verificar tu cuenta.'} onClick={() => setScreen('catalogo')} />)
  // Productos con existencia del catálogo real (los primeros 6): foto, nombre y su precio si ya está verificado.
  const destacados = useMemo(() => products
    .filter((p) => isPortalProduct(p) && !p.parent_product_id && p.image_url && stockInfoFor(stockMap, p.id).qty > 0)
    .slice(0, 6), [products, stockMap])
  // CALIDAD VISUAL · accesos por línea (siempre hay algo útil y con presencia de marca, aunque no haya promociones)
  const porLinea = useMemo(() => {
    const vis = products.filter((p) => isPortalProduct(p) && !p.parent_product_id)
    return { prof: vis.filter((p) => p.line === 'prof').length, cosm: vis.filter((p) => p.line !== 'prof').length }
  }, [products])
  // (futuro) lanzamientos / contenido personalizado / envío activo / seguimiento posventa.

  // UX MODERNO · Fase 1 (15 nov 2026, auditoría: "el portal parece un sistema interno, no una tienda"). El Inicio es la
  // vitrina: buscador, "Vuelve a comprar" (lo que ya pide, con + directo al carrito), su pedido en curso, promociones y
  // productos con +. El carrito es el canónico del servidor (el mismo del catálogo y del chat).
  const canon = useCarritoCanonico(hasSupabase && verified)
  const masPedidos = useMasPedidos()
  const enCarrito = (id: string) => (hasSupabase ? canon.qty[id] ?? 0 : 0)
  const agregar = (id: string, delta: number) => {
    if (!verified) { setScreen('catalogo'); return }
    if (!hasSupabase) { seedReorder([{ product_id: id, qty: 1 }]); setScreen('catalogo'); return }   // demo sin servidor: lo arma el catálogo
    canon.fijar(id, Math.max(0, enCarrito(id) + delta))
  }
  const unidades = hasSupabase ? Object.values(canon.qty).reduce((a, b) => a + b, 0) : 0
  const totalCarrito = canon.cart?.total.estado === 'completo' ? canon.cart.total.monto ?? null : null
  // Lo que más pide (por número de pedidos en que aparece), con foto y disponible en el portal.
  const deSiempre = useMemo(() => {
    const veces = new Map<string, number>()
    for (const o of orders) { if (o.status === 'cancelled') continue; for (const it of o.items) if (it.product_id) veces.set(it.product_id, (veces.get(it.product_id) ?? 0) + 1) }
    return products.filter((p) => veces.has(p.id) && isPortalProduct(p) && p.image_url).sort((a, b) => (veces.get(b.id) ?? 0) - (veces.get(a.id) ?? 0)).slice(0, 10)
  }, [orders, products])
  const [q, setQ] = useState('')
  const buscar = (e: React.FormEvent) => { e.preventDefault(); pedirBusqueda(q); setScreen('catalogo') }
  const producto = (p: ProductSafe) => {
    const precio = verified ? priceFor(p.id, p.price) : null
    const n = enCarrito(p.id)
    const agotado = stockInfoFor(stockMap, p.id).tracked && stockInfoFor(stockMap, p.id).qty <= 0
    return (
      <div className="tienda-prod" data-testid="tienda-producto">
        <div className="tienda-prod-media">
          {agotado && <span className="tienda-agotado">Agotado</span>}
          {!agotado && masPedidos.has(p.id) && <span className="dcat-mas"><Star size={12} aria-hidden /> Más pedido</span>}
          <button type="button" className="tienda-prod-foto" onClick={() => { pedirBusqueda(p.name); setScreen('catalogo') }} aria-label={`Ver ${p.name}`}>
            <img src={p.image_url!} alt="" loading="lazy" />
          </button>
          {verified && !agotado && (n > 0
            ? <span className="tienda-cant" data-testid="tienda-cantidad">
                <button type="button" onClick={() => agregar(p.id, -1)} aria-label={n === 1 ? `Quitar ${p.name} del carrito` : `Quitar uno de ${p.name}`}>{n === 1 ? <Trash2 size={15} /> : <Minus size={16} />}</button>
                <b>{numeroVista(p, n)}</b>{/* CAJAS-MEDIOS */}
                <button type="button" onClick={() => agregar(p.id, 1)} aria-label={`Agregar otro de ${p.name}`}><Plus size={16} /></button>
              </span>
            : <button type="button" className="tienda-mas" onClick={() => agregar(p.id, 1)} aria-label={`Agregar ${p.name}`} data-testid="tienda-agregar"><Plus size={18} /></button>)}
        </div>
        <span className="tienda-prod-precio">{precio != null ? `${money(precioVista(p, precio))}${esMediaCaja(p) ? ' por caja' : ''}` : verified ? '' : 'Precio al verificarte'}</span>
        <span className="tienda-prod-nombre">{p.name}</span>
      </div>
    )
  }

  return (
    <div className="rh rh--doctor tienda" data-testid="home-doctor">
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} detalle={nombre ? '¿Qué necesitas hoy?' : 'Bienvenido a Renovacell. ¿Qué necesitas hoy?'}>
        {conAsesor && conv && (
          <span className="rh-chip rh-chip--estado" role="status" data-testid="doctor-atencion">
            <span className={`rh-chip-dot${modo === 'human_active' ? ' rh-chip-dot--on' : ''}`} aria-hidden />
            <span>{primerNombre(conv.asesor_nombre)
              ? <>Te atiende <b>{primerNombre(conv.asesor_nombre)}</b>{modo === 'human_active' ? ' · en conversación' : ''}</>
              : <><b>Tu atención</b> · {subtituloDe(conv, false)}</>}</span>
          </span>
        )}
        <span data-testid="home-doctor-avisos" className="rh-chip-slot"><BotonAvisos className="rh-chip rh-chip--btn" /></span>
      </Bienvenida>

      <form className="tienda-buscar" role="search" onSubmit={buscar}>
        <Search size={18} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar productos" aria-label="Buscar en el catálogo" enterKeyHint="search" data-testid="tienda-buscar" />
      </form>

      {enCurso.slice(0, 1).map((o) => (
        <button key={o.id} type="button" className="tienda-pedido" onClick={() => setScreen('pedidosdr')} data-testid="doctor-pedido">
          <span className="tienda-pedido-ic" aria-hidden><Package size={20} /></span>
          <span className="tienda-pedido-tx"><b>Tu pedido {o.external_ref ?? ''}</b><small>{statusView(o.status).label}{enCurso.length > 1 ? ` · ${enCurso.length - 1} más en curso` : ''}</small></span>
          <ChevronRight size={18} aria-hidden />
        </button>
      ))}

      {verified && deSiempre.length > 0 && (
        <Seccion titulo="Vuelve a comprar" nivel="continuar" id="de-siempre" accion={ultimo ? { label: 'Repetir último pedido', onClick: () => { seedReorder(ultimo.items.map((it) => ({ product_id: it.product_id ?? '', qty: it.qty }))); setScreen('catalogo') } } : undefined}>
          <div className="tienda-tira" data-testid="doctor-de-siempre">{deSiempre.map((p) => <React.Fragment key={p.id}>{producto(p)}</React.Fragment>)}</div>
        </Seccion>
      )}

      {lista.length > 0 && (
        <Seccion titulo="Novedades" nivel="info" id="flyers">
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

      {tarjetas.length > 0 && (
        <Seccion titulo="Promociones" nivel="info" id="promos">
          <div className="rh-promos" data-testid="doctor-promos">
            {tarjetas.map((t, i) => <TarjetaPromo key={promoIds[i] ?? i} datos={{ ...t, flyer_url: null }} onCatalogo={() => setScreen('catalogo')} compacta densa />)}
          </div>
        </Seccion>
      )}

      {/* Sin pedidos ni carrito: el primer paso, en una fila (antes una lista de "Continúa"). */}
      {filas.length > 0 && !(verified && deSiempre.length > 0) && enCurso.length === 0 && (
        <div className="tasklist" data-testid="doctor-continuar">{filas}</div>
      )}

      {destacados.length > 0 && (
        <Seccion titulo="Disponibles para ti" nivel="info" id="destacados" accion={{ label: 'Ver catálogo', onClick: () => setScreen('catalogo') }}>
          <div className="tienda-rejilla" data-testid="doctor-destacados">{destacados.map((p) => <React.Fragment key={p.id}>{producto(p)}</React.Fragment>)}</div>
        </Seccion>
      )}

      {/* REFERIDOS · recomendar con su enlace del chat (con su asesor), en vez de pasar un WhatsApp. */}
      <Recomendar cargar={recomendar} />

      {verified && <BarraCarrito unidades={unidades} totalEstimado={totalCarrito} bloqueada={false} onRevisar={() => { pedirRevisarPedido(); setScreen('catalogo') }} />}
    </div>
  )
}
