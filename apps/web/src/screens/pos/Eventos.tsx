// EVENTOS (expos y congresos). Un evento es una CUSTODIA: producto de la empresa en el
// stand, a nombre de un responsable.
//
// W2-C · Quién hace qué, a propósito:
//   · aquí se ABRE el evento y se consulta su saldo;
//   · Almacén ENTREGA el producto al stand y RECIBE lo que sobra (pantalla Custodia);
//   · se VENDE en Punto de venta eligiendo el evento — misma ruta que el mostrador;
//   · Dirección CIERRA y liquida.
// No hay contadores en esta pantalla: el saldo sale del libro del servidor.
import React, { useMemo, useState } from 'react'
import { Store, Plus, AlertTriangle, ChevronRight } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useProducts } from '../../data/hooks/useProducts'
import { useUsers } from '../../data/hooks/useUsers'
import { useRole } from '../../auth/RoleContext'
import { useCustodies, useCustodyStock } from '../../data/hooks/useCustody'
import { saldoDe } from '../../data/store/custodyStore'
import { useOpId } from '../../data/hooks/useOpId'
import { abrirCustodia } from '../../data/ops/custody'
import { AMBIGUO_MSG } from '../../data/ops/w1Command'
import { CUSTODY_INVENTORY_DISABLED, CUSTODY_DISABLED_MSG } from '../../data/ops/w1Flags'
import { currentUserId } from '../../lib/supabase'

const fld: React.CSSProperties = {
  padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10,
  fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: 'var(--cp-surface)',
}

export function Eventos() {
  const { data: custodias, loading } = useCustodies()
  const { data: stock } = useCustodyStock()
  const { data: products } = useProducts()
  const { data: users } = useUsers({ staffOnly: true })
  const { setScreen, user } = useRole()
  const [nuevo, setNuevo] = useState(false)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products])
  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>, [users])
  const eventos = custodias.filter((c) => c.kind === 'evento')
  const flash = (t: string) => { setMsg(t); window.setTimeout(() => setMsg(''), 3500) }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Eventos">
        El inventario del stand es producto de la empresa en custodia del responsable del evento.
        Almacén lo entrega y lo recibe; se vende en Punto de venta eligiendo el evento; Dirección
        cierra y liquida al terminar.
      </PageHead>

      {CUSTODY_INVENTORY_DISABLED && (
        <div className="sysnote" role="status" style={{ background: 'var(--warn-bg, #FFF7E6)', borderColor: '#EEDDB6' }}>
          <AlertTriangle size={16} /><span>{CUSTODY_DISABLED_MSG}</span>
        </div>
      )}
      {msg && (
        <div className="sysnote" role="status" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)', color: 'var(--green-deep)' }}>
          <span>{msg}</span>
        </div>
      )}

      {nuevo
        ? <NuevoEvento users={users} yo={currentUserId()} miNombre={user?.name ?? ''} onClose={() => setNuevo(false)} onDone={(t) => { setNuevo(false); flash(t) }} />
        : <div><button className="btn" type="button" onClick={() => setNuevo(true)}><Plus size={15} /> Nuevo evento</button></div>}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Store size={18} style={{ color: 'var(--green-deep)' }} />
          <div className="eyebrow" style={{ margin: 0 }}>Eventos</div>
          <span className="pill p-neu" style={{ marginLeft: 'auto' }}>{eventos.length}</span>
        </div>
        <div style={{ padding: '10px 14px 14px' }}>
          {loading ? <div style={{ color: 'var(--ink-3)' }}>Cargando…</div>
            : eventos.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>Todavía no hay eventos.</div>
              : eventos.map((c) => {
                const saldo = saldoDe(stock, c.id)
                const unidades = saldo.reduce((s, x) => s + x.en_poder, 0)
                const open = abierta === c.id
                return (
                  <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}>
                    <button type="button" onClick={() => setAbierta(open ? null : c.id)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: 'var(--hueso, #f8f9f6)', border: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                      <ChevronRight size={15} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
                      <b style={{ fontSize: 13.5 }}>{c.event_name}</b>
                      <span className={'pill ' + (c.status === 'abierta' ? 'p-warn' : 'p-neu')} style={{ fontSize: 10.5 }}>{c.status}</span>
                      <span className="pill p-neu" style={{ fontSize: 10.5 }}>{unidades} u en el stand</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
                        {c.event_venue ? `${c.event_venue} · ` : ''}{c.event_date ? fmtDate(c.event_date) : fmtDate(c.opened_at)}
                      </span>
                    </button>
                    {open && (
                      <div style={{ padding: 13 }}>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 8 }}>
                          Responsable: <b>{c.holder_user_id ? (userName[c.holder_user_id] ?? 'staff') : 'tercero'}</b>
                          {c.closed_at && <> · cerrado el {fmtDate(c.closed_at)}{c.close_reason ? ` (${c.close_reason})` : ''}</>}
                        </div>
                        {saldo.length === 0 ? (
                          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                            Sin producto en el stand. Almacén lo entrega desde <b>Consignación / Custodia</b>.
                          </div>
                        ) : (
                          <table className="tbl-cards">
                            <thead><tr><th>Producto</th><th>Entregado</th><th>Vendido</th><th>Devuelto</th><th>Perdido</th><th>En el stand</th></tr></thead>
                            <tbody>
                              {saldo.map((s) => (
                                <tr key={s.lot_id}>
                                  <td data-label="Producto">{prodName[s.product_id] ?? 'Producto'}</td>
                                  <td data-label="Entregado" className="mono">{s.entregado}</td>
                                  <td data-label="Vendido" className="mono">{s.vendido}</td>
                                  <td data-label="Devuelto" className="mono">{s.devuelto}</td>
                                  <td data-label="Perdido" className="mono">{s.perdido}</td>
                                  <td data-label="En el stand" className="mono"><b>{s.en_poder}</b></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {c.status === 'abierta' && c.holder_user_id === currentUserId() && unidades > 0 && (
                          <button className="btn" type="button" style={{ marginTop: 12 }} onClick={() => setScreen('caja')}>
                            <Store size={15} /> Vender en el stand
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
        </div>
      </div>
    </div>
  )
}

function NuevoEvento({ users, yo, miNombre, onClose, onDone }: {
  users: { id: string; name: string }[]
  yo: string | null
  miNombre: string
  onClose: () => void
  onDone: (t: string) => void
}) {
  const { opId, renew } = useOpId()
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [date, setDate] = useState('')
  const [holder, setHolder] = useState(yo ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const valido = name.trim().length >= 3 && !!holder

  const crear = async () => {
    if (!valido || busy) return
    setBusy(true); setErr('')
    const r = await abrirCustodia(opId, {
      kind: 'evento', holderKind: 'staff', holderUserId: holder,
      eventName: name.trim(), eventVenue: venue.trim() || null, eventDate: date || null,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo crear el evento.')); return }
    renew()
    onDone('Evento creado. Pide a Almacén que entregue el producto al stand.')
  }

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 8 }}>Nuevo evento</div>
      <div className="form-grid-2">
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Nombre</label>
          <input style={{ ...fld, width: '100%', marginTop: 5 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Congreso Nacional 2026" />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Lugar</label>
          <input style={{ ...fld, width: '100%', marginTop: 5 }} value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Expo Guadalajara" />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Fecha</label>
          <input type="date" style={{ ...fld, width: '100%', marginTop: 5 }} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Responsable del stand</label>
          <select style={{ ...fld, width: '100%', marginTop: 5 }} value={holder} onChange={(e) => setHolder(e.target.value)}>
            {yo && <option value={yo}>{miNombre || 'Yo'}</option>}
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>
        El responsable queda registrado como tenedor: es quien responde por el producto del stand.
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
        <button className="btn" type="button" disabled={!valido || busy} style={!valido || busy ? { opacity: .5, cursor: 'not-allowed' } : undefined} onClick={() => void crear()}>
          {busy ? 'Creando…' : 'Crear evento'}
        </button>
      </div>
    </div>
  )
}
