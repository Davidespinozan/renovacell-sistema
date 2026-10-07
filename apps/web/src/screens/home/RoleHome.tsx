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
  if (role === 'pos') return <HomeVendedor />
  return <HomeDireccion />
}

/** Atajos (solo móvil) acotados a lo que el rol puede abrir (nunca un destino fuera de su navegación). */
function useAccesos(defs: Array<Omit<Acceso, 'onClick'>>): Acceso[] {
  const { role, capabilities, setScreen } = useRole()
  const nav = useMemo(() => new Set(getNav(getRole(role as RoleKey), undefined, capabilities).map((s) => s.key)), [role, capabilities])
  return defs.filter((d) => nav.has(d.key)).map((d) => ({ ...d, onClick: () => setScreen(d.key) }))
}

/**
 * Resumen de la bandeja en Inicio, separado por la urgencia CANÓNICA de cada tarea (su tono en la cola):
 *   · atención operativa (crítico/advertencia) — cuenta y se destaca;
 *   · rezago administrativo (informativo, p. ej. validación fiscal de catálogo) — visible con su conteo
 *     real, pero sin el peso de una emergencia.
 */
function BandejaResumen({ tareas, excluir = [], limite = 5, vacio }: { tareas: Task[]; excluir?: string[]; limite?: number; vacio: string }) {
  const { setScreen } = useRole()
  const lista = tareas.filter((t) => !excluir.includes(t.id))
  const urgentes = lista.filter((t) => t.tone !== 'neu')
  const rezago = lista.filter((t) => t.tone === 'neu')
  const total = urgentes.reduce((s, t) => s + t.count, 0)
  return (
    <>
      <Seccion titulo="Pendientes de tu bandeja" nivel="continuar" conteo={total} id="bandeja" accion={{ label: 'Ver toda mi bandeja', onClick: () => setScreen('bandeja') }}>
        {urgentes.length === 0 ? <Vacio titulo={vacio} /> : <div className="grid" style={{ gap: 10 }}><ListaTareas tareas={urgentes} limite={limite} onGo={setScreen} /></div>}
      </Seccion>
      {rezago.length > 0 && (
        <section className="rh-sec rh-sec--rezago" aria-labelledby="rh-rezago" data-testid="rh-sec-rezago">
          <div className="rh-sec-h"><h3 id="rh-rezago">Por preparar · no urgente</h3></div>
          <p className="rh-rezago-nota">Trabajo administrativo pendiente. No bloquea la operación de hoy.</p>
          <div className="grid" style={{ gap: 10 }}><ListaTareas tareas={rezago} limite={3} onGo={setScreen} /></div>
        </section>
      )}
    </>
  )
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
      <BandejaResumen tareas={tareas} excluir={['comercial', 'asesorias_activas']} vacio="Sin otros pendientes en tu bandeja." />
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
    { key: 'av_atencion', label: 'Atención comercial', icon: 'chat' },
    { key: 'bandeja', label: 'Mi bandeja', icon: 'check' },
    { key: 'av_pagos', label: 'Pagos por validar', icon: 'receipt' },
  ])
  const urgentes = tareas.filter((t) => t.tone === 'dang' && t.id !== 'comercial').length
  return (
    <div className="rh" data-testid="home-direccion">
      {fuentes}
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} etiqueta="Dirección"
        detalle={interv.length ? `${interv.length} solicitud${interv.length === 1 ? '' : 'es'} comercial${interv.length === 1 ? '' : 'es'} requiere${interv.length === 1 ? '' : 'n'} tu intervención.` : urgentes ? 'Hay pendientes críticos en tu bandeja.' : 'Nada comercial requiere tu intervención ahora.'} />
      <Seccion titulo="Requiere tu intervención" nivel="atencion" conteo={interv.length} id="atencion" accion={{ label: 'Atención comercial', onClick: () => setScreen('av_atencion') }}>
        {est.error && <ErrorLectura texto={`No se pudo actualizar la atención comercial. ${est.error}`} onReintentar={() => void recargarAtencion()} />}
        {horario && !horario.configurado && (
          <Nota tono="warn"><span><b>{TEXTO_HORARIO_PENDIENTE}.</b> Las alertas por tiempo de espera están en pausa hasta configurarlo.</span>
            <button type="button" className="btn rh-btn" onClick={() => { abrirPestanaAtencion('horario'); setScreen('av_atencion') }} data-testid="btn-configurar-horario">Configurar horario</button></Nota>
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
      <BandejaResumen tareas={[...tareas].sort(porUrgencia)} excluir={['comercial']} vacio="El resto de tu bandeja está al día." />
      <AtajosMovil items={atajos} />
    </div>
  )
}

// ── ALMACÉN / EMPAQUE ─────────────────────────────────────────────────────────────────────────────────
export function HomeAlmacen() {
  const { user, setScreen } = useRole()
  const { tareas, fuentes } = useBandeja()
  const urgentes = tareas.filter((t) => t.tone !== 'neu')
  const otras = tareas.filter((t) => t.tone === 'neu')
  const atajos = useAccesos([
    { key: 'entradas', label: 'Recibir mercancía', icon: 'download' },
    { key: 'surtido', label: 'Preparar pedidos', icon: 'layers' },
    { key: 'cola', label: 'Por empacar', icon: 'pkg' },
  ])
  return (
    <div className="rh" data-testid="home-almacen">
      {fuentes}
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} etiqueta="Almacén y empaque"
        detalle={urgentes.length ? 'Esto es lo que requiere tu atención en almacén.' : 'No hay trabajo urgente en almacén.'} />
      <Seccion titulo="Requiere tu atención" nivel="atencion" conteo={urgentes.reduce((s, t) => s + t.count, 0)} id="atencion" accion={{ label: 'Ver toda mi bandeja', onClick: () => setScreen('bandeja') }}>
        {urgentes.length === 0 ? <Vacio titulo="No hay trabajo urgente en almacén." detalle="Pedidos por surtir, empacar o despachar aparecerán aquí." testid="vacio-almacen" />
          : <div className="grid" style={{ gap: 10 }}><ListaTareas tareas={urgentes} limite={6} onGo={setScreen} /></div>}
      </Seccion>
      {otras.length > 0 && (
        <Seccion titulo="Para hoy" nivel="continuar" id="hoy"><div className="grid" style={{ gap: 10 }}><ListaTareas tareas={otras} limite={4} onGo={setScreen} /></div></Seccion>
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
    <div className="rh" data-testid="home-chofer">
      <Bienvenida nombre={user?.name ?? ''} avatarUrl={user?.avatarUrl} titulo={saludo(user?.name)} etiqueta="Chofer"
        detalle={mias.length ? `${mias.length} entrega${mias.length === 1 ? '' : 's'} pendiente${mias.length === 1 ? '' : 's'}.` : 'No tienes entregas pendientes.'} />
      {incidencias.length > 0 && (
        <Seccion titulo="Requiere tu atención" nivel="atencion" conteo={incidencias.length} id="atencion">
          <Tarjetas>
            <TarjetaAtencion tono="dang" titulo={`${incidencias.length} incidencia${incidencias.length === 1 ? '' : 's'} sin resolver`} lineas={['Revisa la entrega y repórtala o reintenta.']}
              ctas={[{ label: 'Ver mis entregas', primaria: true, onClick: () => setScreen('driver_home') }]} testid="incidencias" />
          </Tarjetas>
        </Seccion>
      )}
      <Seccion titulo="Tu siguiente entrega" nivel="continuar" conteo={mias.length} id="siguiente">
        {!siguiente ? <Vacio icon="truck" titulo="No tienes entregas pendientes." detalle="Cuando Almacén te asigne carga aparecerá aquí." testid="vacio-chofer" /> : (
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
