// DIRECCIÓN/FACTURACIÓN · Cola "Pagos por validar" — transferencias informadas por los
// clientes que esperan revisión humana. Antes esto vivía escondido dentro de Facturación;
// aquí es su propia bandeja: quién pagó, a qué cuenta, cuánto se espera, el comprobante y
// las acciones Confirmar / Rechazar (con motivo). El pago SOLO se marca 'paid' al confirmar,
// vía la RPC atómica review_transfer_payment (autoridad server-side).
import React, { useMemo, useState } from 'react'
import { BadgeDollarSign, Clock, Landmark, FileImage, Check, X } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useBankAccounts } from '../../data/hooks/useBankAccounts'
import { reviewTransfer } from '../../data/store/ordersStore'
import { signedProofUrl } from '../../lib/uploads'
import type { Profile } from '../../data/types'

// Transferencia PENDIENTE de revisar: reportada y aún sin pago confirmado. Un reporte
// rechazado deja reported=false (sale de la cola hasta que el cliente vuelva a reportar).
interface TransferInfo {
  reported?: boolean; at?: string; reference?: string; proof_path?: string | null
  bank_account_id?: string | null
  review?: { status?: string; reviewed_at?: string; reviewed_by?: string; reason?: string }
}
const transferOf = (o: OrderWithItems): TransferInfo | null => {
  const t = (o.shipping_meta as { transfer?: TransferInfo } | null)?.transfer
  return t?.reported ? t : null
}
const last4 = (s?: string | null): string => { const d = (s ?? '').replace(/\D/g, ''); return d ? d.slice(-4) : '' }

export function PagosPorValidar() {
  const { data: orders } = useAllOrders()
  const { data: doctors } = useDoctors()
  const { data: banks } = useBankAccounts()
  const [busy, setBusy] = useState<string | null>(null)

  const doctorsById = useMemo(() => Object.fromEntries(doctors.map((d) => [d.id, d])) as Record<string, Profile | undefined>, [doctors])
  const banksById = useMemo(() => Object.fromEntries(banks.map((b) => [b.id, b])), [banks])
  const clientName = (o: OrderWithItems) => (o.doctor_id ? doctorsById[o.doctor_id]?.full_name ?? 'Doctor' : 'Mostrador (POS)')
  const bankLabel = (t: TransferInfo): string => {
    const b = t.bank_account_id ? banksById[t.bank_account_id] : null
    if (!b) return 'Cuenta no indicada'
    const tail = last4(b.account_number) || last4(b.clabe)
    return `${b.bank_name}${tail ? ` ···· ${tail}` : ''}`
  }

  const rows = useMemo(() => {
    return orders
      .filter((o) => o.status !== 'cancelled' && o.payment_status !== 'paid')
      .map((o) => ({ o, t: transferOf(o) }))
      .filter((r): r is { o: OrderWithItems; t: TransferInfo } => r.t != null)
      .sort((a, b) => ((a.t.at ?? a.o.created_at) < (b.t.at ?? b.o.created_at) ? 1 : -1))
  }, [orders])

  const verProof = async (path: string) => { const u = await signedProofUrl(path); if (u) window.open(u, '_blank') }

  const confirmar = async (o: OrderWithItems) => {
    if (busy) return
    setBusy(o.id)
    try {
      const r = await reviewTransfer(o.id, 'confirm')
      if (!r.ok) window.alert(r.error ?? 'No se pudo confirmar el pago.')
    } finally { setBusy(null) }
  }
  const rechazar = async (o: OrderWithItems) => {
    if (busy) return
    const motivo = window.prompt('Motivo del rechazo (se avisa al cliente para que reintente). No marca pagado ni cancela el pedido.')
    if (motivo == null) return
    if (!motivo.trim()) { window.alert('El rechazo necesita un motivo.'); return }
    setBusy(o.id)
    try {
      const r = await reviewTransfer(o.id, 'reject', motivo)
      if (!r.ok) window.alert(r.error ?? 'No se pudo rechazar.')
    } finally { setBusy(null) }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <BadgeDollarSign size={18} />
        <div className="eyebrow" style={{ margin: 0 }}>Finanzas · Pagos por validar</div>
        <span className="pill p-warn" style={{ marginLeft: 'auto' }}>{rows.length} por revisar</span>
      </div>

      <div className="sysnote">
        <Clock size={16} />
        <span>Transferencias informadas por los clientes. Verifica que el dinero cayó en la cuenta destino y <b>confirma</b> para marcar el pedido pagado, o <b>rechaza</b> con motivo si no la localizas. El pedido no se factura hasta que el pago quede confirmado.</span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead>
              <tr><th>Fecha</th><th>Cliente</th><th>Folio</th><th>Total esperado</th><th>Referencia</th><th>Cuenta destino</th><th>Comprobante</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {rows.map(({ o, t }) => (
                <tr key={o.id}>
                  <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.at ?? o.created_at)}</td>
                  <td data-label="Cliente">{clientName(o)}</td>
                  <td data-label="Folio" className="mono">{o.external_ref}</td>
                  <td data-label="Total esperado" className="mono">{money(o.total)}</td>
                  <td data-label="Referencia" className="mono">{t.reference || '—'}</td>
                  <td data-label="Cuenta destino"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Landmark size={14} /> {bankLabel(t)}</span></td>
                  <td data-label="Comprobante">
                    {t.proof_path
                      ? <button type="button" className="btn ghost sm" onClick={() => verProof(t.proof_path!)}><FileImage size={14} /> Ver</button>
                      : <span className="ms" style={{ color: 'var(--ink-3)' }}>Sin comprobante</span>}
                  </td>
                  <td data-label="Acciones">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="btn sm" disabled={busy === o.id} onClick={() => confirmar(o)}><Check size={14} /> Confirmar</button>
                      <button type="button" className="btn ghost sm" disabled={busy === o.id} onClick={() => rechazar(o)}><X size={14} /> Rechazar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} style={{ color: 'var(--ink-3)' }}>No hay transferencias por validar. 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
