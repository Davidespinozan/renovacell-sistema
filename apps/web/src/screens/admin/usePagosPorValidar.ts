// PAGOS POR VALIDAR · los datos y las dos decisiones (confirmar / rechazar) en un solo lugar, para que la pantalla
// «Pagos por validar» y el Inicio de Dirección hagan EXACTAMENTE lo mismo. Reportar ≠ cobrar: mientras el comprobante
// esté aquí no hay dinero en el libro; al confirmar nace el asiento (`revisar_pago`) y el servidor recalcula el pago.
import { useMemo, useState } from 'react'
import { orderClientName } from '../../data/ops/orderClient'
import { avisar, pedirTexto } from '../../app/dialogos'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useBankAccounts } from '../../data/hooks/useBankAccounts'
import { usePaymentClaims, useOrderMoney } from '../../data/hooks/useMoney'
import { reviewTransfer } from '../../data/store/ordersStore'
import { signedProofUrl } from '../../lib/uploads'
import { METODOS, type PaymentClaim } from '../../data/ops/money'
import { clasificarDeclaraciones } from '../../data/ops/pagosPendientes'
import type { Profile } from '../../data/types'

export const metodoLabel = (m: string): string => METODOS.find((x) => x.value === m)?.label ?? m
const last4 = (s?: string | null): string => { const d = (s ?? '').replace(/\D/g, ''); return d ? d.slice(-4) : '' }

export function usePagosPorValidar() {
  const { data: orders } = useAllOrders()
  const { data: doctors } = useDoctors()
  const { data: banks } = useBankAccounts()
  const { data: claims } = usePaymentClaims()
  const { byOrder } = useOrderMoney()
  const [busy, setBusy] = useState<string | null>(null)

  const doctorsById = useMemo(() => Object.fromEntries(doctors.map((d) => [d.id, d])) as Record<string, Profile | undefined>, [doctors])
  const banksById = useMemo(() => Object.fromEntries(banks.map((b) => [b.id, b])), [banks])
  const clientName = (o: OrderWithItems | null) => (!o ? 'Pedido aún no cargado' : orderClientName(o, (id) => doctorsById[id]?.full_name, o.doctor_id ? 'Doctor' : 'Mostrador (POS)'))
  const bankLabel = (t: PaymentClaim): string => {
    const b = t.bank_account_id ? banksById[t.bank_account_id] : null
    if (!b) return 'Cuenta no indicada'
    const tail = last4(b.account_number) || last4(b.clabe)
    return `${b.bank_name}${tail ? ` ···· ${tail}` : ''}`
  }

  // La cola son los comprobantes ABIERTOS (status 'reportado'). No se filtra por
  // payment_status: un pedido con pago PARCIAL puede tener otro comprobante en revisión.
  // PAY-EXP-01A-3 · MISMO universo que el contador de Bandeja (clasificarDeclaraciones): los de pedidos cancelados
  // van a "Revisión económica" y los de pedidos aún no cargados se listan, no se esconden.
  const pend = useMemo(() => clasificarDeclaraciones(claims, orders), [claims, orders])
  const rows = useMemo(() => pend.vigentes.map(({ claim, order }) => ({ t: claim, o: order })), [pend])

  const verProof = async (path: string) => { const u = await signedProofUrl(path); if (u) window.open(u, '_blank') }

  /** Devuelve true si el pago quedó confirmado. */
  const confirmar = async (o: OrderWithItems): Promise<boolean> => {
    if (busy) return false
    setBusy(o.id)
    try {
      const r = await reviewTransfer(o.id, 'confirm')
      if (!r.ok) void avisar(r.error ?? 'No se pudo confirmar el pago.')
      return r.ok
    } finally { setBusy(null) }
  }
  /** Devuelve true si el comprobante quedó rechazado. */
  const rechazar = async (o: OrderWithItems): Promise<boolean> => {
    if (busy) return false
    const motivo = (await pedirTexto('Motivo del rechazo (se avisa al cliente para que reintente). No marca pagado ni cancela el pedido.'))
    if (motivo == null) return false
    if (!motivo.trim()) { void avisar('El rechazo necesita un motivo.'); return false }
    setBusy(o.id)
    try {
      const r = await reviewTransfer(o.id, 'reject', motivo)
      if (!r.ok) void avisar(r.error ?? 'No se pudo rechazar.')
      return r.ok
    } finally { setBusy(null) }
  }

  return { rows, pend, byOrder, busy, clientName, bankLabel, verProof, confirmar, rechazar }
}
