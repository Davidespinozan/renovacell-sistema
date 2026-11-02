// TIMBRADO REAL (2 nov 2026) · vista previa y timbrado de una solicitud de factura. La compuerta es por pedido: si a un
// producto le faltan claves validadas, aquí se dice cuál y se va a Revisión fiscal; no se consume folio.
// Un resultado incierto NO se reintenta: se concilia (busca por serie+folio y, si no aparece, reenvía con la misma identidad).
import React, { useCallback, useEffect, useState } from 'react'
import { FileCheck2, RefreshCw, Settings } from 'lucide-react'
import { cfdiTimbrado as clientePorDefecto, FORMAS_TARJETA, type ClienteCfdiTimbrado, type RespuestaCfdi } from '../../data/ops/cfdiTimbrado'
import { useRoleOpcional } from '../../auth/RoleContext'
import { money } from '../../lib/format'

export function TimbrarCFDI({ docId, modo, onCambio, cliente = clientePorDefecto }: { docId: string; modo: 'timbrar' | 'conciliar'; onCambio: () => void; cliente?: ClienteCfdiTimbrado }) {
  const rol = useRoleOpcional()
  const [prev, setPrev] = useState<RespuestaCfdi | null>(null)
  const [forma, setForma] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<RespuestaCfdi | null>(null)
  const cargar = useCallback(async () => setPrev(await cliente.preparar(docId, forma)), [cliente, docId, forma])
  useEffect(() => { if (modo === 'timbrar') void cargar() }, [cargar, modo])

  const accion = async () => {
    if (busy) return
    if (modo === 'timbrar' && !window.confirm(`¿Timbrar esta factura${prev?.entorno === 'produccion' ? ' REAL ante el SAT' : ' de PRUEBA'} por ${money(prev?.resumen?.total ?? 0)}?`)) return
    setBusy(true)
    const r = modo === 'timbrar' ? await cliente.timbrar(docId, forma) : await cliente.conciliar(docId, forma)
    setBusy(false); setRes(r); onCambio()
  }

  if (res) return (
    <div className="sysnote" data-testid="cfdi-resultado" style={{ display: 'block', ...(res.status === 'timbrado' ? { background: 'var(--ok-bg)', color: 'var(--green-deep)' } : {}) }}>
      <b>{res.message ?? res.error}</b>
      {res.status === 'timbrado' && res.correo_enviado && <div>Se envió al correo de facturación del cliente.</div>}
      {res.faltantes?.length ? <ul style={{ margin: '6px 0 0 16px' }}>{res.faltantes.map((f) => <li key={f}>{f}</li>)}</ul> : null}
    </div>
  )

  if (modo === 'conciliar') return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }} data-testid="cfdi-conciliar">
      <button className="btn" type="button" disabled={busy} onClick={() => void accion()}><RefreshCw size={15} /> {busy ? 'Consultando Facturama…' : 'Conciliar con Facturama'}</button>
      <span className="ms" style={{ color: 'var(--ink-3)', maxWidth: 380, textAlign: 'right' }}>Busca la factura por su serie y folio; si existe la registra, si no, la reenvía con la misma identidad (sin duplicar).</span>
    </div>
  )

  if (!prev) return <span className="ms">Revisando la factura…</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, maxWidth: 460 }} data-testid="cfdi-timbrar">
      {prev.listo && prev.resumen ? (
        <div className="ms" style={{ textAlign: 'right' }} data-testid="cfdi-resumen">
          {prev.resumen.conceptos} concepto(s) · subtotal {money(prev.resumen.subtotal)} · IVA {money(prev.resumen.iva)} · <b>total {money(prev.resumen.total)}</b> · forma de pago {prev.resumen.forma_pago}
          <div><span className={`pill ${prev.entorno === 'produccion' ? 'p-warn' : 'p-neu'}`}>{prev.entorno === 'produccion' ? 'PRODUCCIÓN · factura real' : prev.entorno === 'sandbox' ? 'PRUEBAS · no vale ante el SAT' : 'Facturama sin conectar'}</span></div>
        </div>
      ) : (
        <div className="sysnote" style={{ display: 'block', textAlign: 'left' }} data-testid="cfdi-faltantes">
          <b>Todavía no se puede timbrar:</b>
          <ul style={{ margin: '6px 0 0 16px' }}>{(prev.faltantes ?? [prev.message ?? 'No se pudo revisar.']).map((f) => <li key={f}>{f}</li>)}</ul>
          {(prev.faltantes ?? []).some((f) => /falta|Envío/.test(f)) && rol && (
            <button className="btn ghost sm" type="button" style={{ marginTop: 8 }} onClick={() => rol.setScreen('av_fiscal')}><Settings size={14} /> Ir a Revisión fiscal</button>
          )}
        </div>
      )}
      {prev.requiere_forma_tarjeta && (
        <select className="input" value={forma ?? ''} onChange={(e) => setForma(e.target.value || null)} data-testid="cfdi-forma">
          <option value="">¿La tarjeta fue de crédito o débito?</option>
          {FORMAS_TARJETA.map((f) => <option key={f.v} value={f.v}>{f.t}</option>)}
        </select>
      )}
      {prev.listo && (
        prev.configurado
          ? <button className="btn" type="button" disabled={busy} onClick={() => void accion()} data-testid="cfdi-timbrar-btn"><FileCheck2 size={15} /> {busy ? 'Timbrando…' : 'Timbrar factura'}</button>
          : <span className="ms" style={{ color: 'var(--warn)' }}>Facturama todavía no está conectado: la factura queda lista para timbrar en cuanto se conecte.</span>
      )}
    </div>
  )
}
