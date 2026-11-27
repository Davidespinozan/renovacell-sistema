// CHV2-B · INICIO por rol: "abrí Renovacell y sé de inmediato qué requiere mi atención".
// Una sola arquitectura (primitivas de ./primitives) con bloques por rol; nada de tableros paralelos.
//   · Ventas      → solicitudes de asesor (ATENDER AHORA), asesorías en curso, su bandeja.
//   · Dirección   → intervención comercial (sin vendedor / escaladas), luego el resto de su bandeja.
//   · Almacén     → su bandeja operativa (surtir, empacar, despachar, recibir, caducidades).
//   · Chofer      → siguiente entrega, pendientes del día e incidencias.
//   · Doctor      → su asesoría, su carrito, su pedido en curso y volver a pedir (./HomeDoctor).
// CHV2-B.1 · Inicio NO es un segundo sidebar: en escritorio no repite módulos de la navegación; en móvil
// hay a lo sumo 3 atajos del trabajo principal (que ahí queda detrás de "Menú").
// Datos: los MISMOS stores/RPC que el resto del sistema. Mi bandeja e Inicio salen de `useBandeja`
// (no pueden contradecirse) y lo comercial del store compartido (`useAtencionComercial`). Ningún
// tiempo de espera se calcula aquí: lo da el servidor.
import { Prospectar } from '../pos/Prospectar'   // PROSPECTAR · registrar + primer WhatsApp
import { Icon } from '../../app/icons'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRole } from '../../auth/RoleContext'
import { getNav, getRole, pantallasAlcanzables, type RoleKey } from '../../app/roles'
import { useBandeja, ListaTareas, porUrgencia, type Task } from '../Bandeja'
import { HoyAlmacen } from '../warehouse/HoyAlmacen'
import { Seguimiento } from '../logistics/Seguimiento'
import { useAtencionComercial, fuenteComercial, recargarAtencion } from '../../data/store/atencionStore'
import { activasVendedor, intervencionDireccion, lineasSolicitud, solicitudesVendedor, ETIQUETA_ATENCION, tonoAtencion, estadoDe, TEXTO_HORARIO_PENDIENTE } from '../../data/ops/atencionComercial'
import { MOTIVO_RUTEO } from '../../data/ops/atencion'
import { irAConversacion, irASolicitud } from '../../data/store/navIntentStore'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { driverIdByEmail, driverName } from '../../data/mock/shipments'
import { cargaPorConfirmar, confirmarTodaLaCarga, pedirParada } from '../../data/ops/rutaChofer'   // CHOFER · menos pasos
import { toast } from '../../app/Toast'
import { SelectorClienteVentas } from '../pos/SelectorCliente'
import { BuscadorClientes } from '../../data/ops/buscarClientes'
import { NuevoPedido } from '../sales/NuevoPedido'
import { CobrarPedido } from '../cobros/LinksPago'
import { pedidosPorConfirmar } from '../../data/ops/porConfirmar'
import { etapaSeguimiento, useSeguimiento } from '../../data/ops/seguimientoVenta'
import { seSurteSinPago, statusView } from '../doctor/orderStatus'
import { esRecoge } from '../../data/ops/seguimiento'
import { pedirFiltro } from '../../data/store/filtroInicial'
import { metodoLabel, usePagosPorValidar } from '../admin/usePagosPorValidar'
import { SolicitudesCancelacionPendientes } from '../../app/Cancelacion'
import { useSolicitudesCancelacion } from '../../data/ops/cancelacionSolicitud'
import { confirmar } from '../../app/dialogos'
import { useOrderMoney } from '../../data/hooks/useMoney'
import { telParaMarcar } from '../../lib/telefono'
import { deliveryOf } from '../../data/mock/profiles'
import { AtajosMovil, Bienvenida, Cargando, ErrorLectura, Nota, Seccion, TarjetaAtencion, Tarjetas, Vacio, type Acceso } from './primitives'
import { capitalizarNombre, saludo } from '../../lib/nombres'
import { HomeDoctor } from './HomeDoctor'
import { RecordatorioAvisos } from '../../app/RecordatorioAvisos'
import { abrirPestanaAtencion } from '../admin/AtencionComercial'
import { oportunidadesPromo, type OportunidadPromo } from '../../data/ops/busqueda'
import { carteraPlazos, textoPlazo, textoSinCompra, tonoPlazo, type ClientePlazo } from '../../data/ops/carteraPlazos'
import { fmtDate, money } from '../../lib/format'
import { diaNegocio, hoyNegocio } from '../../data/periodo'
import { abrirMisVentas } from '../sales/MisVentas'

export function RoleHome() {
  const { role } = useRole()
  if (role === 'doctor') return <HomeDoctor />
  // PUSH DEL EQUIPO · el equipo ve arriba "Activa las notificaciones" hasta que este dispositivo las tenga.
  return <><RecordatorioAvisos />{homeEquipo(role)}</>
}
function homeEquipo(role: string | null) {
  if (role === 'driver') return <HomeChofer />
  if (role === 'warehouse') return <HomeAlmacen />
  if (role === 'packing') return <HomeAlmacen etiqueta="Empaque y despacho" />
  if (role === 'pos') return <HomeVendedor />
  return <HomeDireccion />
}

/** Atajos (solo móvil) acotados a lo que el rol puede abrir (nunca un destino fuera de su navegación). */
function useAccesos(defs: Array<Omit<Acceso, 'onClick'>>): Acceso[] {
  const { role, capabilities, setScreen } = useRole()
  // MENÚ CORTO (26 nov 2026): cuenta también las pestañas de los grupos (antes solo las entradas del menú, y los atajos
  // a una pestaña —Preparar, Por enviar, Recibir mercancía— desaparecían al agruparlas).
  const nav = useMemo(() => pantallasAlcanzables(getNav(getRole(role as RoleKey), undefined, capabilities)), [role, capabilities])
  return defs.filter((d) => nav.has(d.key)).map((d) => ({ ...d, onClick: () => setScreen(d.key) }))
}

// ── VENTAS ────────────────────────────────────────────────────────────────────────────────────────────
export function HomeVendedor() {
  const { role, capabilities, user, setScreen } = useRole()
  const fuente = fuenteComercial(role as RoleKey, capabilities)
  const est = useAtencionComercial(fuente)
  const { tareas, fuentes } = useBandeja()
  const solicitudes = solicitudesVendedor(est.cola)
  const activas = activasVendedor(est.cola)
  const atajos = useAccesos([
    { key: 'asesorias', label: 'Mensajes', icon: 'chat' },
    { key: 'caja', label: 'Punto de venta', icon: 'store' },
    { key: 'clientes', label: 'Clientes', icon: 'usercheck' },
  ])
  // VENDER Y COBRAR DESDE INICIO (27 nov 2026, «sistema sencillo por rol»): no había botón para levantar un pedido (el
  // camino era Clientes → cliente → ficha → «Levantar pedido») ni para confirmar un pago (Menú → Cobrar pedidos).
  const { data: pedidos } = useAllOrders()
  const { byOrder: dinero } = useOrderMoney()
  const porConfirmar = useMemo(() => pedidosPorConfirmar(pedidos.filter((o) => (o.total ?? 0) > 0 && o.payment_status !== 'paid' && o.payment_status !== 'refunded'), dinero), [pedidos, dinero])
  const buscador = useRef<BuscadorClientes | null>(null)
  const [eligiendo, setEligiendo] = useState(false)
  const [pedidoPara, setPedidoPara] = useState<{ id: string; name: string } | null>(null)
  const [cobrando, setCobrando] = useState<(typeof pedidos)[number] | null>(null)
  const clienteDe = (o: { shipping_meta?: unknown }) => capitalizarNombre(((o.shipping_meta as { customer?: { name?: string } } | null)?.customer?.name) ?? '') || 'Cliente'
  // MIS PEDIDOS EN CURSO (27 nov 2026): los que ya van caminando, con las mismas palabras y el mismo avance de cuatro
  // pasos que ven Almacén y el doctor. Los que esperan pago ya están arriba, con su botón.
  const enCursoTodos = useMemo(() => { const esperan = new Set(porConfirmar.map((o) => o.id)); return pedidos.filter((o) => !['cancelled', 'draft', 'delivered', 'fulfilled'].includes(o.status ?? '') && !esperan.has(o.id)).sort((a, b) => ((a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1)) }, [pedidos, porConfirmar])
  const enCurso = enCursoTodos.slice(0, 5)
  const segCurso = useSeguimiento(enCurso.map((o) => o.id))
  const detalle = !fuente ? 'Tu cartera y tus ventas de hoy.'
    : solicitudes.length ? solicitudes.length === 1 ? 'Un cliente te espera. El asistente lo atiende mientras llegas.' : `${solicitudes.length} clientes te esperan. El asistente los atiende mientras llegas.`
      : 'Sin solicitudes de asesor por ahora.'
  return (
    <div className="rh" data-testid="home-vendedor">
      {fuentes}
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} detalle={detalle} etiqueta="Ventas" />
      <button type="button" className="btn rh-vender" onClick={() => { buscador.current ??= new BuscadorClientes(); setEligiendo(true) }} data-testid="inicio-levantar-pedido">
        <Icon name="plus" /> Levantar pedido
      </button>
      {porConfirmar.length > 0 && (
        <Seccion titulo="Esperan pago para pasar a Almacén" nivel="atencion" conteo={porConfirmar.length} id="por-confirmar"
          accion={porConfirmar.length > 4 ? { label: `Ver los ${porConfirmar.length}`, onClick: () => setScreen('links_pago') } : undefined}>
          <div className="tasklist">
            {porConfirmar.slice(0, 4).map((o) => (
              <div key={o.id} className="taskrow" data-testid="inicio-por-confirmar">
                <span className="taskrow-tx">
                  <span className="taskrow-t">{clienteDe(o)}</span>
                  <span className="taskrow-d"><span className="mono">{o.external_ref}</span> · {money(o.total ?? 0)} · pedido el {fmtDate(o.created_at)}</span>
                </span>
                <button type="button" className="btn sm" onClick={() => setCobrando(o)} data-testid="inicio-confirmar-pago">Confirmar pago</button>
              </div>
            ))}
          </div>
        </Seccion>
      )}
      {eligiendo && buscador.current && (
        <SelectorClienteVentas paraPedido buscador={buscador.current} onClose={() => setEligiendo(false)} onPick={(c) => { setEligiendo(false); if (c) setPedidoPara({ id: c.id, name: c.name }) }} />
      )}
      {pedidoPara && <NuevoPedido customer={{ id: pedidoPara.id, name: pedidoPara.name, phone: null }} placedBy={`${user?.name ?? 'Ventas'} (Ventas)`} onClose={() => setPedidoPara(null)} />}
      {cobrando && <CobrarPedido pedido={cobrando} onClose={() => setCobrando(null)} onHecho={(t) => { setCobrando(null); toast(t) }} />}
      {enCurso.length > 0 && (
        <Seccion titulo="Tus pedidos en curso" nivel="continuar" conteo={enCursoTodos.length} id="en-curso" accion={{ label: 'Ver todos', onClick: () => abrirMisVentas(setScreen, 'todos') }}>
          <div className="tasklist">
            {enCurso.map((o) => {
              const sv = statusView(o.status, { recoge: esRecoge(o), liberado: seSurteSinPago(o) })
              const et = etapaSeguimiento({ status: o.status, payment_method: o.payment_method, shipping_meta: o.shipping_meta, seguimiento: segCurso[o.id] })
              return (
                <button key={o.id} type="button" className="taskrow" onClick={() => abrirMisVentas(setScreen, 'todos')} data-testid="inicio-en-curso">
                  <span className="rh-encurso">
                    <span className="taskrow-t">{clienteDe(o)}</span>
                    <span className="taskrow-d"><span className="mono">{o.external_ref}</span> · {et.texto}</span>
                    <span className="rh-avance" aria-hidden>{[0, 1, 2, 3].map((i) => <i key={i} className={i <= sv.step ? 'on' : undefined} />)}</span>
                  </span>
                  <span className={'pill ' + sv.pill}>{sv.label}</span>
                </button>
              )
            })}
          </div>
        </Seccion>
      )}
      <CifrasVendedor esperan={solicitudes.length + activas.reduce((n, c) => n + (c.sin_leer > 0 ? 1 : 0), 0)} onEsperan={() => setScreen('asesorias')} />
      <BandaProspectar />
      {fuente && (
        <Seccion titulo="Requiere tu atención" nivel="atencion" conteo={solicitudes.length} id="atencion">
          {est.error && <ErrorLectura texto={`No se pudieron actualizar tus solicitudes. ${est.error}`} onReintentar={() => void recargarAtencion()} />}
          {!est.listo ? <Cargando /> : solicitudes.length === 0 ? (
            !est.error && <Vacio titulo="Sin solicitudes de asesor." detalle="Tu cartera está al día. Te avisaremos aquí en cuanto un cliente pida atención." testid="vacio-solicitudes" />
          ) : (
            <Tarjetas>
              {solicitudes.map((c) => {
                const e = estadoDe(c)
                return (
                  <TarjetaAtencion key={c.conversation_id} testid="solicitud" persona={c.dueno} tono={tonoAtencion(e)} titulo={`${capitalizarNombre(c.dueno)} solicita atención`} estado={e ? ETIQUETA_ATENCION[e] : undefined}
                    lineas={lineasSolicitud(c)}
                    ctas={[{ label: 'Atender ahora', primaria: true, testid: 'btn-atender', onClick: () => irAConversacion(setScreen, c.conversation_id, { iniciar: true, origen: 'inicio' }) }]} />
                )
              })}
            </Tarjetas>
          )}
        </Seccion>
      )}
      {fuente && activas.length > 0 && (
        <Seccion titulo="Continúa donde te quedaste" nivel="continuar" conteo={activas.length} id="activas">
          <Tarjetas>
            {activas.map((c) => (
              <TarjetaAtencion key={c.conversation_id} testid="asesoria-activa" persona={c.dueno} tono="ok" titulo={capitalizarNombre(c.dueno)} estado="Asesoría en curso"
                lineas={[c.sin_leer > 0 ? `${c.sin_leer} mensaje${c.sin_leer === 1 ? '' : 's'} sin leer` : 'Sin mensajes nuevos', c.n_items ? `${c.n_items} producto${c.n_items === 1 ? '' : 's'} en su carrito` : 'Carrito vacío']}
                ctas={[{ label: 'Continuar', testid: 'btn-continuar', onClick: () => irAConversacion(setScreen, c.conversation_id, { origen: 'inicio' }) }]} />
            ))}
          </Tarjetas>
        </Seccion>
      )}
      <PorVencer onVer={() => setScreen('cartera_plazos')} />
      <OfrecerPromo onVer={() => setScreen('productos_clientes')} />
      {/* MENÚ (dueño, 17 oct 2026): Inicio = Mi bandeja + Seguimiento. La bandeja completa va aquí (sin "ver toda"),
          y los envíos de su cartera en una sección propia; esas dos entradas ya no están en el menú de Ventas. */}
      {(() => { const resto = tareas.filter((t) => !['comercial', 'asesorias_activas'].includes(t.id)); return (
        // UX MODERNO · sin pendientes, la sección no ocupa lugar (antes "Sin otros pendientes." en un bloque).
        resto.length === 0 ? null : (
        <Seccion titulo="Pendientes" nivel="continuar" conteo={resto.reduce((s, t) => s + t.count, 0)} id="bandeja">
          <div className="grid" style={{ gap: 10 }}><ListaTareas tareas={resto} onGo={setScreen} /></div>
        </Seccion>
      )) })()}
      {/* Embebido: sin el título propio de Seguimiento ni "Exportar"; sin filas muestra su vacío. */}
      {/* UX MODERNO · los envíos de su cartera, plegados (antes un bloque rojo con tarjetas completas encima de todo) */}
      <EnviosPlegados />
      <AtajosMovil items={atajos} />
    </div>
  )
}

/** PROSPECTAR (23 nov 2026) · a la vista en Inicio: registrar a alguien nuevo y mandarle su primer WhatsApp en un paso. */
function BandaProspectar() {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px' }} data-testid="home-prospectar">
      <div style={{ flex: 1, minWidth: 200 }}>
        <b style={{ display: 'block' }}>¿Conseguiste un cliente nuevo?</b>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Regístralo con su nombre y celular y mándale su primer WhatsApp desde aquí.</span>
      </div>
      <button type="button" className="btn" onClick={() => setAbierto(true)} data-testid="home-prospectar-abrir">＋ Prospectar</button>
      <Prospectar abierto={abierto} onCerrar={() => setAbierto(false)} />
    </div>
  )
}

function EnviosPlegados() {
  const [abierto, setAbierto] = useState(false)
  return (
    <section className="rh-sec" data-testid="rh-sec-seguimiento">
      <button type="button" className="tienda-pedido" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} data-testid="envios-plegados">
        <span className="tienda-pedido-ic" aria-hidden><Icon name="truck" /></span>
        <span className="tienda-pedido-tx"><b>Pedidos de tu cartera en camino</b><small>{abierto ? 'Toca para ocultar' : 'Toca para ver su seguimiento'}</small></span>
      </button>
      {abierto && <div style={{ marginTop: 12 }}><Seguimiento embebido /></div>}
    </section>
  )
}

// UX MODERNO · Fase 2 (15 nov 2026, auditoría: "el Inicio del vendedor no habla de ventas"). Tres cifras arriba, con
// los pedidos que el vendedor ya puede ver (los de su cartera): lo vendido en el mes del negocio, lo que falta cobrar
// y cuántos clientes lo esperan en Conversaciones.
export function CifrasVendedor({ esperan, onEsperan }: { esperan: number; onEsperan: () => void }) {
  const { data: pedidos } = useAllOrders()
  const { setScreen } = useRole()
  const mes = hoyNegocio().slice(0, 7)
  const vivos = pedidos.filter((o) => o.status !== 'cancelled' && o.status !== 'draft')
  const vendido = vivos.filter((o) => diaNegocio(o.created_at).startsWith(mes)).reduce((s, o) => s + Number(o.total ?? 0), 0)
  const porCobrar = vivos.filter((o) => o.payment_status !== 'paid' && o.payment_status !== 'refunded').reduce((s, o) => s + Number(o.total ?? 0), 0)
  return (
    <div className="cifras-v" data-testid="cifras-vendedor">
      <button type="button" className="cifra-v" onClick={() => abrirMisVentas(setScreen, 'mes')} data-testid="cifra-vendido"><span>Vendido este mes</span><b>{money(vendido)}</b></button>
      <button type="button" className="cifra-v" onClick={() => abrirMisVentas(setScreen, 'cobrar')} data-testid="cifra-por-cobrar"><span>Por cobrar</span><b className={porCobrar > 0 ? 'cifra-v--warn' : undefined}>{money(porCobrar)}</b></button>
      <button type="button" className="cifra-v" onClick={onEsperan} data-testid="cifra-esperan"><span>Te esperan</span><b className={esperan > 0 ? 'cifra-v--ok' : undefined}>{esperan}</b></button>
    </div>
  )
}

// CARTERA-PLAZO (3 nov 2026): clientes que dejan de ser suyos en los próximos 30 días si no le compran.
function PorVencer({ onVer, cargar = carteraPlazos }: { onVer: () => void; cargar?: typeof carteraPlazos }) {
  const [lista, setLista] = useState<ClientePlazo[] | null>(null)
  useEffect(() => { void cargar(30).then((r) => setLista(r?.clientes ?? [])) }, [cargar])
  if (!lista || lista.length === 0) return null
  return (
    <Seccion titulo="Véndeles antes de que se venzan" nivel="atencion" conteo={lista.length} id="por-vencer" accion={{ label: 'Ver todos', onClick: onVer }}>
      <Tarjetas>
        {lista.slice(0, 3).map((c) => (
          <TarjetaAtencion key={`${c.tipo}:${c.profile_id ?? c.customer_id ?? c.visitor_id}`} testid="inicio-por-vencer" persona={c.nombre} tono={tonoPlazo(c.dias_restantes) === 'dang' ? 'dang' : 'warn'}
            titulo={capitalizarNombre(c.nombre)} estado={textoPlazo(c.dias_restantes)} lineas={[textoSinCompra(c.dias_sin_compra), 'Si no te compra, pasa al siguiente vendedor en turno']}
            ctas={[{ label: 'Ver y hablarle', primaria: true, testid: 'btn-por-vencer', onClick: onVer }]} />
        ))}
      </Tarjetas>
    </Seccion>
  )
}

// COMPRADORES × PROMOCIÓN (3 nov 2026): a quién de su cartera hablarle hoy porque lo que ya compró está en promoción.
// Sin promociones vigentes o sin compradores no ocupa lugar.
function OfrecerPromo({ onVer, cargar = oportunidadesPromo }: { onVer: () => void; cargar?: typeof oportunidadesPromo }) {
  const [ofertas, setOfertas] = useState<OportunidadPromo[] | null>(null)
  useEffect(() => { void cargar().then((r) => setOfertas(r ?? [])) }, [cargar])
  if (!ofertas || ofertas.length === 0) return null
  return (
    <Seccion titulo="Ofrécele la promoción" nivel="continuar" conteo={ofertas.length} id="ofrecer-promo" accion={{ label: 'Ver a quién', onClick: onVer }}>
      <Tarjetas>
        {ofertas.slice(0, 3).map((o) => {
          const f = o.ofertas[0]; const p = f?.promos[0]
          return (
            <TarjetaAtencion key={o.customer_id} testid="inicio-oferta" persona={o.nombre} tono="ok" titulo={capitalizarNombre(o.nombre)} estado={p ? `${p.nombre} hasta el ${fmtDate(p.hasta)}` : undefined}
              lineas={[f ? `Compró ${f.presentaciones.length ? f.presentaciones.join(', ') : f.familia} · última ${fmtDate(f.ultima)}` : null, o.ofertas.length > 1 ? `y ${o.ofertas.length - 1} producto${o.ofertas.length === 2 ? '' : 's'} más en promoción` : null]}
              ctas={[{ label: 'Ofrecer', primaria: true, testid: 'btn-ofrecer', onClick: onVer }]} />
          )
        })}
      </Tarjetas>
    </Seccion>
  )
}

// ── DIRECCIÓN ─────────────────────────────────────────────────────────────────────────────────────────
// Lo que NO avanza hasta que Dirección decide: cancelar un pedido, validar un pago reportado, resolver un reembolso,
// decidir el destino de una devolución y qué hacer con un pago de más. El resto de la bandeja se vigila.
export const DECIDE_HOY = new Set(['cancelaciones', 'transfer', 'reembolso', 'disponer', 'sobrepago'])

export function HomeDireccion() {
  const { user, setScreen } = useRole()
  const est = useAtencionComercial('direccion')
  const { tareas, fuentes } = useBandeja()
  const interv = est.pendientes ? intervencionDireccion(est.pendientes.conversaciones) : []
  const horario = est.pendientes?.resumen.horario
  const atajos = useAccesos([
    { key: 'av_atencion', label: 'Conversaciones', icon: 'chat' },
    { key: 'bandeja', label: 'Mi bandeja', icon: 'check' },
    { key: 'av_pagos', label: 'Pagos por validar', icon: 'receipt' },
  ])
  const urgentes = tareas.filter((t) => t.tone === 'dang' && t.id !== 'comercial').length
  // PEDIDOS POR PASO (27 nov 2026): cuántos pedidos vivos hay en cada paso, con las mismas palabras de todo el sistema.
  // Cada cifra abre Ventas ya filtrada por ese paso.
  const { data: pedidosDir } = useAllOrders()
  const porPaso = useMemo(() => {
    const c = { por_confirmar: 0, en_almacen: 0, salio: 0 }
    for (const o of pedidosDir) {
      if (o.status === 'cancelled' || o.status === 'draft') continue
      const e = etapaSeguimiento({ status: o.status, payment_method: o.payment_method, shipping_meta: o.shipping_meta }).etapa
      if (e === 'por_confirmar') c.por_confirmar += 1
      else if (e === 'almacen' || e === 'empacado') c.en_almacen += 1
      else if (e === 'salio') c.salio += 1
    }
    return c
  }, [pedidosDir])
  const irPaso = (paso: string) => { pedirFiltro('av_ventas', 'paso:' + paso); setScreen('av_ventas') }
  // DECIDIR SIN SALIR DE INICIO (27 nov 2026): los pagos por validar y las cancelaciones se resuelven aquí mismo, con
  // las MISMAS acciones de sus pantallas («Pagos por validar» y Ventas). Solo aparecen si ese pendiente ya le salía.
  const pagos = usePagosPorValidar()
  const cancelacionesAqui = useSolicitudesCancelacion()
  const confirmarPago = async (t: (typeof pagos.rows)[number]['t'], o: NonNullable<(typeof pagos.rows)[number]['o']>) => {
    if (!(await confirmar(`¿Confirmas el pago de ${money(t.amount_declared)} (${metodoLabel(t.method).toLowerCase()}) del pedido ${o.external_ref ?? ''}? Se registra como cobrado.`, { aceptar: 'Sí, confirmar' }))) return
    if (await pagos.confirmar(o)) toast(`Pago confirmado · ${o.external_ref ?? ''}`)
  }
  return (
    <div className="rh" data-testid="home-direccion">
      {fuentes}
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} etiqueta="Dirección"
        detalle={interv.length ? `${interv.length} solicitud${interv.length === 1 ? '' : 'es'} comercial${interv.length === 1 ? '' : 'es'} requiere${interv.length === 1 ? '' : 'n'} tu intervención.` : urgentes ? 'Hay pendientes críticos en tu bandeja.' : 'Nada comercial requiere tu intervención ahora.'} />
      <Seccion titulo="Requiere tu intervención" nivel="atencion" conteo={interv.length} id="atencion" accion={{ label: 'Ver solicitudes', onClick: () => setScreen('av_atencion') }}>
        {est.error && <ErrorLectura texto={`No se pudo actualizar la atención comercial. ${est.error}`} onReintentar={() => void recargarAtencion()} />}
        {horario && !horario.configurado && (
          <Nota tono="warn"><span><b>{TEXTO_HORARIO_PENDIENTE}.</b> Las alertas por tiempo de espera están en pausa hasta configurarlo.</span>
            <button type="button" className="btn rh-btn" onClick={() => { abrirPestanaAtencion('horario'); setScreen('av_cartera') }} data-testid="btn-configurar-horario">Configurar horario</button></Nota>
        )}
        {!est.listo ? <Cargando /> : interv.length === 0 ? (
          !est.error && <Vacio titulo="No hay solicitudes comerciales que requieran intervención." detalle="Las solicitudes sin vendedor o escaladas aparecerán aquí." testid="vacio-intervencion" />
        ) : (
          <Tarjetas>
            {interv.map((c) => {
              const e = estadoDe(c)
              const quien = c.seller_nombre ? `Asignada a ${c.seller_nombre}` : c.ruteo_motivo ? MOTIVO_RUTEO[c.ruteo_motivo] ?? 'Sin vendedor' : 'Sin vendedor'
              const escalada = e === 'escalado'
              return (
                <TarjetaAtencion key={c.conversation_id} testid="intervencion" persona={c.nombre} tono={tonoAtencion(e)} estado={e ? ETIQUETA_ATENCION[e] : undefined}
                  titulo={escalada ? `${capitalizarNombre(c.nombre)} sigue esperando asesor` : `${capitalizarNombre(c.nombre)} solicita asesor`}
                  lineas={[quien, ...lineasSolicitud(c)]}
                  ctas={[
                    { label: 'Abrir', testid: 'btn-abrir-solicitud', onClick: () => irASolicitud(setScreen, c.conversation_id, { origen: 'inicio' }) },
                    { label: c.seller_id ? 'Reasignar' : 'Asignar', primaria: true, testid: 'btn-reasignar-solicitud', onClick: () => irASolicitud(setScreen, c.conversation_id, { reasignar: true, origen: 'inicio' }) },
                  ]} />
              )
            })}
          </Tarjetas>
        )}
      </Seccion>
      {/* MENÚ (dueño, 17 oct 2026): Inicio ES Mi bandeja: la lista completa, sin "ver toda". */}
      <Seccion titulo="Pedidos en curso" nivel="info" id="pasos">
        <div className="rh-pasos" data-testid="dir-pasos">
          <button type="button" className="rh-paso" onClick={() => irPaso('por_confirmar')} data-testid="dir-paso-por_confirmar"><b>{porPaso.por_confirmar}</b><span>Por confirmar</span></button>
          <button type="button" className="rh-paso" onClick={() => irPaso('en_almacen')} data-testid="dir-paso-en_almacen"><b>{porPaso.en_almacen}</b><span>En almacén</span></button>
          <button type="button" className="rh-paso" onClick={() => irPaso('salio')} data-testid="dir-paso-salio"><b>{porPaso.salio}</b><span>En camino o para recoger</span></button>
        </div>
      </Seccion>
      {/* DECIDE HOY / VIGILA (27 nov 2026, «sistema sencillo por rol») · «Pendientes» juntaba hasta 16 renglones del mismo
          peso. Arriba queda SOLO lo que está detenido hasta que Dirección responda; lo demás se vigila. Son los mismos
          renglones y llevan a las mismas pantallas: nada se quitó. */}
      {(() => {
        const resto = [...tareas].sort(porUrgencia).filter((t) => t.id !== 'comercial')
        const decide = resto.filter((t) => DECIDE_HOY.has(t.id)); const vigila = resto.filter((t) => !DECIDE_HOY.has(t.id))
        const tPagos = decide.find((t) => t.id === 'transfer'); const tCanc = decide.find((t) => t.id === 'cancelaciones')
        const pagosAqui = tPagos ? pagos.rows.filter((r) => r.o).slice(0, 3) : []
        // El renglón de cada pendiente se cambia por sus casos SOLO si los casos ya están a la vista; si no, queda el renglón.
        const cancAqui = !!tCanc && cancelacionesAqui.length > 0
        const enRenglon = decide.filter((t) => !(t.id === 'transfer' && pagosAqui.length > 0) && !(t.id === 'cancelaciones' && cancAqui))
        return (
          <>
            {decide.length > 0 && (
              <Seccion titulo="Decide hoy" nivel="atencion" conteo={decide.reduce((s, t) => s + t.count, 0)} id="decide">
                <div className="grid" style={{ gap: 10 }}>
                  {pagosAqui.length > 0 && (
                    <div className="tasklist" data-testid="decide-pagos">
                      {pagosAqui.map(({ t, o }) => {
                        const saldo = pagos.byOrder[o!.id]?.saldo ?? o!.total ?? 0
                        return (
                          <div key={t.id} className="taskrow rh-decision" data-testid="decide-pago">
                            <span className="taskrow-tx">
                              <span className="taskrow-t">{metodoLabel(t.method)} de {money(t.amount_declared)}</span>
                              <span className="taskrow-d"><span className="mono">{o!.external_ref}</span> · {capitalizarNombre(pagos.clientName(o)) || pagos.clientName(o)} · {pagos.bankLabel(t)}{t.reference ? ` · ref. ${t.reference}` : ''}{Math.abs(saldo - t.amount_declared) > 0.01 ? ` · saldo del pedido ${money(saldo)}` : ''}</span>
                            </span>
                            <span className="rh-decision-btns">
                              {t.proof_path ? <button type="button" className="btn ghost sm" onClick={() => void pagos.verProof(t.proof_path!)} data-testid="decide-pago-ver">Ver comprobante</button> : <span className="rh-decision-nota">Sin comprobante</span>}
                              <button type="button" className="btn ghost sm" disabled={pagos.busy === o!.id} onClick={() => void pagos.rechazar(o!)} data-testid="decide-pago-rechazar">Rechazar</button>
                              <button type="button" className="btn sm" disabled={pagos.busy === o!.id} onClick={() => void confirmarPago(t, o!)} data-testid="decide-pago-confirmar">Confirmar</button>
                            </span>
                          </div>
                        )
                      })}
                      {tPagos && tPagos.count > pagosAqui.length && <button type="button" className="taskrow rh-decision-mas" onClick={() => setScreen('av_pagos')} data-testid="decide-pagos-mas">Ver los {tPagos.count} pagos por validar</button>}
                    </div>
                  )}
                  {cancAqui && <SolicitudesCancelacionPendientes />}
                  {enRenglon.length > 0 && <ListaTareas tareas={enRenglon} onGo={setScreen} />}
                </div>
              </Seccion>
            )}
            <Seccion titulo="Vigila" nivel="continuar" conteo={vigila.reduce((s, t) => s + t.count, 0)} id="bandeja">
              {vigila.length === 0 ? <Vacio titulo={decide.length ? 'Lo demás está al día.' : 'Tu bandeja está al día.'} /> : <div className="grid" style={{ gap: 10 }}><ListaTareas tareas={vigila} onGo={setScreen} /></div>}
            </Seccion>
          </>
        )
      })()}
      <AtajosMovil items={atajos} />
    </div>
  )
}

// ── ALMACÉN / EMPAQUE ─────────────────────────────────────────────────────────────────────────────────
// ALM-1 · Inicio = Hoy = Mi bandeja (dueño, 17 oct 2026: "pudieran unirse en uno mismo"). Una sola pantalla: el saludo,
// las tarjetas del día, los casos que esperan decisión con su botón (preparar → enviar) y, debajo, lo demás pendiente
// (despachar, recibir, inspeccionar, caducidades). Las pestañas de detalle siguen en el menú; "Hoy" y "Mi bandeja" no.
export function HomeAlmacen({ etiqueta = 'Almacén y empaque' }: { etiqueta?: string } = {}) {
  const { user, setScreen } = useRole()
  const { tareas, fuentes } = useBandeja()
  const resto = tareas.filter((t) => !['surtir', 'empacar'].includes(t.id))   // esos dos ya están como casos con botón
  const atajos = useAccesos([
    { key: 'entradas', label: 'Recibir mercancía', icon: 'download' },
    { key: 'surtido', label: 'Preparar pedidos', icon: 'layers' },
    { key: 'cola', label: 'Por enviar', icon: 'pkg' },
  ])
  return (
    <div className="rh rh--almacen" data-testid="home-almacen">
      {fuentes}
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} etiqueta={etiqueta}
        detalle="Lo de hoy, en una sola pantalla: prepara, envía y lo demás pendiente." />
      <HoyAlmacen />
      {resto.length > 0 && (
        <Seccion titulo="Otros pendientes" nivel="continuar" conteo={resto.reduce((s, t) => s + t.count, 0)} id="otros">
          <div className="grid" style={{ gap: 10 }}><ListaTareas tareas={resto} onGo={setScreen} /></div>
        </Seccion>
      )}
      <AtajosMovil items={atajos} />
    </div>
  )
}

// ── CHOFER ────────────────────────────────────────────────────────────────────────────────────────────
export function HomeChofer() {
  const { user, setScreen, vistaPrevia } = useRole()
  const comoDueno = vistaPrevia === 'driver'   // DUEÑO · trabajando como Chofer ve todas las rutas
  const { data: shipments, confirmLoad } = useShipments()
  const { data: orders } = useAllOrders()
  const driverId = driverIdByEmail(user?.email)
  // Misma regla que "Mis entregas": solo con chofer resuelto (evita que driver_id null entre por null===null).
  const mias = (comoDueno || driverId) ? shipments.filter((s) => (comoDueno ? !!s.driver_id : s.driver_id === driverId) && s.status !== 'delivered' && s.status !== 'cancelado') : []
  const incidencias = mias.filter((s) => s.incident && !s.incident.resolved)
  // Siguiente parada = el orden de ruta que el chofer eligió en "Mis entregas" (solo lectura).
  const siguiente = useMemo(() => {
    let orden: string[] = []
    try { orden = JSON.parse(localStorage.getItem(`rnc-ruta-${driverId ?? 'anon'}`) ?? '[]') as string[] } catch { orden = [] }
    const elegida = orden.map((id) => mias.find((s) => s.id === id)).find(Boolean)
    return elegida ?? mias[0] ?? null
  }, [mias, driverId])
  const pedido = siguiente ? orders.find((o) => o.id === siguiente.order_id) : undefined
  const parada = pedido ? deliveryOf(pedido) : null
  // CHOFER · MENOS PASOS (27 nov 2026): la carga se recibe completa de un toque desde Inicio, y la siguiente parada trae
  // sus tres botones (Entregar · Llamar · Navegar). «Entregar» baja directo a ESA parada en «Mi ruta».
  const porRecibir = cargaPorConfirmar(mias)
  const [recibiendo, setRecibiendo] = useState(false)
  const recibirTodo = async () => {
    setRecibiendo(true)
    const r = await confirmarTodaLaCarga(porRecibir.map((s) => ({ id: s.id, folio: orders.find((o) => o.id === s.order_id)?.external_ref ?? s.order_id })), driverName(driverId), confirmLoad)
    setRecibiendo(false)
    toast(r.texto, r.ok ? 'ok' : 'error')
  }
  const enReparto = siguiente?.status === 'out_for_delivery' || siguiente?.status === 'incident'
  const tel = telParaMarcar(parada?.phone)
  const porCobrar = pedido && pedido.payment_status !== 'paid' && pedido.total != null ? `Cobrar ${money(pedido.total)} al entregar` : null
  const atajos = useAccesos([{ key: 'driver_home', label: 'Mis entregas', icon: 'truck' }])
  return (
    // Pulido (29 oct): sin etiqueta "Chofer" (ya la dice la barra superior) y el resumen del día en el saludo;
    // el vacío de abajo no repite la misma frase. .rh--chofer acota el CSS (vacío en tarjeta, atajo a lo ancho).
    <div className="rh rh--chofer" data-testid="home-chofer">
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)}
        detalle={mias.length ? `Hoy: ${mias.length} entrega${mias.length === 1 ? '' : 's'} por hacer.` : 'Hoy: sin entregas asignadas por ahora.'} />
      {incidencias.length > 0 && (
        <Seccion titulo="Requiere tu atención" nivel="atencion" conteo={incidencias.length} id="atencion">
          <Tarjetas>
            <TarjetaAtencion tono="dang" icono="truck" titulo={`${incidencias.length} incidencia${incidencias.length === 1 ? '' : 's'} sin resolver`} lineas={['Revisa la entrega y repórtala o reintenta.']}
              ctas={[{ label: 'Ver mis entregas', primaria: true, onClick: () => setScreen('driver_home') }]} testid="incidencias" />
          </Tarjetas>
        </Seccion>
      )}
      {porRecibir.length > 0 && (
        <Seccion titulo="Tu carga" nivel="atencion" conteo={porRecibir.length} id="carga">
          <Tarjetas>
            <TarjetaAtencion tono="warn" icono="truck" testid="carga-por-recibir" titulo={`Almacén te entregó ${porRecibir.length} pedido${porRecibir.length === 1 ? '' : 's'}`}
              lineas={['Cuenta tus paquetes y confirma que los recibiste.']}
              ctas={[
                { label: recibiendo ? 'Confirmando tu carga…' : `Recibí mi carga (${porRecibir.length} pedido${porRecibir.length === 1 ? '' : 's'})`, primaria: true, disabled: recibiendo, onClick: () => void recibirTodo(), testid: 'inicio-recibir-carga' },
                { label: 'Falta algo o viene dañado', onClick: () => setScreen('driver_home') },
              ]} />
          </Tarjetas>
        </Seccion>
      )}
      <Seccion titulo="Tu siguiente entrega" nivel="continuar" conteo={mias.length} id="siguiente">
        {!siguiente ? <Vacio icon="truck" titulo="Tu ruta está libre" detalle="Cuando Almacén te asigne carga, aquí verás la dirección y cómo llegar." testid="vacio-chofer" /> : (
          <Tarjetas>
            <TarjetaAtencion tono="neu" icono="truck" testid="siguiente-entrega" titulo={parada?.name ?? 'Entrega asignada'} estado={pedido?.external_ref ?? undefined}
              lineas={[parada?.addr || null, porCobrar, mias.length > 1 ? `Después: ${mias.length - 1} parada${mias.length - 1 === 1 ? '' : 's'} más` : 'Es tu última parada']}
              ctas={[
                { label: enReparto ? 'Entregar' : 'Ver la parada', primaria: true, testid: 'ir-parada', onClick: () => { pedirParada(siguiente.id); setScreen('driver_home') } },
                ...(tel ? [{ label: 'Llamar', onClick: () => { window.location.href = `tel:${tel}` } }] : []),
                ...(parada?.addr ? [{ label: 'Navegar', onClick: () => { window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parada.addr)}`, '_blank', 'noopener') } }] : []),
              ]} />
          </Tarjetas>
        )}
      </Seccion>
      <AtajosMovil items={atajos} />
    </div>
  )
}
