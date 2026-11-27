// DIRECCIÓN/FACTURACIÓN · Cola "Pagos por validar" — los COMPROBANTES que los clientes
// declararon (`payment_claims`) y esperan revisión humana. Reportar ≠ cobrar: mientras el
// comprobante esté aquí, NO hay dinero en el libro y el pedido no está pagado.
// Al confirmar nace el ASIENTO (`revisar_pago`) y el servidor recalcula payment_status;
// al rechazar (con motivo) el pedido queda sin pagar y el cliente puede volver a reportar.
import React from 'react'
import { BadgeDollarSign, Clock, Landmark, FileImage, Check, X } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { useRole } from '../../auth/RoleContext'
import { reloadOrders } from '../../data/store/ordersStore'
import { Vacio } from '../../app/EmptyState'
import { metodoLabel, usePagosPorValidar } from './usePagosPorValidar'

export function PagosPorValidar() {
  // Los datos y las dos decisiones viven en usePagosPorValidar (los comparte el Inicio de Dirección).
  const { rows, pend, byOrder, busy, clientName, bankLabel, verProof, confirmar, rechazar } = usePagosPorValidar()
  const { setScreen } = useRole()

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <BadgeDollarSign size={18} />
        <div className="eyebrow crumb" style={{ margin: 0 }}>Finanzas · Pagos por validar</div>
        <span className="pill p-warn" style={{ marginLeft: 'auto' }} data-testid="pagos-contador">{rows.length} por revisar</span>
      </div>
      {pend.enCancelados.length > 0 && (
        <div className="sysnote" style={{ background: 'var(--warn-bg)' }} data-testid="pagos-en-cancelados">
          <span style={{ flex: 1 }}><b>{pend.enCancelados.length}</b> {pend.enCancelados.length === 1 ? 'comprobante' : 'comprobantes'} de pedidos <b>cancelados</b> esperan decisión: se revisan en <b>Revisión económica</b> (registrar el dinero que sí llegó o rechazarlo).</span>
          <button type="button" className="btn ghost sm" onClick={() => setScreen('av_revision')}>Ir a Revisión económica</button>
        </div>
      )}

      <div className="sysnote">
        <Clock size={16} />
        <span>Pagos <b>informados</b> por los clientes: son declaraciones, todavía no hay dinero registrado. Verifica que cayó en la cuenta destino y <b>confirma</b> — ahí se registra el cobro en el libro — o <b>rechaza</b> con motivo si no lo localizas. El pedido no se factura hasta que el pago quede confirmado.</span>
      </div>

      {/* Sin pagos no se pintan 9 encabezados sobre un renglón vacío: va el vacío compartido. */}
      {rows.length === 0 ? (
        <Vacio icono="check" titulo="No hay pagos por validar" pista="Cuando un cliente informe una transferencia o un depósito, aparecerá aquí para que lo confirmes." data-testid="pagos-vacio" />
      ) : (
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
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  )
}
