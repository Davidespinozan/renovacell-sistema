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
import React, { useMemo } from 'react'
import { useRole } from '../../auth/RoleContext'
import { getNav, getRole, type RoleKey } from '../../app/roles'
import { useBandeja, ListaTareas, porUrgencia, type Task } from '../Bandeja'
import { HoyAlmacen } from '../warehouse/HoyAlmacen'
import { Seguimiento } from '../logistics/Seguimiento'
import { useAtencionComercial, fuenteComercial, recargarAtencion } from '../../data/store/atencionStore'
import { activasVendedor, intervencionDireccion, lineasSolicitud, solicitudesVendedor, ETIQUETA_ATENCION, tonoAtencion, estadoDe, TEXTO_HORARIO_PENDIENTE } from '../../data/ops/atencionComercial'
import { MOTIVO_RUTEO } from '../../data/ops/atencion'
import { irAConversacion, irASolicitud } from '../../data/store/navIntentStore'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { driverIdByEmail } from '../../data/mock/shipments'
import { deliveryOf } from '../../data/mock/profiles'
import { AtajosMovil, Bienvenida, Cargando, ErrorLectura, Nota, Seccion, TarjetaAtencion, Tarjetas, Vacio, type Acceso } from './primitives'
import { capitalizarNombre, saludo } from '../../lib/nombres'
import { HomeDoctor } from './HomeDoctor'
import { abrirPestanaAtencion } from '../admin/AtencionComercial'

export function RoleHome() {
  const { role } = useRole()
  if (role === 'doctor') return <HomeDoctor />
  if (role === 'driver') return <HomeChofer />
  if (role === 'warehouse') return <HomeAlmacen />
  if (role === 'packing') return <HomeAlmacen etiqueta="Empaque y despacho" />
  if (role === 'pos') return <HomeVendedor />
  return <HomeDireccion />
}

/** Atajos (solo móvil) acotados a lo que el rol puede abrir (nunca un destino fuera de su navegación). */
function useAccesos(defs: Array<Omit<Acceso, 'onClick'>>): Acceso[] {
  const { role, capabilities, setScreen } = useRole()
  const nav = useMemo(() => new Set(getNav(getRole(role as RoleKey), undefined, capabilities).map((s) => s.key)), [role, capabilities])
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
    { key: 'asesorias', label: 'Conversaciones', icon: 'chat' },
    { key: 'caja', label: 'Punto de venta', icon: 'store' },
    { key: 'clientes', label: 'Clientes', icon: 'usercheck' },
  ])
  const detalle = !fuente ? 'Tu cartera y tus ventas de hoy.'
    : solicitudes.length ? solicitudes.length === 1 ? 'Un cliente te espera. El asistente lo atiende mientras llegas.' : `${solicitudes.length} clientes te esperan. El asistente los atiende mientras llegas.`
      : 'Sin solicitudes de asesor por ahora.'
  return (
    <div className="rh" data-testid="home-vendedor">
      {fuentes}
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} detalle={detalle} etiqueta="Ventas" />
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
                  <TarjetaAtencion key={c.conversation_id} testid="solicitud" tono={tonoAtencion(e)} titulo={`${capitalizarNombre(c.dueno)} solicita atención`} estado={e ? ETIQUETA_ATENCION[e] : undefined}
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
              <TarjetaAtencion key={c.conversation_id} testid="asesoria-activa" tono="ok" titulo={capitalizarNombre(c.dueno)} estado="Asesoría en curso"
                lineas={[c.sin_leer > 0 ? `${c.sin_leer} mensaje${c.sin_leer === 1 ? '' : 's'} sin leer` : 'Sin mensajes nuevos', c.n_items ? `${c.n_items} producto${c.n_items === 1 ? '' : 's'} en su carrito` : 'Carrito vacío']}
                ctas={[{ label: 'Continuar', testid: 'btn-continuar', onClick: () => irAConversacion(setScreen, c.conversation_id, { origen: 'inicio' }) }]} />
            ))}
          </Tarjetas>
        </Seccion>
      )}
      {/* MENÚ (dueño, 17 oct 2026): Inicio = Mi bandeja + Seguimiento. La bandeja completa va aquí (sin "ver toda"),
          y los envíos de su cartera en una sección propia; esas dos entradas ya no están en el menú de Ventas. */}
      {(() => { const resto = tareas.filter((t) => !['comercial', 'asesorias_activas'].includes(t.id)); return (
        <Seccion titulo="Pendientes" nivel="continuar" conteo={resto.reduce((s, t) => s + t.count, 0)} id="bandeja">
          {resto.length === 0 ? <Vacio titulo="Sin otros pendientes." /> : <div className="grid" style={{ gap: 10 }}><ListaTareas tareas={resto} onGo={setScreen} /></div>}
        </Seccion>
      ) })()}
      {/* Embebido: sin el título propio de Seguimiento ni "Exportar"; sin filas muestra su vacío. */}
      <Seccion titulo="Pedidos de mi cartera en camino" nivel="info" id="seguimiento"><Seguimiento embebido /></Seccion>
      <AtajosMovil items={atajos} />
    </div>
  )
}

// ── DIRECCIÓN ─────────────────────────────────────────────────────────────────────────────────────────
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
                <TarjetaAtencion key={c.conversation_id} testid="intervencion" tono={tonoAtencion(e)} estado={e ? ETIQUETA_ATENCION[e] : undefined}
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
      {(() => { const resto = [...tareas].sort(porUrgencia).filter((t) => t.id !== 'comercial'); return (
        <Seccion titulo="Pendientes" nivel="continuar" conteo={resto.reduce((s, t) => s + t.count, 0)} id="bandeja">
          {resto.length === 0 ? <Vacio titulo="El resto de tu bandeja está al día." /> : <div className="grid" style={{ gap: 10 }}><ListaTareas tareas={resto} onGo={setScreen} /></div>}
        </Seccion>
      ) })()}
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
    <div className="rh" data-testid="home-almacen">
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
  const { user, setScreen } = useRole()
  const { data: shipments } = useShipments()
  const { data: orders } = useAllOrders()
  const driverId = driverIdByEmail(user?.email)
  // Misma regla que "Mis entregas": solo con chofer resuelto (evita que driver_id null entre por null===null).
  const mias = driverId ? shipments.filter((s) => s.driver_id === driverId && s.status !== 'delivered') : []
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
            <TarjetaAtencion tono="dang" titulo={`${incidencias.length} incidencia${incidencias.length === 1 ? '' : 's'} sin resolver`} lineas={['Revisa la entrega y repórtala o reintenta.']}
              ctas={[{ label: 'Ver mis entregas', primaria: true, onClick: () => setScreen('driver_home') }]} testid="incidencias" />
          </Tarjetas>
        </Seccion>
      )}
      <Seccion titulo="Tu siguiente entrega" nivel="continuar" conteo={mias.length} id="siguiente">
        {!siguiente ? <Vacio icon="truck" titulo="Tu ruta está libre" detalle="Cuando Almacén te asigne carga, aquí verás la dirección y cómo llegar." testid="vacio-chofer" /> : (
          <Tarjetas>
            <TarjetaAtencion tono="neu" testid="siguiente-entrega" titulo={parada?.name ?? 'Entrega asignada'} estado={pedido?.external_ref ?? undefined}
              lineas={[parada?.addr || null, mias.length > 1 ? `Después: ${mias.length - 1} parada${mias.length - 1 === 1 ? '' : 's'} más` : 'Es tu última parada']}
              ctas={[{ label: 'Ir a la entrega', primaria: true, onClick: () => setScreen('driver_home') }]} />
          </Tarjetas>
        )}
      </Seccion>
      <AtajosMovil items={atajos} />
    </div>
  )
}
