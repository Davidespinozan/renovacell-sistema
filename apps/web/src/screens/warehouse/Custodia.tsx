// ALMACÉN · CUSTODIA. Entregar producto a un vendedor o a un evento, recibir lo que
// regresa y asentar lo que se perdió.
//
// W2-C · Lo que esta pantalla NO hace, a propósito:
//   · entregar NO descuenta inventario ni cobra nada: el producto sigue siendo de la
//     empresa, solo cambia de manos quién responde por él. Lo único que baja es la
//     DISPONIBILIDAD (lo que el almacén puede prometer);
//   · una devolución íntegra NO vuelve a "entrar": nunca salió;
//   · un faltante NO se convierte en venta ni en deuda del vendedor: es una pérdida
//     de la empresa, con motivo y evidencia.
// Todo se escribe por comandos del servidor; aquí no hay contadores locales.
import React, { useMemo, useState } from 'react'
import { Box, Plus, Undo2, AlertTriangle, ChevronRight } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useProducts } from '../../data/hooks/useProducts'
import { useUsers } from '../../data/hooks/useUsers'
import { useCustodies, useCustodyStock, useDisponible } from '../../data/hooks/useCustody'
import { lotesDisponibles, saldoDe } from '../../data/store/custodyStore'
import { useOpId } from '../../data/hooks/useOpId'
import {
  abrirCustodia, entregarCustodia, devolverDeCustodia, registrarPerdidaCustodia,
  INSPECCIONES, PERDIDAS, type Custody, type Inspeccion, type PerdidaKind,
} from '../../data/ops/custody'
import { CUSTODY_INVENTORY_DISABLED, CUSTODY_DISABLED_MSG } from '../../data/ops/w1Flags'
import { AMBIGUO_MSG } from '../../data/ops/w1Command'

const fld: React.CSSProperties = {
  padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 12,
  fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
  textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 12, marginBottom: 4,
}

export function Custodia() {
  const { data: custodias, loading } = useCustodies()
  const { data: stock } = useCustodyStock()
  const { data: disp } = useDisponible()
  const { data: products } = useProducts()
  const { data: users } = useUsers({ staffOnly: true })
  const [abierta, setAbierta] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products])
  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>, [users])
  const vivas = custodias.filter((c) => c.status === 'abierta')
  const flash = (t: string) => { setMsg(t); window.setTimeout(() => setMsg(''), 3500) }

  const etiqueta = (c: Custody): string =>
    c.kind === 'evento' ? `Evento · ${c.event_name ?? 'sin nombre'}`
      : `Consignación · ${c.holder_user_id ? (userName[c.holder_user_id] ?? 'vendedor') : 'tercero'}`

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Custodia de producto">
        Producto de la empresa en manos de un vendedor o de un evento. Entregarlo <b>no</b> lo vende
        ni lo descuenta del inventario: solo deja de estar disponible en el almacén hasta que
        vuelva, se venda o se dé de baja.
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

      <AbrirCustodia users={users} onDone={(t) => flash(t)} />

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Box size={18} style={{ color: 'var(--green-deep)' }} />
          <div className="eyebrow" style={{ margin: 0 }}>Custodias abiertas</div>
          <span className="pill p-neu" style={{ marginLeft: 'auto' }}>{vivas.length}</span>
        </div>
        <div style={{ padding: '10px 14px 14px' }}>
          {loading ? <div style={{ color: 'var(--ink-3)' }}>Cargando…</div>
            : vivas.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>No hay custodias abiertas.</div>
              : vivas.map((c) => {
                const saldo = saldoDe(stock, c.id)
                const unidades = saldo.reduce((s, x) => s + x.en_poder, 0)
                const open = abierta === c.id
                return (
                  <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}>
                    <button type="button" onClick={() => setAbierta(open ? null : c.id)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: 'var(--hueso, #f8f9f6)', border: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                      <ChevronRight size={15} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
                      <b style={{ fontSize: 13.5 }}>{etiqueta(c)}</b>
                      <span className="pill p-neu" style={{ fontSize: 10.5 }}>{unidades} u en poder</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>desde {fmtDate(c.opened_at)}</span>
                    </button>
                    {open && (
                      <div style={{ padding: 13 }}>
                        {saldo.length === 0
                          ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Sin producto en poder ahora mismo.</div>
                          : (
                            <table className="tbl-cards">
                              <thead><tr><th>Producto</th><th>Entregado</th><th>Vendido</th><th>Devuelto</th><th>Perdido</th><th>En poder</th></tr></thead>
                              <tbody>
                                {saldo.map((s) => (
                                  <tr key={s.lot_id}>
                                    <td data-label="Producto">{prodName[s.product_id] ?? 'Producto'}</td>
                                    <td data-label="Entregado" className="mono">{s.entregado}</td>
                                    <td data-label="Vendido" className="mono">{s.vendido}</td>
                                    <td data-label="Devuelto" className="mono">{s.devuelto}</td>
                                    <td data-label="Perdido" className="mono">{s.perdido}</td>
                                    <td data-label="En poder" className="mono"><b>{s.en_poder}</b></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        <div className="grid two" style={{ marginTop: 12, alignItems: 'start' }}>
                          <Entregar custody={c} disp={disp} products={products} onDone={flash} />
                          <Recibir custody={c} saldo={saldo} prodName={prodName} onDone={flash} />
                        </div>
                        <Perdida custody={c} saldo={saldo} prodName={prodName} onDone={flash} />
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

// ── Abrir una custodia para un vendedor ─────────────────────────────────────────
function AbrirCustodia({ users, onDone }: { users: { id: string; name: string }[]; onDone: (t: string) => void }) {
  const { opId, renew } = useOpId()
  const [abierto, setAbierto] = useState(false)
  const [holder, setHolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const abrir = async () => {
    if (!holder || busy) return
    setBusy(true); setErr('')
    const r = await abrirCustodia(opId, { kind: 'vendedor', holderKind: 'staff', holderUserId: holder })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo abrir la custodia.')); return }
    renew(); setAbierto(false); setHolder('')
    onDone('Custodia abierta. Ya le puedes entregar producto.')
  }

  if (!abierto) {
    return (
      <div><button className="btn ghost sm" type="button" onClick={() => setAbierto(true)}><Plus size={14} /> Abrir custodia de un vendedor</button></div>
    )
  }
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>Nueva custodia de vendedor</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 8 }}>
        Un vendedor tiene UNA custodia abierta: su inventario en consignación. Los eventos se
        abren desde la pantalla de Eventos.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...fld, minWidth: 220 }} value={holder} onChange={(e) => setHolder(e.target.value)}>
          <option value="">Elige al vendedor…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button className="btn sm" type="button" disabled={!holder || busy} onClick={() => void abrir()}>{busy ? 'Abriendo…' : 'Abrir'}</button>
        <button className="btn ghost sm" type="button" onClick={() => { setAbierto(false); setErr('') }}>Cancelar</button>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
    </div>
  )
}

// ── Entregar producto ───────────────────────────────────────────────────────────
function Entregar({ custody, disp, products, onDone }: {
  custody: Custody
  disp: ReturnType<typeof useDisponible>['data']
  products: { id: string; name: string }[]
  onDone: (t: string) => void
}) {
  const { opId, renew } = useOpId()
  const [productId, setProductId] = useState('')
  const [lotId, setLotId] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Solo lotes con DISPONIBILIDAD real (no lo que ya trae otro vendedor) y vigentes.
  const lotes = useMemo(() => (productId ? lotesDisponibles(disp, productId) : []), [disp, productId])
  const lote = lotes.find((l) => l.lot_id === lotId)
  const n = Math.max(0, Number(qty) || 0)
  const valido = !!lote && n > 0 && n <= (lote?.disponible ?? 0)

  const entregar = async () => {
    if (!valido || busy) return
    setBusy(true); setErr('')
    const r = await entregarCustodia(opId, { custodyId: custody.id, lines: [{ lot_id: lotId, qty: n }] })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo entregar.')); return }
    renew(); setQty(''); setLotId('')
    onDone(`Entregadas ${n} unidades. El inventario NO se descontó: dejó de estar disponible.`)
  }

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>Entregar producto</div>
      <label style={lbl}>Producto</label>
      <select style={{ ...fld, width: '100%' }} value={productId} onChange={(e) => { setProductId(e.target.value); setLotId('') }}>
        <option value="">Elige…</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <label style={lbl}>Lote <span style={{ textTransform: 'none', opacity: .7 }}>(solo los que tienen disponibilidad)</span></label>
      <select style={{ ...fld, width: '100%' }} value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={!productId}>
        <option value="">Elige…</option>
        {lotes.map((l) => (
          <option key={l.lot_id} value={l.lot_id}>
            {l.lot_code} · disponible {l.disponible}{l.en_custodia > 0 ? ` (${l.en_custodia} en custodia)` : ''}{l.expiry_date ? ` · vence ${l.expiry_date}` : ''}
          </option>
        ))}
      </select>
      {productId && lotes.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 6 }}>
          No hay lotes con disponibilidad de este producto (puede estar todo en custodia o vencido).
        </div>
      )}
      <label style={lbl}>Cantidad</label>
      <input type="number" min={1} max={lote?.disponible ?? undefined} style={{ ...fld, width: 120 }} value={qty} onChange={(e) => setQty(e.target.value)} />
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 12 }}>
        <button className="btn sm" type="button" disabled={!valido || busy} style={!valido || busy ? { opacity: .5, cursor: 'not-allowed' } : undefined} onClick={() => void entregar()}>
          <Plus size={14} /> {busy ? 'Entregando…' : 'Entregar'}
        </button>
      </div>
    </div>
  )
}

// ── Recibir devolución ──────────────────────────────────────────────────────────
function Recibir({ custody, saldo, prodName, onDone }: {
  custody: Custody
  saldo: { lot_id: string; product_id: string; en_poder: number }[]
  prodName: Record<string, string>
  onDone: (t: string) => void
}) {
  const { opId, renew } = useOpId()
  const [lotId, setLotId] = useState('')
  const [qty, setQty] = useState('')
  const [insp, setInsp] = useState<Inspeccion>('ok')
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const fila = saldo.find((s) => s.lot_id === lotId)
  const n = Math.max(0, Number(qty) || 0)
  const valido = !!fila && n > 0 && n <= (fila?.en_poder ?? 0) && (insp === 'ok' || motivo.trim().length >= 3)

  const recibir = async () => {
    if (!valido || busy) return
    setBusy(true); setErr('')
    const r = await devolverDeCustodia(opId, {
      custodyId: custody.id,
      lines: [{ lot_id: lotId, qty: n, inspection: insp }],
      motivo: motivo.trim() || null,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo registrar la devolución.')); return }
    renew(); setQty(''); setMotivo(''); setLotId('')
    const d = r.data
    onDone(d.dado_de_baja > 0
      ? `Recibido. ${d.devuelto_disponible} volvieron a estar disponibles y ${d.dado_de_baja} se dieron de baja.`
      : `Recibidas ${d.devuelto_disponible} unidades: vuelven a estar disponibles (el inventario no cambió).`)
  }

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>Recibir devolución</div>
      <label style={lbl}>Qué regresa</label>
      <select style={{ ...fld, width: '100%' }} value={lotId} onChange={(e) => setLotId(e.target.value)}>
        <option value="">Elige…</option>
        {saldo.map((s) => <option key={s.lot_id} value={s.lot_id}>{prodName[s.product_id] ?? 'Producto'} · en poder {s.en_poder}</option>)}
      </select>
      <label style={lbl}>Cantidad</label>
      <input type="number" min={1} max={fila?.en_poder ?? undefined} style={{ ...fld, width: 120 }} value={qty} onChange={(e) => setQty(e.target.value)} />
      <label style={lbl}>¿Cómo llegó?</label>
      <select style={{ ...fld, width: '100%' }} value={insp} onChange={(e) => setInsp(e.target.value as Inspeccion)}>
        {INSPECCIONES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
      </select>
      {insp !== 'ok' && (
        <>
          <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 8 }}>
            No vuelve a venta: se da de baja del inventario en este mismo acto.
          </div>
          <label style={lbl}>Motivo</label>
          <input style={{ ...fld, width: '100%' }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿qué le pasó?" />
        </>
      )}
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 12 }}>
        <button className="btn sm" type="button" disabled={!valido || busy} style={!valido || busy ? { opacity: .5, cursor: 'not-allowed' } : undefined} onClick={() => void recibir()}>
          <Undo2 size={14} /> {busy ? 'Registrando…' : 'Recibir'}
        </button>
      </div>
    </div>
  )
}

// ── Registrar pérdida ───────────────────────────────────────────────────────────
function Perdida({ custody, saldo, prodName, onDone }: {
  custody: Custody
  saldo: { lot_id: string; product_id: string; en_poder: number }[]
  prodName: Record<string, string>
  onDone: (t: string) => void
}) {
  const { opId, renew } = useOpId()
  const [abierto, setAbierto] = useState(false)
  const [lotId, setLotId] = useState('')
  const [qty, setQty] = useState('')
  const [kind, setKind] = useState<PerdidaKind>('faltante')
  const [motivo, setMotivo] = useState('')
  const [evidencia, setEvidencia] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const fila = saldo.find((s) => s.lot_id === lotId)
  const n = Math.max(0, Number(qty) || 0)
  const valido = !!fila && n > 0 && n <= (fila?.en_poder ?? 0) && motivo.trim().length >= 3

  const registrar = async () => {
    if (!valido || busy) return
    setBusy(true); setErr('')
    const r = await registrarPerdidaCustodia(opId, {
      custodyId: custody.id, kind, lines: [{ lot_id: lotId, qty: n }],
      motivo: motivo.trim(), evidencia: evidencia.trim() || null,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo registrar la pérdida.')); return }
    renew(); setAbierto(false); setQty(''); setMotivo(''); setEvidencia(''); setLotId('')
    onDone(`Pérdida registrada: ${n} unidades dadas de baja. Es una pérdida de la empresa, no una deuda del vendedor.`)
  }

  if (saldo.length === 0) return null
  if (!abierto) {
    return (
      <div style={{ marginTop: 12 }}>
        <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => setAbierto(true)}>
          <AlertTriangle size={14} /> Registrar faltante, daño o caducidad
        </button>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 12, padding: 12, background: 'var(--hueso, #f8f9f6)' }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>Pérdida de producto en custodia</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 6 }}>
        Da de baja el producto del inventario con motivo y evidencia. <b>No</b> se registra como venta
        ni genera deuda del vendedor; si después Dirección decide recuperar la pérdida, es un proceso
        aparte.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={lbl}>Qué se perdió</label>
          <select style={{ ...fld, minWidth: 200 }} value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">Elige…</option>
            {saldo.map((s) => <option key={s.lot_id} value={s.lot_id}>{prodName[s.product_id] ?? 'Producto'} · en poder {s.en_poder}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Cantidad</label>
          <input type="number" min={1} max={fila?.en_poder ?? undefined} style={{ ...fld, width: 100 }} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Causa</label>
          <select style={{ ...fld, minWidth: 150 }} value={kind} onChange={(e) => setKind(e.target.value as PerdidaKind)}>
            {PERDIDAS.map((p) => <option key={p.value} value={p.value}>{p.label} — {p.hint}</option>)}
          </select>
        </div>
      </div>
      <label style={lbl}>Motivo</label>
      <input style={{ ...fld, width: '100%' }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="qué pasó, con detalle" />
      <label style={lbl}>Evidencia <span style={{ textTransform: 'none', opacity: .7 }}>(acta, folio de conteo… opcional)</span></label>
      <input style={{ ...fld, width: '100%' }} value={evidencia} onChange={(e) => setEvidencia(e.target.value)} />
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button className="btn ghost sm" type="button" onClick={() => { setAbierto(false); setErr('') }}>Cancelar</button>
        <button className="btn sm" type="button" disabled={!valido || busy} style={!valido || busy ? { opacity: .5, cursor: 'not-allowed' } : undefined} onClick={() => void registrar()}>
          {busy ? 'Registrando…' : 'Registrar pérdida'}
        </button>
      </div>
    </div>
  )
}
