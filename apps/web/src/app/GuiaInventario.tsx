// ¿CÓMO ENTRA EL INVENTARIO? · franja corta que cuenta la historia en 3 pasos, con acceso directo a cada pantalla
// cuando el rol la tiene en su menú. Pedido del dueño (15 oct 2026): "tiene que estar claro dónde y cuándo se mete
// inventario". Se muestra en Inventario, Recibir mercancía y Compras a proveedores; se puede plegar y se recuerda.
import React, { useState } from 'react'
import { useRole } from '../auth/RoleContext'
import { getNav, getRole } from './roles'

const CLAVE = 'rc_guia_inventario_oculta'
// `destino` es solo el rótulo del botón («Ir a …»); la pantalla real la decide `keys` según el menú del rol.
const PASOS: Array<{ n: number; titulo: string; texto: string; keys: string[]; destino: string }> = [
  { n: 1, titulo: 'Se pide al proveedor', texto: 'Dirección registra la compra (producto, cantidad y costo). Todavía no hay inventario.', keys: ['av_inv', 'compras'], destino: 'Compras a proveedores' },
  { n: 2, titulo: 'Llega y se recibe', texto: 'Almacén captura lo que llegó, con lote y caducidad. Aquí nace el inventario.', keys: ['entradas'], destino: 'Recibir mercancía' },
  { n: 3, titulo: 'Ya está en Inventario', texto: 'Se ve por producto y por lote, y sale con los pedidos.', keys: ['stock'], destino: 'Inventario' },
]

export function GuiaInventario({ paso }: { paso?: 1 | 2 | 3 }) {
  const { role, capabilities, setScreen } = useRole()
  const [oculta, setOculta] = useState(() => { try { return localStorage.getItem(CLAVE) === '1' } catch { return false } })
  const nav = new Set(getNav(getRole(role), undefined, capabilities).map((s) => s.key))
  const alternar = () => { setOculta((v) => { try { localStorage.setItem(CLAVE, v ? '0' : '1') } catch { /* sin almacenamiento */ } return !v }) }
  return (
    <div className="card" data-testid="guia-inventario" style={{ padding: '10px 14px', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>¿Cómo entra el inventario?</div>
        <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={alternar} data-testid="guia-inventario-toggle">{oculta ? 'Ver' : 'Ocultar'}</button>
      </div>
      {!oculta && (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {PASOS.map((p) => {
            const key = p.keys.find((k) => nav.has(k))
            const actual = paso === p.n
            return (
              <li key={p.n} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)', background: actual ? 'var(--ok-bg, #EAF4EC)' : 'transparent' }} data-testid={`guia-paso-${p.n}`}>
                <div style={{ display: 'flex', gap: 10, flex: 1 }}>
                <span style={{ flex: 'none', width: 24, height: 24, borderRadius: 12, background: actual ? 'var(--green-deep)' : 'var(--line)', color: actual ? '#fff' : 'var(--ink-2)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{p.n}</span>
                <span style={{ minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: 13 }}>{p.titulo}{actual ? ' · estás aquí' : ''}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{p.texto}</span>
                </span>
                </div>
                {/* Botón aparte, abajo a la derecha: dentro de la oración se leía como parte del texto. */}
                {key && !actual && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-end' }} onClick={() => setScreen(key)}>Ir a {p.destino}</button>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
