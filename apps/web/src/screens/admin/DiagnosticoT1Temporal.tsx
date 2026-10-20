// TEMPORAL · Diagnóstico T1 sandbox (retirar tras la comprobación). Solo Dirección. Una lectura de la billetera de T1 por el
// servidor (acción t1_diagnostico_wallet): el navegador no manda credenciales ni seller_id; recibe un resumen mínimo.
import React, { useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'

export interface ResumenWallet { http: number; success: boolean | null; seller_coincide: boolean | null; current_balance: number | null; error: string | null; errorType: string | null }
type Invocar = () => Promise<{ ok: true; data: ResumenWallet } | { ok: false; error: string }>
async function invocarPorDefecto(): ReturnType<Invocar> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  try {
    const { data, error } = await supabase.functions.invoke('shipping', { body: { action: 't1_diagnostico_wallet' } })
    if (error) { let msg = 'No se pudo ejecutar el diagnóstico.'; try { const b = await (error as { context?: Response }).context?.clone().json(); if (b?.message || b?.error) msg = String(b.message ?? b.error) } catch { /* sin detalle */ } return { ok: false, error: msg } }
    return { ok: true, data: data as ResumenWallet }
  } catch { return { ok: false, error: 'No hay conexión con el servidor.' } }
}

export function DiagnosticoT1Temporal({ invocar = invocarPorDefecto }: { invocar?: Invocar }) {
  const [res, setRes] = useState<ResumenWallet | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const correr = async () => { setOcupado(true); setErr(null); setRes(null); const r = await invocar(); setOcupado(false); if (r.ok) setRes(r.data); else setErr(r.error) }
  return (
    <div className="card" data-testid="diag-t1" style={{ borderStyle: 'dashed' }}>
      <h4 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>Diagnóstico T1 (temporal, sandbox)</h4>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 10 }}>Una sola consulta de lectura a la billetera de T1 para saber si la llave y el identificador de comercio son reconocidos. No cotiza ni genera guías. Esta tarjeta se retira después.</div>
      <button type="button" className="btn ghost" onClick={correr} disabled={ocupado} data-testid="diag-t1-correr">{ocupado ? 'Consultando…' : 'Consultar billetera T1 (una vez)'}</button>
      {err && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}
      {res && (
        <dl style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 }} data-testid="diag-t1-resultado">
          <dt>HTTP</dt><dd>{res.http}</dd>
          <dt>success</dt><dd>{res.success == null ? '—' : String(res.success)}</dd>
          <dt>seller_id coincide</dt><dd>{res.seller_coincide == null ? 'no viene en la respuesta' : res.seller_coincide ? 'sí' : 'NO'}</dd>
          <dt>Saldo actual</dt><dd>{res.current_balance == null ? '—' : res.current_balance}</dd>
          {res.errorType && <><dt>Tipo de error</dt><dd>{res.errorType}</dd></>}
          {res.error && <><dt>Error</dt><dd>{res.error}</dd></>}
        </dl>
      )}
    </div>
  )
}
