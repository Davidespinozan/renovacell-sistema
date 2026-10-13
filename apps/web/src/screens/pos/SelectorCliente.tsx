// SEC-C4-B3 · Selector de cliente de la Caja para VENTAS: descubrimiento mínimo, sin precargar el directorio.
//   · Primero "Mi cartera" (asignaciones vigentes; función de cartera existente). No gasta presupuesto de búsqueda.
//   · Después, búsqueda EXPLÍCITA (Enter o botón) con el servicio seguro: nombre y ••••últimos 4, hasta 6 resultados.
//   · No busca al teclear, no reintenta sola y nunca muestra teléfono completo, correo, domicilio ni datos de Odoo.
// Elegir una cuenta entrega su identificador y su nombre para la venta. NO abre ni consulta su expediente.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Icon } from '../../app/icons'
import { BuscadorClientes, mensajeBusqueda, validarBusqueda, type ClienteBusqueda, type EstadoBusqueda } from '../../data/ops/buscarClientes'
import { ClienteCartera, type AsignacionCartera } from '../../data/ops/cartera'

export interface ClienteElegido { id: string; name: string; phone: null; mascara: string | null }

type Busqueda =
  | { fase: 'inicial' }
  | { fase: 'buscando'; q: string }
  | { fase: 'resultados'; q: string; clientes: ClienteBusqueda[] }
  | { fase: 'aviso'; q: string; estado: Exclude<EstadoBusqueda, 'ok' | 'cancelada'> }

type Cartera = { fase: 'cargando' } | { fase: 'lista'; filas: Array<{ customer_id: string; nombre: string }> } | { fase: 'error'; mensaje: string }

const carteraPorDefecto = new ClienteCartera()
const fila = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left' as const, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface, #fff)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5 }
const nota = { fontSize: 12.5, color: 'var(--ink-3)', padding: '8px 2px' }
const titulo = { fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase' as const, letterSpacing: '.04em', margin: '12px 0 6px' }

export function SelectorClienteVentas({ onPick, onClose, buscador, cartera = carteraPorDefecto, alExpirarSesion }: {
  onPick: (c: ClienteElegido | null) => void
  onClose: () => void
  /** Lo presta la Caja para conservar la caché en memoria mientras la pantalla está abierta. */
  buscador: BuscadorClientes
  cartera?: ClienteCartera
  alExpirarSesion?: () => void
}) {
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState<Busqueda>({ fase: 'inicial' })
  const [miCartera, setMiCartera] = useState<Cartera>({ fase: 'cargando' })
  const vivo = useRef(true)

  useEffect(() => {
    vivo.current = true
    void cartera.miCartera().then((r) => {
      if (!vivo.current) return
      if (!r.ok) { setMiCartera({ fase: 'error', mensaje: r.error }); return }
      // Solo cuentas comerciales (con customer_id): es lo que la venta necesita. Nombre e identificador, nada más.
      setMiCartera({ fase: 'lista', filas: r.data.filter((a: AsignacionCartera) => !!a.customer_id).map((a) => ({ customer_id: a.customer_id as string, nombre: a.nombre })) })
    })
    return () => { vivo.current = false; buscador.cancelar() }   // al cerrar: una respuesta tardía no toca nada
  }, [cartera, buscador])

  const buscar = async (q: string) => {
    if (!validarBusqueda(q).ok) { buscador.cancelar(); setBusqueda({ fase: 'aviso', q, estado: 'entrada_invalida' }); return }   // sin llamada
    setBusqueda({ fase: 'buscando', q })
    const r = await buscador.buscar(q)
    if (!vivo.current) return                                        // se cerró el selector: la respuesta tardía no toca nada
    if (r.estado === 'cancelada') {                                  // descartada: no pisa lo más reciente ni deja el botón atorado
      setBusqueda((b) => (b.fase === 'buscando' && b.q === q ? { fase: 'inicial' } : b)); return
    }
    setBusqueda(r.estado === 'ok' ? { fase: 'resultados', q, clientes: r.clientes } : { fase: 'aviso', q, estado: r.estado })
  }
  const enviar = (e: FormEvent) => { e.preventDefault(); if (busqueda.fase !== 'buscando') void buscar(texto) }
  const elegir = (id: string, nombre: string, mascara: string | null) => onPick({ id, name: nombre, phone: null, mascara })

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="selector-cliente-ventas">
        <div className="mhead">
          <div><h3>Cliente de la venta</h3><div className="ms">Opcional. Si es venta de mostrador, deja “Mostrador”.</div></div>
          <button className="mclose" type="button" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>
        <div className="mbody">
          <button type="button" onClick={() => onPick(null)} style={{ ...fila, padding: '11px 12px' }} data-testid="sc-mostrador">
            <Icon name="store" style={{ width: 15, height: 15, color: 'var(--ink-3)' }} /> Mostrador · público general
          </button>

          <div style={titulo}>Mi cartera</div>
          <div style={{ display: 'grid', gap: 4, maxHeight: '22vh', overflow: 'auto' }} data-testid="sc-cartera">
            {miCartera.fase === 'cargando' && <div style={nota}>Cargando tu cartera…</div>}
            {miCartera.fase === 'error' && <div style={nota} role="alert">{miCartera.mensaje}</div>}
            {miCartera.fase === 'lista' && miCartera.filas.length === 0 && <div style={nota}>Aún no tienes clientes asignados. Puedes buscar una cuenta abajo.</div>}
            {miCartera.fase === 'lista' && miCartera.filas.map((c) => (
              <button key={c.customer_id} type="button" style={fila} onClick={() => elegir(c.customer_id, c.nombre, null)} data-testid="sc-cartera-fila">
                <Icon name="usercheck" style={{ width: 15, height: 15, color: 'var(--green-deep)' }} />
                <span style={{ flex: 1, minWidth: 0 }}>{c.nombre}</span>
                <span className="pill p-ok" style={{ whiteSpace: 'nowrap' }}>Asignado</span>
              </button>
            ))}
          </div>

          <div style={titulo}>Buscar otra cuenta</div>
          <form onSubmit={enviar} style={{ display: 'flex', gap: 8 }} data-testid="sc-form">
            <input value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar cliente" maxLength={80}
              placeholder="Nombre (3 letras o más) o últimos 4 dígitos del teléfono"
              style={{ flex: 1, minWidth: 0, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 16, outline: 'none' }} />
            <button className="btn" type="submit" disabled={busqueda.fase === 'buscando'} data-testid="sc-buscar">Buscar</button>
          </form>

          <div style={{ display: 'grid', gap: 4, maxHeight: '30vh', overflow: 'auto', marginTop: 8 }} data-testid="sc-resultados" aria-live="polite">
            {busqueda.fase === 'inicial' && <div style={nota}>Escribe y presiona Buscar o Enter. Verás el nombre y los últimos 4 dígitos del teléfono.</div>}
            {busqueda.fase === 'buscando' && <div style={nota} data-testid="sc-buscando">Buscando «{busqueda.q.trim()}»…</div>}
            {busqueda.fase === 'resultados' && busqueda.clientes.length === 0 && <div style={nota} data-testid="sc-vacio">Ninguna cuenta coincide con «{busqueda.q.trim()}».</div>}
            {busqueda.fase === 'resultados' && busqueda.clientes.length > 0 && (
              <>
                <div style={{ ...nota, padding: '2px 2px' }}>Resultados de «{busqueda.q.trim()}». Si no aparece, escribe más del nombre.</div>
                {busqueda.clientes.map((c) => (
                  <button key={c.customer_id} type="button" style={fila} onClick={() => elegir(c.customer_id, c.nombre, c.telefono_mascara)} data-testid="sc-resultado">
                    <Icon name="usercheck" style={{ width: 15, height: 15, color: 'var(--ink-3)' }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block' }}>{c.nombre}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>{c.telefono_mascara ? `Tel. ${c.telefono_mascara}` : 'Sin teléfono registrado'}</span>
                    </span>
                  </button>
                ))}
              </>
            )}
            {busqueda.fase === 'aviso' && (
              <div className="sysnote" role="alert" data-testid={`sc-aviso-${busqueda.estado}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 180 }}>{mensajeBusqueda(busqueda.estado)}</span>
                {(busqueda.estado === 'error_red' || busqueda.estado === 'error_servidor') && (
                  <button className="btn ghost sm" type="button" onClick={() => void buscar(busqueda.q)} data-testid="sc-reintentar">Reintentar</button>
                )}
                {busqueda.estado === 'no_autenticado' && alExpirarSesion && (
                  <button className="btn ghost sm" type="button" onClick={alExpirarSesion} data-testid="sc-relogin">Iniciar sesión</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
