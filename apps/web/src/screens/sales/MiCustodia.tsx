// VENDEDOR · MI INVENTARIO EN CUSTODIA. Lo que traigo en la mano, lote por lote, y lo
// que ya salió (vendido, devuelto, dado de baja).
//
// W2-C · Este saldo NO lo escribe esta pantalla ni el vendedor: sale del libro de
// custodia del servidor. Vender se hace en Punto de venta eligiendo la custodia, para
// que la venta pase por la misma ruta que el mostrador (pedido, precio del servidor,
// inventario y cobro). Aquí solo se consulta y se pide reabasto.
import { Vacio, Cargando } from '../../app/EmptyState'
import React, { useMemo } from 'react'
import { Box, AlertTriangle, Store } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useProducts } from '../../data/hooks/useProducts'
import { useRole } from '../../auth/RoleContext'
import { useCustodies, useCustodyStock, useCustodyLines } from '../../data/hooks/useCustody'
import { custodiaAbiertaDe, saldoDe } from '../../data/store/custodyStore'
import { currentUserId } from '../../lib/supabase'
import { notify } from '../../data/store/notificationsStore'
import { logAudit } from '../../data/store/auditStore'
import { CUSTODY_INVENTORY_DISABLED, CUSTODY_DISABLED_MSG } from '../../data/ops/w1Flags'

// A esta cantidad o menos conviene pedir reabasto.
export const SALDO_BAJO = 5

const ETIQUETA: Record<string, string> = {
  entrega: 'Recibí', venta: 'Vendí', devolucion: 'Devolví',
  faltante: 'Faltante', merma: 'Daño', caducado: 'Caducado', ajuste: 'Corrección',
}

export function MiCustodia() {
  const { user, setScreen } = useRole()
  const { data: custodias, loading } = useCustodies()
  const { data: stock } = useCustodyStock()
  const { data: lines } = useCustodyLines()
  const { data: products } = useProducts()

  const uid = currentUserId()
  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products])
  const mia = custodiaAbiertaDe(custodias, uid, 'vendedor')
  const mias = useMemo(() => custodias.filter((c) => c.holder_user_id === uid && c.status === 'abierta'), [custodias, uid])
  const saldo = mia ? saldoDe(stock, mia.id) : []
  const historial = useMemo(
    () => lines.filter((l) => mias.some((c) => c.id === l.custody_id)).slice(0, 25),
    [lines, mias])

  // Agregado por producto: el vendedor piensa en productos, no en lotes.
  const porProducto = useMemo(() => {
    const m: Record<string, number> = {}
    saldo.forEach((s) => { m[s.product_id] = (m[s.product_id] ?? 0) + s.en_poder })
    return m
  }, [saldo])

  const pedirReabasto = (productId: string) => {
    const nombre = prodName[productId] ?? 'producto'
    notify({ text: `${user?.name ?? 'Un vendedor'} pide reabasto de ${nombre} (custodia)`, roles: ['warehouse', 'admin'], screen: 'consigna_alm' })
    logAudit({ actor: user?.name ?? 'Ventas', action: 'Reabasto de custodia solicitado', resource: nombre })
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Mi inventario">
        El producto que traes en la mano. Sigue siendo de la empresa hasta que lo vendas:
        cuando lo vendas, se registra el cobro y sale del inventario. Para vender, ve a
        <b> Punto de venta</b> y elige tu inventario.
      </PageHead>

      {CUSTODY_INVENTORY_DISABLED && (
        <div className="sysnote" role="status" style={{ background: 'var(--warn-bg, #FFF7E6)', borderColor: '#EEDDB6' }}>
          <AlertTriangle size={16} /><span>{CUSTODY_DISABLED_MSG}</span>
        </div>
      )}

      {loading ? (
        <Cargando />
      ) : !mia ? (
        <Vacio icono="box" titulo="No tienes inventario en custodia." pista="Almacén te abre una custodia y te entrega producto." />
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Box size={18} style={{ color: 'var(--green-deep)' }} />
              <div className="eyebrow" style={{ margin: 0 }}>Lo que traigo</div>
              <span className="pill p-neu" style={{ marginLeft: 'auto' }}>
                {saldo.reduce((s, x) => s + x.en_poder, 0)} u · desde {fmtDate(mia.opened_at)}
              </span>
            </div>
            <div style={{ padding: '10px 14px 14px' }}>
              {saldo.length === 0 ? (
                <div style={{ color: 'var(--ink-3)' }}>Sin producto ahora mismo. Pide reabasto a Almacén.</div>
              ) : (
                <table className="tbl-cards">
                  <thead><tr><th>Producto</th><th>En mi poder</th><th>Recibido</th><th>Vendido</th><th></th></tr></thead>
                  <tbody>
                    {Object.entries(porProducto).map(([pid, q]) => {
                      const filas = saldo.filter((s) => s.product_id === pid)
                      return (
                        <tr key={pid}>
                          <td data-label="Producto">
                            {prodName[pid] ?? 'Producto'}
                            {q <= SALDO_BAJO && <span className="pill p-warn" style={{ marginLeft: 6, fontSize: 10 }}>saldo bajo</span>}
                          </td>
                          <td data-label="En mi poder" className="mono"><b>{q}</b></td>
                          <td data-label="Recibido" className="mono">{filas.reduce((s, x) => s + x.entregado, 0)}</td>
                          <td data-label="Vendido" className="mono">{filas.reduce((s, x) => s + x.vendido, 0)}</td>
                          <td data-label="" style={{ textAlign: 'right' }}>
                            <button className="btn ghost sm" type="button" onClick={() => pedirReabasto(pid)}>Pedir reabasto</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {saldo.length > 0 && (
                <button className="btn" type="button" style={{ marginTop: 14 }} onClick={() => setScreen('caja')}>
                  <Store size={15} /> Vender de mi inventario
                </button>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '18px 18px 0' }}><div className="eyebrow" style={{ margin: 0 }}>Mis últimos movimientos</div></div>
            <div style={{ padding: '10px 14px 14px' }}>
              {historial.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>Todavía no hay movimientos.</div> : (
                <table className="tbl-cards">
                  <thead><tr><th>Fecha</th><th>Qué pasó</th><th>Producto</th><th>Cantidad</th><th>Nota</th></tr></thead>
                  <tbody>
                    {historial.map((l) => (
                      <tr key={l.id}>
                        <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.created_at)}</td>
                        <td data-label="Qué pasó">{ETIQUETA[l.kind] ?? l.kind}</td>
                        <td data-label="Producto">{prodName[l.product_id] ?? 'Producto'}</td>
                        <td data-label="Cantidad" className="mono">{l.qty}</td>
                        <td data-label="Nota" style={{ color: 'var(--ink-3)', fontSize: 12 }}>{l.motivo ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
