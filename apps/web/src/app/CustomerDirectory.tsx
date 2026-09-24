// DIRECTORIO COMERCIAL compartido — la MISMA población (customers) para Admin "Doctores" y Ventas
// "Clientes". customers = identidad comercial del doctor/comprador (con o sin portal). profiles solo
// = acceso al portal (badge). scope 'all' (admin) o 'cartera' (ventas por seller_name). Solo lectura.
import React, { useEffect, useMemo, useState } from 'react'
import { X, MapPin, Phone, Mail, UserCheck, UserX, ChevronLeft, ChevronRight } from 'lucide-react'
import { initials, avatarColor } from '../lib/format'
import { ExportButton } from './ExportButton'
import { useCustomers, useCustomerSearch } from '../data/hooks/useCustomers'
import { portalStatus, filterByCartera, paginate, pageWindow, type Customer } from '../data/ops/customer'
import { useRole } from '../auth/RoleContext'
import { NuevoPedido } from '../screens/sales/NuevoPedido'

const PAGE_SIZE = 100
const dash = (v: string | null | undefined) => (v ?? '').toString().trim() || '—'

// title = etiqueta de la sección ("Doctores" admin / "Clientes" ventas). scope = alcance por defecto.
// carteraToggle = muestra el filtro "Todos | Mi cartera" (Ventas); default = scope.
export function CustomerDirectory({ title, scope, carteraToggle = false }: { title: string; scope: 'all' | 'cartera'; carteraToggle?: boolean }) {
  const { data: all, loading, error } = useCustomers()
  const { role, user } = useRole()
  const isAdmin = role === 'admin'
  const canOrder = role === 'admin' || role === 'pos'
  const placedBy = isAdmin ? 'Administración' : `${user?.name ?? 'Ventas'} (Ventas)`

  // Vista efectiva: con toggle el vendedor alterna Todos/Mi cartera (default = scope, "Todos").
  const [view, setView] = useState<'all' | 'cartera'>(scope)
  const effectiveScope = carteraToggle ? view : scope

  // MISMA fuente (customers); "Todos" muestra todo lo accesible por RLS, "Mi cartera" filtra por seller_name.
  const customers = useMemo(() => filterByCartera(all, { scope: effectiveScope, isAdmin, userName: user?.name }), [all, effectiveScope, isAdmin, user])
  const [q, setQ] = useState('')
  const shown = useCustomerSearch(customers, q) // filtro cartera + búsqueda, SOBRE TODOS (antes de paginar)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<Customer | null>(null)
  const [pedidoFor, setPedidoFor] = useState<Customer | null>(null)
  const conPortal = useMemo(() => customers.filter((c) => c.profile_id).length, [customers])

  // Reset a página 1 al cambiar búsqueda, vista o el conjunto filtrado.
  useEffect(() => { setPage(1) }, [q, shown.length, effectiveScope])

  const pg = paginate(shown, page, PAGE_SIZE) // clamp interno a rango válido
  const visible = pg.items

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

      {carteraToggle && (
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {([['all', 'Todos'], ['cartera', 'Mi cartera']] as const).map(([k, lbl]) => (
            <button key={k} type="button" className={view === k ? 'active' : undefined} onClick={() => setView(k)}>{lbl}</button>
          ))}
        </div>
      )}

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
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>{effectiveScope === 'cartera' ? 'No tienes clientes en tu cartera.' : 'No hay registros en el directorio.'}</div>
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
          <Pager pg={pg} onPage={setPage} />
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

// Paginación: "Mostrando 1–100 de 2,568 · Página 1 de 26" + ← números … → (desktop) / ← Página X de Y → (móvil).
function Pager({ pg, onPage }: { pg: import('../data/ops/customer').Page<Customer>; onPage: (p: number) => void }) {
  const nf = (n: number) => n.toLocaleString('es-MX')
  const btn: React.CSSProperties = { minWidth: 34, height: 34, padding: '0 9px', border: '1px solid var(--line)', borderRadius: 9, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }
  const off = (on: boolean): React.CSSProperties => (on ? {} : { opacity: 0.4, cursor: 'not-allowed' })
  const prev = () => onPage(pg.page - 1)
  const next = () => onPage(pg.page + 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
        Mostrando {nf(pg.from)}–{nf(pg.to)} de {nf(pg.total)} · Página {nf(pg.page)} de {nf(pg.totalPages)}
      </div>
      {pg.totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" style={{ ...btn, ...off(pg.page > 1), display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={pg.page <= 1} onClick={prev}>
            <ChevronLeft size={15} /> <span className="pg-lbl">Anterior</span>
          </button>
          {/* Desktop: números compactos con elipsis */}
          <span className="pg-nums" style={{ display: 'inline-flex', gap: 6 }}>
            {pageWindow(pg.page, pg.totalPages).map((n, i) =>
              n === '…'
                ? <span key={`e${i}`} style={{ minWidth: 20, textAlign: 'center', color: 'var(--ink-3)' }}>…</span>
                : <button key={n} type="button" onClick={() => onPage(n)}
                    style={{ ...btn, ...(n === pg.page ? { background: 'var(--green-deep)', color: '#fff', borderColor: 'var(--green-deep)', fontWeight: 700 } : {}) }}>{n}</button>,
            )}
          </span>
          {/* Móvil: "Página X de Y" */}
          <span className="pg-mobile" style={{ fontSize: 13, color: 'var(--ink-3)', minWidth: 110, textAlign: 'center' }}>Página {nf(pg.page)} de {nf(pg.totalPages)}</span>
          <button type="button" style={{ ...btn, ...off(pg.page < pg.totalPages), display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={pg.page >= pg.totalPages} onClick={next}>
            <span className="pg-lbl">Siguiente</span> <ChevronRight size={15} />
          </button>
        </div>
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
