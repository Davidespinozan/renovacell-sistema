// DIRECTORIO COMERCIAL compartido — la MISMA población (customers) para Admin "Doctores" y Ventas
// "Clientes". customers = identidad comercial del doctor/comprador (con o sin portal). profiles solo
// = acceso al portal (badge). scope 'all' (admin) o 'cartera' (ventas por seller_name). Solo lectura.
import React, { useMemo, useState } from 'react'
import { X, MapPin, Phone, Mail, UserCheck, UserX } from 'lucide-react'
import { initials, avatarColor } from '../lib/format'
import { ExportButton } from './ExportButton'
import { useCustomers, useCustomerSearch } from '../data/hooks/useCustomers'
import { portalStatus, filterByCartera, type Customer } from '../data/ops/customer'
import { useRole } from '../auth/RoleContext'
import { NuevoPedido } from '../screens/sales/NuevoPedido'

const MAX_RENDER = 100
const dash = (v: string | null | undefined) => (v ?? '').toString().trim() || '—'

// title = etiqueta de la sección ("Doctores" admin / "Clientes" ventas). scope = alcance de cartera.
export function CustomerDirectory({ title, scope }: { title: string; scope: 'all' | 'cartera' }) {
  const { data: all, loading, error } = useCustomers()
  const { role, user } = useRole()
  const isAdmin = role === 'admin'
  const canOrder = role === 'admin' || role === 'pos'
  const placedBy = isAdmin ? 'Administración' : `${user?.name ?? 'Ventas'} (Ventas)`

  // MISMA fuente (customers); admin ve todo, ventas su cartera por seller_name.
  const customers = useMemo(() => filterByCartera(all, { scope, isAdmin, userName: user?.name }), [all, scope, isAdmin, user])
  const [q, setQ] = useState('')
  const shown = useCustomerSearch(customers, q)
  const [detail, setDetail] = useState<Customer | null>(null)
  const [pedidoFor, setPedidoFor] = useState<Customer | null>(null)
  const visible = useMemo(() => shown.slice(0, MAX_RENDER), [shown])
  const conPortal = useMemo(() => customers.filter((c) => c.profile_id).length, [customers])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow">{title} · Directorio comercial</div>
        {!loading && !error && (
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            {customers.length.toLocaleString('es-MX')} · {conPortal.toLocaleString('es-MX')} con portal
          </span>
        )}
        <ExportButton name={title.toLowerCase()} rows={shown} style={{ marginLeft: 'auto' }} columns={[
          { key: 'full_name', label: 'Nombre' },
          { key: 'email', label: 'Correo' },
          { key: 'phone', label: 'Teléfono' },
          { key: 'city', label: 'Ciudad' },
          { key: 'country', label: 'País' },
          { key: 'seller_name', label: 'Vendedor' },
          { key: 'profile_id', label: 'Portal', format: (v) => (v ? 'Con acceso' : 'Sin acceso') },
        ]} />
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nombre, correo, teléfono, ciudad o vendedor…"
        style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--line)', borderRadius: 12, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: '#fff' }}
      />

      {loading ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Cargando directorio…</div>
      ) : error ? (
        <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}><span>{error}</span></div>
      ) : customers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>{scope === 'cartera' ? 'No tienes clientes en tu cartera.' : 'No hay registros en el directorio.'}</div>
      ) : shown.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Ninguno coincide con “{q}”.</div>
      ) : (
        <>
          {visible.map((c) => (
            <button key={c.id} type="button" className="card" onClick={() => setDetail(c)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}>
              <div className="avatar" style={{ background: avatarColor(c.full_name || '?') }}>{initials(c.full_name || '?')}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{c.full_name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[dash(c.city) !== '—' ? c.city : null, dash(c.seller_name) !== '—' ? c.seller_name : null].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <span className={'pill ' + (c.profile_id ? 'p-ok' : 'p-neu')} style={{ display: 'inline-flex', gap: 5, whiteSpace: 'nowrap' }}>
                {c.profile_id ? <UserCheck size={12} /> : <UserX size={12} />} {c.profile_id ? 'Portal' : 'Sin portal'}
              </span>
            </button>
          ))}
          {shown.length > MAX_RENDER && (
            <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
              Mostrando {MAX_RENDER} de {shown.length.toLocaleString('es-MX')}. Refina la búsqueda para acotar.
            </div>
          )}
        </>
      )}

      {detail && (
        <CustomerDetail c={detail} canOrder={canOrder} onOrder={() => { setPedidoFor(detail); setDetail(null) }} onClose={() => setDetail(null)} />
      )}
      {pedidoFor && (
        <NuevoPedido customer={{ id: pedidoFor.id, name: pedidoFor.full_name, phone: pedidoFor.phone }} placedBy={placedBy} onClose={() => setPedidoFor(null)} />
      )}
    </div>
  )
}

function CustomerDetail({ c, canOrder, onOrder, onClose }: { c: Customer; canOrder: boolean; onOrder: () => void; onClose: () => void }) {
  const row = (icon: React.ReactNode, label: string, value: string | null | undefined) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ color: 'var(--ink-3)', display: 'inline-flex' }}>{icon}</span>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-3)', width: 84 }}>{label}</span>
      <span style={{ fontSize: 13.5, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{dash(value)}</span>
    </div>
  )
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="avatar" style={{ background: avatarColor(c.full_name || '?') }}>{initials(c.full_name || '?')}</div>
            <div><h3 style={{ margin: 0 }}>{c.full_name}</h3><div className="ms">{portalStatus(c)}</div></div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          {row(<Mail size={15} />, 'Correo', c.email)}
          {row(<Phone size={15} />, 'Teléfono', c.phone)}
          {row(<MapPin size={15} />, 'Ciudad', c.city)}
          {row(<MapPin size={15} />, 'País', c.country)}
          {row(<UserCheck size={15} />, 'Vendedor', c.seller_name)}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className={'pill ' + (c.profile_id ? 'p-ok' : 'p-neu')} style={{ display: 'inline-flex', gap: 6 }}>
              {c.profile_id ? <UserCheck size={13} /> : <UserX size={13} />} {portalStatus(c)}
            </span>
            {canOrder && <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={onOrder}>Levantar pedido</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
