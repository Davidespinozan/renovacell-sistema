// ENVÍOS EXTRA (24 nov 2026) · en «Levantar pedido» la vendedora agrega envíos foráneos a otros domicilios del mismo
// pedido: para cada uno, el domicilio y qué productos (y cuántos) van ahí. Lo demás se va en el envío principal. Cada
// extra cuesta $600 (lo cobra el servidor; aquí solo se muestra). Almacén saca una guía por cada envío.
import React from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { money } from '../../lib/format'
import { DomicilioClientePicker } from '../../app/DomicilioClientePicker'
import { DeliveryLocationPicker } from '../../app/DeliveryLocationPicker'
import { COSTO_ENVIO_EXTRA, MAX_ENVIOS_EXTRA, restoPrincipal, type EnvioExtraBorrador } from '../../data/ops/enviosExtra'

export function EnviosExtra({ cart, nombreDe, vista, value, onChange, customer, doctorId }: {
  cart: Record<string, number>
  nombreDe: (id: string) => string
  /** CAJAS-MEDIOS · cómo se muestra una cantidad (cajas o piezas) */
  vista: (id: string, qty: number) => string | number
  value: EnvioExtraBorrador[]
  onChange: (v: EnvioExtraBorrador[]) => void
  customer?: { id: string; phone?: string | null }
  doctorId?: string
}) {
  const resto = restoPrincipal(cart, value)
  const productos = Object.entries(cart).filter(([, q]) => q > 0)
  const cambiar = (i: number, x: Partial<EnvioExtraBorrador>) => onChange(value.map((e, j) => (j === i ? { ...e, ...x } : e)))
  const pieza = (i: number, id: string, d: number) => {
    const actual = value[i].lineas[id] ?? 0
    const nuevo = Math.max(0, actual + d)
    if (d > 0 && (resto[id] ?? 0) <= 0) return
    cambiar(i, { lineas: { ...value[i].lineas, [id]: nuevo } })
  }
  return (
    <div data-testid="envios-extra" style={{ marginTop: 10 }}>
      {value.map((x, i) => (
        <div key={i} data-testid={`envio-extra-${i + 1}`} style={{ marginTop: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2, #fafafa)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <b style={{ fontSize: 13.5 }}>Envío extra {i + 1}</b>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>foráneo · {money(COSTO_ENVIO_EXTRA)}</span>
            <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} aria-label={`Quitar envío extra ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))} data-testid={`envio-extra-quitar-${i + 1}`}><X size={14} /></button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>¿A dónde va?</div>
          {customer
            ? <DomicilioClientePicker customerId={customer.id} telefonoRespaldo={customer.phone ?? null} onChange={(d) => cambiar(i, { address: d?.address ?? null })} />
            : <DeliveryLocationPicker doctorId={doctorId} legacyBase={null} allowManage={false} onChange={(c) => cambiar(i, { address: c?.address ?? null })} />}
          <div style={{ fontSize: 12, color: 'var(--ink-3)', margin: '10px 0 4px' }}>¿Qué va en este envío?</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {productos.map(([id]) => {
              const q = x.lineas[id] ?? 0
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{nombreDe(id)} <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>· quedan {vista(id, Math.max(0, resto[id] ?? 0))} sin repartir</span></span>
                  <button type="button" className="btn ghost sm" aria-label={`Quitar uno de ${nombreDe(id)} del envío extra ${i + 1}`} disabled={q <= 0} onClick={() => pieza(i, id, -1)}><Minus size={14} /></button>
                  <span className="mono" style={{ minWidth: 18, textAlign: 'center' }}>{vista(id, q)}</span>
                  <button type="button" className="btn sm" aria-label={`Agregar uno de ${nombreDe(id)} al envío extra ${i + 1}`} disabled={(resto[id] ?? 0) <= 0} onClick={() => pieza(i, id, 1)} data-testid={`envio-extra-${i + 1}-mas-${id}`}><Plus size={14} /></button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {value.length < MAX_ENVIOS_EXTRA && productos.length > 0 && (
        <button type="button" className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => onChange([...value, { address: null, lineas: {} }])} data-testid="envio-extra-agregar">
          <Plus size={14} /> Agregar otro envío (foráneo, {money(COSTO_ENVIO_EXTRA)})
        </button>
      )}
      {value.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }} data-testid="envio-extra-principal">
          El envío principal lleva: {productos.filter(([id]) => (resto[id] ?? 0) > 0).map(([id]) => `${nombreDe(id)} ×${vista(id, resto[id])}`).join(' · ') || 'nada (deja al menos un producto)'}.
        </div>
      )}
    </div>
  )
}
