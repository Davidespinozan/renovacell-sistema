// VENTAS DEL EQUIPO (25 nov 2026) · el jefe de ventas ve las ventas de todos los vendedores, pedido por pedido, con los
// mismos filtros que Dirección (vendedor, canal, entrega, cobro, fechas) y su Excel. Solo lectura: cobrar, dar crédito,
// devolver o cancelar siguen siendo de quien le toca. Los datos salen de ventas_equipo (no del RLS del vendedor).
import React from 'react'
import { VentasDetalle } from '../admin/VentasDetalle'
import { useVentasEquipo } from '../../data/ops/ventasEquipo'

export function VentasEquipo() {
  const v = useVentasEquipo()
  return (
    <div className="grid" style={{ gap: 14 }} data-testid="ventas-equipo">
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Ventas de todo el equipo de los últimos 4 meses. Filtra por vendedor, canal, entrega o cobro y descarga el Excel. Solo consulta.</div>
      {v.error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>{v.error}</div>}
      <VentasDetalle fuente={{ orders: v.orders, byOrder: v.byOrder, cargando: v.cargando, vendedores: v.vendedores }} soloLectura />
    </div>
  )
}
