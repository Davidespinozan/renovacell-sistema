// DIRECCIÓN/FACTURACIÓN · Cola "Pagos por validar" — los COMPROBANTES que los clientes
// declararon (`payment_claims`) y esperan revisión humana. Reportar ≠ cobrar: mientras el
// comprobante esté aquí, NO hay dinero en el libro y el pedido no está pagado.
// Al confirmar nace el ASIENTO (`revisar_pago`) y el servidor recalcula payment_status;
// al rechazar (con motivo) el pedido queda sin pagar y el cliente puede volver a reportar.
import React, { useMemo, useState } from 'react'
import { BadgeDollarSign, Clock, Landmark, FileImage, Check, X } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useBankAccounts } from '../../data/hooks/useBankAccounts'
import { usePaymentClaims, useOrderMoney } from '../../data/hooks/useMoney'
import { reviewTransfer } from '../../data/store/ordersStore'
import { signedProofUrl } from '../../lib/uploads'
import { METODOS, type PaymentClaim } from '../../data/ops/money'
import { clasificarDeclaraciones } from '../../data/ops/pagosPendientes'
import { useRole } from '../../auth/RoleContext'
import { reloadOrders } from '../../data/store/ordersStore'
import type { Profile } from '../../data/types'

const metodoLabel = (m: string): string => METODOS.find((x) => x.value === m)?.label ?? m
const last4 = (s?: string | null): string => { const d = (s ?? '').replace(/\D/g, ''); return d ? d.slice(-4) : '' }

export function PagosPorValidar() {
  const { data: orders } = useAllOrders()
  const { data: doctors } = useDoctors()
  const { data: banks } = useBankAccounts()
  const { data: claims } = usePaymentClaims()
  const { byOrder } = useOrderMoney()
  const { setScreen } = useRole()
  const [busy, setBusy] = useState<string | null>(null)

  const doctorsById = useMemo(() => Object.fromEntries(doctors.map((d) => [d.id, d])) as Record<string, Profile | undefined>, [doctors])
  const banksById = useMemo(() => Object.fromEntries(banks.map((b) => [b.id, b])), [banks])
  const clientName = (o: OrderWithItems | null) => (!o ? 'Pedido aún no cargado' : o.doctor_id ? doctorsById[o.doctor_id]?.full_name ?? 'Doctor' : 'Mostrador (POS)')
  const bankLabel = (t: PaymentClaim): string => {
    const b = t.bank_account_id ? banksById[t.bank_account_id] : null
    if (!b) return 'Cuenta no indicada'
    const tail = last4(b.account_number) || last4(b.clabe)
    return `${b.bank_name}${tail ? ` ···· ${tail}` : ''}`
  }

  // La cola son los comprobantes ABIERTOS (status 'reportado'). No se filtra por
  // payment_status: un pedido con pago PARCIAL puede tener otro comprobante en revisión.
  // PAY-EXP-01A-3 · MISMO universo que el contador de Bandeja (clasificarDeclaraciones): los de pedidos cancelados
  // van a "Revisión económica" (aviso abajo) y los de pedidos aún no cargados se listan, no se esconden.
  const pend = useMemo(() => clasificarDeclaraciones(claims, orders), [claims, orders])
  const rows = useMemo(() => pend.vigentes.map(({ claim, order }) => ({ t: claim, o: order })), [pend])

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
        <span className="pill p-warn" style={{ marginLeft: 'auto' }} data-testid="pagos-contador">{rows.length} por revisar</span>
      </div>
      {pend.enCancelados.length > 0 && (
        <div className="sysnote" style={{ background: 'var(--warn-bg)' }} data-testid="pagos-en-cancelados">
          <span style={{ flex: 1 }}><b>{pend.enCancelados.length}</b> comprobante(s) de pedidos <b>cancelados</b> esperan decisión: se revisan en <b>Revisión económica</b> (registrar el dinero que sí llegó o rechazarlo).</span>
          <button type="button" className="btn ghost sm" onClick={() => setScreen('av_revision')}>Ir a Revisión económica</button>
        </div>
      )}

      <div className="sysnote">
        <Clock size={16} />
        <span>Pagos <b>informados</b> por los clientes: son declaraciones, todavía no hay dinero registrado. Verifica que cayó en la cuenta destino y <b>confirma</b> — ahí se registra el cobro en el libro — o <b>rechaza</b> con motivo si no lo localizas. El pedido no se factura hasta que el pago quede confirmado.</span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead>
              <tr><th>Fecha</th><th>Cliente</th><th>Folio</th><th>Declarado</th><th>Saldo del pedido</th><th>Referencia</th><th>Cuenta destino</th><th>Comprobante</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {rows.map(({ t, o }) => (
                <tr key={t.id} data-testid="pagos-fila">
                  <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.declared_at)}</td>
                  <td data-label="Cliente">{clientName(o)}</td>
                  <td data-label="Folio" className="mono">{o ? o.external_ref : '—'}</td>
                  <td data-label="Declarado" className="mono">{money(t.amount_declared)}<div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{metodoLabel(t.method)}</div></td>
                  <td data-label="Saldo del pedido" className="mono">{o ? money(byOrder[o.id]?.saldo ?? o.total ?? 0) : '—'}</td>
                  <td data-label="Referencia" className="mono">{t.reference || '—'}</td>
                  <td data-label="Cuenta destino"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Landmark size={14} /> {bankLabel(t)}</span></td>
                  <td data-label="Comprobante">
                    {t.proof_path
                      ? <button type="button" className="btn ghost sm" onClick={() => verProof(t.proof_path!)}><FileImage size={14} /> Ver</button>
                      : <span className="ms" style={{ color: 'var(--ink-3)' }}>Sin comprobante</span>}
                  </td>
                  <td data-label="Acciones">
                    {o ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn sm" disabled={busy === o.id} onClick={() => confirmar(o)}><Check size={14} /> Confirmar</button>
                        <button type="button" className="btn ghost sm" disabled={busy === o.id} onClick={() => rechazar(o)}><X size={14} /> Rechazar</button>
                      </div>
                    ) : (
                      <div className="ms" data-testid="pagos-sin-pedido">El pedido aún no se cargó. <button type="button" className="btn ghost sm" onClick={() => reloadOrders()}>Recargar</button></div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} style={{ color: 'var(--ink-3)' }}>No hay pagos por validar. 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
