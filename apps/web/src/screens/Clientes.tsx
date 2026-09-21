// CLIENTES — DIRECTORIO COMERCIAL real, basado en `customers` (los ~2,568 clientes de Renovacell,
// existan o no en el portal). Fuente = useCustomers (customers), NO useDoctors (profiles): profiles/
// doctor_directory siguen sirviendo SOLO al acceso al portal. Solo lectura (RLS admin/pos).
import React, { useMemo, useState } from 'react'
import { X, MapPin, Phone, Mail, UserCheck, UserX } from 'lucide-react'
import { initials, avatarColor } from '../lib/format'
import { ExportButton } from '../app/ExportButton'
import { useCustomers, useCustomerSearch } from '../data/hooks/useCustomers'
import { portalStatus, type Customer } from '../data/ops/customer'

const MAX_RENDER = 100 // el filtro corre sobre todos; solo pintamos los primeros N (perf con miles)
const dash = (v: string | null | undefined) => (v ?? '').toString().trim() || '—'

export function Clientes() {
  const { data: customers, loading, error } = useCustomers()
  const [q, setQ] = useState('')
  const shown = useCustomerSearch(customers, q)
  const [detail, setDetail] = useState<Customer | null>(null)
  const visible = useMemo(() => shown.slice(0, MAX_RENDER), [shown])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow">Clientes · Directorio comercial</div>
        {!loading && !error && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{customers.length.toLocaleString('es-MX')} cliente(s)</span>}
        <ExportButton name="clientes" rows={shown} style={{ marginLeft: 'auto' }} columns={[
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
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>No hay clientes en el directorio.</div>
      ) : shown.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Ningún cliente coincide con “{q}”.</div>
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

      {detail && <CustomerDetail c={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function CustomerDetail({ c, onClose }: { c: Customer; onClose: () => void }) {
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
          <div style={{ marginTop: 14 }}>
            <span className={'pill ' + (c.profile_id ? 'p-ok' : 'p-neu')} style={{ display: 'inline-flex', gap: 6 }}>
              {c.profile_id ? <UserCheck size={13} /> : <UserX size={13} />} {portalStatus(c)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
