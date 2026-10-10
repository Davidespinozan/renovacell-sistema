// DIRECCIÓN · CUSTODIAS. La foto económica de lo que está en la calle, el cierre con
// liquidación y la conciliación.
//
// W2-C · La liquidación es un ESTADO, no un evento de dinero: el dinero ya nació en
// cada venta por la ruta de W2. Cerrar exige que no quede nada en poder del tenedor:
// todo lo entregado tiene que estar vendido, devuelto o dado de baja.
import React, { useEffect, useMemo, useState } from 'react'
import { Box, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useUsers } from '../../data/hooks/useUsers'
import { useCustodies, useCustodyStock } from '../../data/hooks/useCustody'
import { saldoDe } from '../../data/store/custodyStore'
import { useProducts } from '../../data/hooks/useProducts'
import { useOpId } from '../../data/hooks/useOpId'
import { cerrarCustodia, liquidacionDe, type Custody, type CustodyLiquidacion } from '../../data/ops/custody'
import { AMBIGUO_MSG } from '../../data/ops/w1Command'
import { supabase, hasSupabase } from '../../lib/supabase'

interface Hallazgo { check_id: string; severidad: string; entidad: string; entidad_id: string | null; detalle: string | null }

export function Custodias() {
  const { data: custodias, loading, reload } = useCustodies()
  const { data: stock } = useCustodyStock()
  const { data: products } = useProducts()
  const { data: users } = useUsers({ staffOnly: true })
  const [liq, setLiq] = useState<Record<string, CustodyLiquidacion>>({})
  const [hallazgos, setHallazgos] = useState<Hallazgo[] | null>(null)
  const [conciliando, setConciliando] = useState(false)

  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products])
  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>, [users])
  const etiqueta = (c: Custody): string =>
    c.kind === 'evento' ? `Evento · ${c.event_name ?? 'sin nombre'}`
      : `Consignación · ${c.holder_user_id ? (userName[c.holder_user_id] ?? 'vendedor') : 'tercero'}`

  // La liquidación la calcula el servidor (v_custody_liquidacion); aquí solo se muestra.
  useEffect(() => {
    let vivo = true
    void Promise.all(custodias.map(async (c) => [c.id, await liquidacionDe(c.id)] as const)).then((rs) => {
      if (!vivo) return
      const m: Record<string, CustodyLiquidacion> = {}
      rs.forEach(([id, l]) => { if (l) m[id] = l })
      setLiq(m)
    })
    return () => { vivo = false }
  }, [custodias, stock])

  const conciliar = async () => {
    if (!hasSupabase || conciliando) return
    setConciliando(true)
    const { data, error } = await supabase.rpc('conciliar_custodia')
    setConciliando(false)
    setHallazgos(error ? [] : ((data ?? []) as unknown as Hallazgo[]))
  }

  const errores = (hallazgos ?? []).filter((h) => h.severidad === 'error')
  const avisos = (hallazgos ?? []).filter((h) => h.severidad !== 'error')

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Custodias">
        Producto de la empresa en manos de vendedores y eventos. Entregarlo no genera ingreso ni
        deuda: la obligación económica nace cuando se vende. Aquí se cierra y se liquida.
      </PageHead>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Box size={18} style={{ color: 'var(--green-deep)' }} />
          <div className="eyebrow" style={{ margin: 0 }}>Todas las custodias</div>
          <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => void reload()}>
            <RefreshCw size={13} /> Actualizar
          </button>
        </div>
        <div style={{ padding: '10px 14px 14px' }}>
          {loading ? <div style={{ color: 'var(--ink-3)' }}>Cargando…</div>
            : custodias.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>Todavía no hay custodias.</div>
              : (
                <table className="tbl-cards">
                  <thead>
                    <tr><th>Custodia</th><th>Estado</th><th>Entregado</th><th>Vendido</th><th>Devuelto</th><th>Perdido</th><th>En poder</th><th>Vendido $</th><th>Cobrado $</th><th></th></tr>
                  </thead>
                  <tbody>
                    {custodias.map((c) => {
                      const l = liq[c.id]
                      const enPoder = l?.unidades_en_poder ?? 0
                      return (
                        <tr key={c.id}>
                          <td data-label="Custodia">
                            {etiqueta(c)}
                            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                              abierta {fmtDate(c.opened_at)}{c.closed_at ? ` · cerrada ${fmtDate(c.closed_at)}` : ''}
                            </div>
                          </td>
                          <td data-label="Estado">
                            <span className={'pill ' + (c.status === 'abierta' ? 'p-warn' : 'p-neu')}>{c.status}</span>
                          </td>
                          <td data-label="Entregado" className="mono">{l?.unidades_entregadas ?? 0}</td>
                          <td data-label="Vendido" className="mono">{l?.unidades_vendidas ?? 0}</td>
                          <td data-label="Devuelto" className="mono">{l?.unidades_devueltas ?? 0}</td>
                          <td data-label="Perdido" className="mono">{l?.unidades_perdidas ?? 0}</td>
                          <td data-label="En poder" className="mono"><b>{enPoder}</b></td>
                          <td data-label="Vendido $" className="mono">{money(l?.importe_vendido ?? 0)}</td>
                          <td data-label="Cobrado $" className="mono">{money(l?.cobrado ?? 0)}</td>
                          <td data-label="" style={{ textAlign: 'right' }}>
                            {c.status === 'abierta' && (
                              <CerrarCustodia custody={c} enPoder={enPoder} saldo={saldoDe(stock, c.id)} prodName={prodName} onDone={() => void reload()} />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ShieldCheck size={18} style={{ color: 'var(--green-deep)' }} />
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Conciliación de custodia</h3>
          <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} disabled={conciliando} onClick={() => void conciliar()}>
            {conciliando ? 'Revisando…' : 'Revisar ahora'}
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
          Comprueba que el libro cuadre con el inventario y con el dinero: nada en poder por debajo de
          cero, nada en custodia por encima de lo propio, cada venta con su salida y su cobro, cada
          pérdida con su baja, y aviso de lo que está por caducar en la calle.
        </div>
        {hallazgos != null && (
          errores.length === 0 && avisos.length === 0 ? (
            <div className="sysnote" style={{ marginTop: 12, background: 'var(--ok-bg)', borderColor: 'var(--ok-line)', color: 'var(--green-deep)' }}>
              <span>Todo cuadra: sin hallazgos.</span>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              {[...errores, ...avisos].map((h, i) => (
                <div key={i} className="sysnote" style={{
                  marginBottom: 8,
                  ...(h.severidad === 'error'
                    ? { background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' }
                    : { background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }),
                }}>
                  <AlertTriangle size={15} />
                  <span><b>{h.check_id}</b> · {h.entidad} {h.detalle ? `· ${h.detalle}` : ''}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Cerrar y liquidar ───────────────────────────────────────────────────────────
function CerrarCustodia({ custody, enPoder, saldo, prodName, onDone }: {
  custody: Custody
  enPoder: number
  saldo: { product_id: string; en_poder: number }[]
  prodName: Record<string, string>
  onDone: () => void
}) {
  const { opId, renew } = useOpId()
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const cerrar = async () => {
    if (busy || motivo.trim().length < 3) return
    setBusy(true); setErr('')
    const r = await cerrarCustodia(opId, { custodyId: custody.id, motivo: motivo.trim() })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo cerrar.')); return }
    renew(); setAbierto(false); setMotivo(''); onDone()
  }

  if (enPoder > 0) {
    return (
      <span className="ms" style={{ color: 'var(--ink-3)', fontSize: 11.5 }} title={saldo.map((s) => `${prodName[s.product_id] ?? 'Producto'}: ${s.en_poder}`).join(' · ')}>
        No se puede cerrar: {enPoder} u en la calle
      </span>
    )
  }
  if (!abierto) {
    return <button className="btn ghost sm" type="button" onClick={() => setAbierto(true)}>Cerrar y liquidar</button>
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del cierre"
        style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13, minWidth: 160 }} />
      <button className="btn sm" type="button" disabled={busy || motivo.trim().length < 3} onClick={() => void cerrar()}>{busy ? 'Cerrando…' : 'Cerrar'}</button>
      <button className="btn ghost sm" type="button" onClick={() => { setAbierto(false); setErr('') }}>Cancelar</button>
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', width: '100%', textAlign: 'right' }}>{err}</div>}
    </div>
  )
}
