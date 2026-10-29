// SEC-C4-B4 · "Clientes" para VENTAS: sin precargar el directorio.
//   · Todos      = buscador seguro (servicio B2 → buscar_clientes_pos): búsqueda EXPLÍCITA (Enter o botón), hasta 6
//                  resultados, solo nombre y ••••últimos 4. Descubrir una cuenta NO da acceso a su expediente.
//   · Mi cartera = asignaciones VIGENTES que devuelve el servidor (cc_mi_cartera). El filtro es local y solo sobre
//                  esas cuentas. Nunca por teléfono, correo ni vendedor histórico de Odoo.
//   · La cartera histórica (Odoo) no se muestra a Ventas (ocultar la pestaña NO es un control de seguridad: el
//     control real es del servidor).
// Abrir una cuenta pasa SIEMPRE por la ficha 360 (RPC autorizada): si el servidor la niega, se ve el aviso y nada más.
import React, { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { Vacio, Cargando } from './EmptyState'
import { initials, avatarColor } from '../lib/format'
import { useRole } from '../auth/RoleContext'
import { BuscadorClientes, mensajeBusqueda, plegar, validarBusqueda, type ClienteBusqueda, type EstadoBusqueda } from '../data/ops/buscarClientes'
import { cartera as carteraPorDefecto, type ClienteCartera } from '../data/ops/cartera'
import type { ClienteC360 } from '../data/ops/customer360'
import { Customer360Page } from './Customer360'
import { NuevoPedido } from '../screens/sales/NuevoPedido'

type Vista = 'all' | 'cartera'
type Busqueda =
  | { fase: 'inicial' }
  | { fase: 'buscando'; q: string }
  | { fase: 'resultados'; q: string; clientes: ClienteBusqueda[] }
  | { fase: 'aviso'; q: string; estado: Exclude<EstadoBusqueda, 'ok' | 'cancelada'> }
interface FilaCartera { clave: string; customer_id: string | null; nombre: string }
type Cartera = { fase: 'cargando' } | { fase: 'lista'; filas: FilaCartera[] } | { fase: 'error'; mensaje: string }
interface Abierto { id: string; nombre: string }

const peligro = { background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' }
const tenue = { fontSize: 12.5, color: 'var(--ink-3)' }

export function DirectorioVentas({ title, conCartera, clienteCartera = carteraPorDefecto, buscador: buscadorInyectado, cliente360 }: {
  title: string
  conCartera: boolean
  clienteCartera?: ClienteCartera
  buscador?: BuscadorClientes          // inyectable en pruebas; por defecto uno propio de la pantalla
  cliente360?: ClienteC360
}) {
  const { user, setScreen, logout } = useRole()
  const propio = useRef<BuscadorClientes | null>(null)
  if (!buscadorInyectado && !propio.current) propio.current = new BuscadorClientes()
  const buscador = buscadorInyectado ?? (propio.current as BuscadorClientes)

  const [vista, setVista] = useState<Vista>('all')
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState<Busqueda>({ fase: 'inicial' })
  const [miCartera, setMiCartera] = useState<Cartera>({ fase: 'cargando' })
  const [filtro, setFiltro] = useState('')
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const [pedido, setPedido] = useState<Abierto | null>(null)
  const vivo = useRef(true)
  const turno = useRef(0)

  // Al salir de la pantalla: nada en curso ni en memoria (la caché nunca toca el almacenamiento del navegador).
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; buscador.cancelar(); propio.current?.limpiar() } }, [buscador])

  const cargarCartera = useCallback(async () => {
    const mio = ++turno.current
    setMiCartera({ fase: 'cargando' })
    const r = await clienteCartera.miCartera()
    if (!vivo.current || mio !== turno.current) return
    if (!r.ok) { setMiCartera({ fase: 'error', mensaje: r.error }); return }
    // Del contrato solo se usa identificador y nombre.
    setMiCartera({ fase: 'lista', filas: r.data.map((a) => ({ clave: a.customer_id ?? `p:${a.profile_id}`, customer_id: a.customer_id ?? null, nombre: a.nombre })) })
  }, [clienteCartera])
  // La cartera se pide solo al entrar a su pestaña (y al refrescar); "Todos" no consulta nada por sí sola.
  const carteraPedida = useRef(false)
  useEffect(() => { if (vista === 'cartera' && !carteraPedida.current) { carteraPedida.current = true; void cargarCartera() } }, [vista, cargarCartera])

  const buscar = async (q: string) => {
    if (!validarBusqueda(q).ok) { buscador.cancelar(); setBusqueda({ fase: 'aviso', q, estado: 'entrada_invalida' }); return }   // sin llamada
    setBusqueda({ fase: 'buscando', q })
    const r = await buscador.buscar(q)
    if (!vivo.current) return
    if (r.estado === 'cancelada') { setBusqueda((b) => (b.fase === 'buscando' && b.q === q ? { fase: 'inicial' } : b)); return }
    setBusqueda(r.estado === 'ok' ? { fase: 'resultados', q, clientes: r.clientes } : { fase: 'aviso', q, estado: r.estado })
  }
  const enviar = (e: FormEvent) => { e.preventDefault(); if (busqueda.fase !== 'buscando') void buscar(texto) }

  const filasCartera = useMemo(() => {
    if (miCartera.fase !== 'lista') return []
    const f = plegar(filtro.trim())
    return f ? miCartera.filas.filter((c) => plegar(c.nombre).includes(f)) : miCartera.filas
  }, [miCartera, filtro])

  if (abierto) {
    return (
      <>
        {/* Encabezado provisional: SOLO el nombre ya visible en la lista. El resto lo decide la RPC autorizada. */}
        <Customer360Page
          customerId={abierto.id}
          inicial={{ nombre: abierto.nombre }}
          onBack={() => setAbierto(null)}
          canOrder
          onOrder={() => setPedido(abierto)}
          onAsesorias={() => setScreen('asesorias')}
          {...(cliente360 ? { cliente: cliente360 } : {})}
        />
        {/* El pedido recibe identificador y nombre; el servidor sella el resto de la cuenta. */}
        {pedido && <NuevoPedido customer={{ id: pedido.id, name: pedido.nombre, phone: null }} placedBy={`${user?.name ?? 'Ventas'} (Ventas)`} onClose={() => setPedido(null)} />}
      </>
    )
  }

  return (
    <div className="grid" style={{ gap: 16 }} data-testid="directorio-ventas">
      <div className="eyebrow crumb">{title} · Directorio comercial</div>

      {conCartera && (
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {([['all', 'Todos'], ['cartera', 'Mi cartera']] as const).map(([k, lbl]) => (
            <button key={k} type="button" className={vista === k ? 'active' : undefined} aria-pressed={vista === k} onClick={() => setVista(k)} data-testid={`vista-${k}`}>{lbl}</button>
          ))}
        </div>
      )}

      {vista === 'all' && (
        <>
          <form onSubmit={enviar} style={{ display: 'flex', gap: 8 }} data-testid="dv-form">
            <label className="searchbox op-search">
              <Search aria-hidden />
              <input value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar cliente" maxLength={80}
                placeholder="Nombre (3 letras o más) o últimos 4 dígitos del teléfono" />
            </label>
            <button className="btn" type="submit" disabled={busqueda.fase === 'buscando'} data-testid="dv-buscar">Buscar</button>
          </form>
          <div style={{ display: 'grid', gap: 10 }} aria-live="polite" data-testid="dv-resultados">
            {busqueda.fase === 'inicial' && (
              <Vacio icono="search" data-testid="dv-inicial" titulo="Busca una cuenta por nombre o por los últimos 4 dígitos de su teléfono."
                pista="Escribe y presiona Buscar o Enter. Verás hasta 6 coincidencias con nombre y teléfono enmascarado. Tus clientes asignados están en Mi cartera." />
            )}
            {busqueda.fase === 'buscando' && <Cargando etiqueta={`Buscando «${busqueda.q.trim()}»…`} />}
            {busqueda.fase === 'resultados' && busqueda.clientes.length === 0 && (
              <Vacio icono="search" data-testid="dv-vacio" titulo={<>Ninguna cuenta coincide con “{busqueda.q.trim()}”.</>} />
            )}
            {busqueda.fase === 'resultados' && busqueda.clientes.length > 0 && (
              <>
                <div style={tenue}>Resultados de «{busqueda.q.trim()}». Si no aparece, escribe más del nombre.</div>
                {/* Resultados y cartera: una tarjeta-lista con divisores, no una tarjeta alta por cliente. */}
                <div className="card op-lista">
                {busqueda.clientes.map((c) => (
                  <button key={c.customer_id} type="button" className="op-fila" onClick={() => setAbierto({ id: c.customer_id, nombre: c.nombre })} data-testid="dv-resultado">
                    <div className="avatar" style={{ background: avatarColor(c.nombre || '?') }}>{initials(c.nombre || '?')}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                      <div style={tenue}>{c.telefono_mascara ? `Tel. ${c.telefono_mascara}` : 'Sin teléfono registrado'}</div>
                    </div>
                  </button>
                ))}
                </div>
              </>
            )}
            {busqueda.fase === 'aviso' && (
              <div className="sysnote" role="alert" data-testid={`dv-aviso-${busqueda.estado}`} style={{ ...(busqueda.estado === 'entrada_invalida' ? {} : peligro), display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 180 }}>{mensajeBusqueda(busqueda.estado)}</span>
                {(busqueda.estado === 'error_red' || busqueda.estado === 'error_servidor') && (
                  <button className="btn ghost sm" type="button" onClick={() => void buscar(busqueda.q)} data-testid="dv-reintentar">Reintentar</button>
                )}
                {busqueda.estado === 'no_autenticado' && <button className="btn ghost sm" type="button" onClick={logout} data-testid="dv-relogin">Iniciar sesión</button>}
              </div>
            )}
          </div>
        </>
      )}

      {vista === 'cartera' && (
        <>
          <div style={{ ...tenue, marginTop: -8 }} data-testid="cartera-explicacion">Clientes asignados a ti por Dirección (asignación vigente).</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <label className="searchbox op-search">
              <Search aria-hidden />
              <input value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar mi cartera" placeholder="Filtrar mi cartera por nombre…" />
            </label>
            <button className="btn ghost" type="button" onClick={() => void cargarCartera()} disabled={miCartera.fase === 'cargando'} data-testid="cartera-refrescar">Actualizar</button>
          </div>
          {miCartera.fase === 'cargando' ? (
            <Cargando etiqueta="Cargando tu cartera…" />
          ) : miCartera.fase === 'error' ? (
            <div className="sysnote" style={peligro} role="alert" data-testid="cartera-error"><span>{miCartera.mensaje}</span></div>
          ) : miCartera.filas.length === 0 ? (
            <Vacio icono="usercheck" data-testid="cartera-vacia" titulo="No tienes clientes asignados." pista="Dirección asigna la cartera. Mientras tanto puedes ubicar una cuenta en Todos." />
          ) : filasCartera.length === 0 ? (
            <Vacio icono="search" titulo={<>Ninguno coincide con “{filtro}”.</>} accion={<button type="button" className="btn ghost sm" onClick={() => setFiltro('')}>Limpiar búsqueda</button>} />
          ) : (
            <div className="card op-lista">
            {filasCartera.map((c) => (
              <button key={c.clave} type="button" className="op-fila" style={c.customer_id ? undefined : { cursor: 'default', opacity: 0.7 }} disabled={!c.customer_id}
                onClick={() => { if (c.customer_id) setAbierto({ id: c.customer_id, nombre: c.nombre }) }} data-testid="cartera-fila">
                <div className="avatar" style={{ background: avatarColor(c.nombre || '?') }}>{initials(c.nombre || '?')}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                  {!c.customer_id && <div style={tenue}>Aún sin cuenta comercial: no tiene ficha que abrir.</div>}
                </div>
                <span className="pill p-ok" style={{ whiteSpace: 'nowrap' }} data-testid="marca-asignado">Asignado</span>
              </button>
            ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
