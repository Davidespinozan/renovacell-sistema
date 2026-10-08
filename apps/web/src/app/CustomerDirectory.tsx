// DIRECTORIO COMERCIAL compartido — la MISMA población (customers) para Admin "Doctores" y Ventas
// "Clientes". customers = identidad comercial del doctor/comprador (con o sin portal). profiles solo
// = acceso al portal (badge). Solo lectura.
// CARTERA-P1 · Ventas alterna tres vistas SEPARADAS: "Todos" (lo que permite la RLS), "Mi cartera" (asignación
// VIGENTE de cc_cartera, la que asigna Dirección) y "Cartera histórica (Odoo)" (registros heredados por
// equivalencia EXPLÍCITA; no son asignaciones). Ambas carteras vienen del servidor por id, nunca por nombre.
import React, { useEffect, useMemo, useState } from 'react'
import { UserCheck, UserX, ChevronLeft, ChevronRight } from 'lucide-react'
import { initials, avatarColor } from '../lib/format'
import { ExportButton } from './ExportButton'
import { useCustomers, useCustomerSearch } from '../data/hooks/useCustomers'
import { filterByCartera, paginate, pageWindow, type Customer, type VistaCartera } from '../data/ops/customer'
import { useMiCartera } from '../data/hooks/useMiCartera'
import type { ClienteCartera } from '../data/ops/cartera'
import { useRole } from '../auth/RoleContext'
import { Customer360Page } from './Customer360'
import { NuevoPedido } from '../screens/sales/NuevoPedido'

const PAGE_SIZE = 100
const dash = (v: string | null | undefined) => (v ?? '').toString().trim() || '—'

// title = etiqueta de la sección ("Doctores" admin / "Clientes" ventas). scope = alcance por defecto.
// carteraToggle = muestra el filtro "Todos | Mi cartera" (Ventas); default = scope.
const VISTAS: ReadonlyArray<readonly [VistaCartera, string]> = [['all', 'Todos'], ['cartera', 'Mi cartera'], ['historica', 'Cartera histórica (Odoo)']]
const EXPLICACION: Record<VistaCartera, string> = {
  all: '',
  cartera: 'Clientes asignados a ti por Dirección (asignación vigente).',
  historica: 'Registros heredados de Odoo según la equivalencia de vendedor que autorizó Dirección. Son de consulta: no son asignaciones vigentes.',
}

export function CustomerDirectory({ title, scope, carteraToggle = false, clienteCartera }: { title: string; scope: VistaCartera; carteraToggle?: boolean; clienteCartera?: ClienteCartera }) {
  const { data: all, loading, error } = useCustomers()
  const { role, user, setScreen } = useRole()
  const isAdmin = role === 'admin'
  const canOrder = role === 'admin' || role === 'pos'
  const placedBy = isAdmin ? 'Administración' : `${user?.name ?? 'Ventas'} (Ventas)`

  // Vista efectiva: con toggle el vendedor alterna Todos/Mi cartera (default = scope, "Todos").
  const [view, setView] = useState<VistaCartera>(scope)
  const effectiveScope = carteraToggle ? view : scope
  const mi = useMiCartera(carteraToggle && !isAdmin, clienteCartera)

  // MISMA fuente (customers); "Todos" muestra lo accesible por RLS; las carteras filtran por los ids del servidor.
  const customers = useMemo(() => filterByCartera(all, { scope: effectiveScope, isAdmin, clientes: mi.clientes, perfiles: mi.perfiles, historicos: mi.historicos }), [all, effectiveScope, isAdmin, mi])
  const asignado = (c: Customer) => mi.clientes.has(c.id) || (!!c.profile_id && mi.perfiles.has(c.profile_id))
  const historico = (c: Customer) => mi.historicos.has(c.id)
  const enCartera = effectiveScope !== 'all' && !isAdmin
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

  // C360-F3 · abrir un cliente entra a la ficha Customer 360 de página completa (no el modal).
  if (detail) {
    return (
      <>
        <Customer360Page
          customerId={detail.id}
          inicial={{ nombre: detail.full_name, email: detail.email, portal: !!detail.profile_id }}
          onBack={() => setDetail(null)}
          canOrder={canOrder}
          onOrder={() => setPedidoFor(detail)}
          onAsesorias={() => setScreen('asesorias')}
        />
        {pedidoFor && <NuevoPedido customer={{ id: pedidoFor.id, name: pedidoFor.full_name, phone: pedidoFor.phone }} placedBy={placedBy} onClose={() => setPedidoFor(null)} />}
      </>
    )
  }

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
          { key: 'seller_name', label: 'Vendedor histórico (Odoo)' },
          ...(carteraToggle && !isAdmin ? [{ key: 'id' as const, label: 'Relación conmigo', format: (_: unknown, c: Customer) => (asignado(c) ? 'Asignación vigente' : historico(c) ? 'Histórico (Odoo)' : '') }] : []),
          { key: 'profile_id', label: 'Portal', format: (v) => (v ? 'Con acceso' : 'Sin acceso') },
        ]} />
      </div>

      {carteraToggle && (
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {VISTAS.map(([k, lbl]) => (
            <button key={k} type="button" className={view === k ? 'active' : undefined} aria-pressed={view === k} onClick={() => setView(k)} data-testid={`vista-${k}`}>{lbl}</button>
          ))}
        </div>
      )}
      {enCartera && EXPLICACION[effectiveScope] && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: -8 }} data-testid="cartera-explicacion">{EXPLICACION[effectiveScope]}</div>}

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
      ) : enCartera && mi.cargando ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Cargando tu cartera…</div>
      ) : enCartera && mi.error ? (
        <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }} data-testid="cartera-error"><span>{mi.error}</span></div>
      ) : customers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }} data-testid="cartera-vacia">{effectiveScope === 'cartera' ? 'No tienes clientes asignados.'
          : effectiveScope === 'historica' ? (mi.equivalencias.length ? 'No hay registros históricos de Odoo para tus equivalencias.' : 'Dirección aún no ha registrado una equivalencia entre tu usuario y un vendedor de Odoo.')
          : 'No hay registros en el directorio.'}</div>
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
                  {[dash(c.city) !== '—' ? c.city : null, dash(c.seller_name) !== '—' ? `Odoo: ${c.seller_name}` : null].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              {carteraToggle && !isAdmin && asignado(c) && <span className="pill p-ok" style={{ whiteSpace: 'nowrap' }} data-testid="marca-asignado">Asignado</span>}
              {carteraToggle && !isAdmin && !asignado(c) && historico(c) && <span className="pill p-neu" style={{ whiteSpace: 'nowrap' }} data-testid="marca-historico">Histórico (Odoo)</span>}
              <span className={'pill ' + (c.profile_id ? 'p-ok' : 'p-neu')} style={{ display: 'inline-flex', gap: 5, whiteSpace: 'nowrap' }}>
                {c.profile_id ? <UserCheck size={12} /> : <UserX size={12} />} {c.profile_id ? 'Portal' : 'Sin portal'}
              </span>
            </button>
          ))}
          <Pager pg={pg} onPage={setPage} />
        </>
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

