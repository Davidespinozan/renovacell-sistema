// DOCTORES (Administración): gate del canal comercial. El admin verifica/revoca
// el acceso del doctor al Portal (profiles.verified). Solo lectura excepto
// verificar/revocar. Agrega de profiles (doctores) + orders existentes.
import React, { useMemo, useState } from 'react'
import { UserCheck, ShieldCheck, Ban, X, ShoppingBag, Clock } from 'lucide-react'
import { money, fmtDate, initials, avatarColor } from '../../lib/format'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useAllOrders } from '../../data/hooks/useOrders'
import { statusView } from '../doctor/orderStatus'
import type { Profile } from '../../data/types'

function Avatar({ name }: { name: string }) {
  return <div className="avatar" style={{ background: avatarColor(name) }}>{initials(name)}</div>
}

const specialtyOf = (d: Profile): string => (d.meta?.specialty as string) ?? ''

export function Doctores() {
  const { data: doctors, verify, revoke } = useDoctors()
  const { data: orders } = useAllOrders()
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = doctors.find((d) => d.id === detailId) ?? null // siempre el doctor vivo del store

  const orderCount = useMemo(() => {
    const m: Record<string, number> = {}
    orders.forEach((o) => { if (o.doctor_id) m[o.doctor_id] = (m[o.doctor_id] ?? 0) + 1 })
    return m
  }, [orders])

  // Pendientes arriba (necesitan acción), luego por nombre.
  const sorted = useMemo(
    () =>
      doctors.slice().sort((a, b) =>
        Number(a.verified) - Number(b.verified) || (a.full_name ?? '').localeCompare(b.full_name ?? ''),
      ),
    [doctors],
  )
  const pendientes = sorted.filter((d) => !d.verified).length

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Administración · Doctores</div>

      {pendientes > 0 && (
        <div className="alert" style={{ cursor: 'default' }}>
          <div className="ico"><Clock size={20} /></div>
          <div className="x"><b>{pendientes} doctor(es) pendiente(s) de verificar.</b> Hasta verificarlos no pueden ordenar en el Portal.</div>
        </div>
      )}

      {sorted.map((d) => (
        <div key={d.id} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={d.full_name ?? '?'} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{d.full_name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                {d.organization}{specialtyOf(d) ? ` · ${specialtyOf(d)}` : ''}
              </div>
            </div>
            <span className={'pill ' + (d.verified ? 'p-ok' : 'p-warn')}>
              {d.verified ? <ShieldCheck size={12} /> : <Clock size={12} />} {d.verified ? 'Verificado' : 'Pendiente'}
            </span>
            <span className="pill p-neu" style={{ display: 'inline-flex', gap: 5 }}><ShoppingBag size={12} /> {orderCount[d.id] ?? 0}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <button className="btn ghost sm" type="button" onClick={() => setDetailId(d.id)}>Ver detalle</button>
            {d.verified ? (
              <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto', color: 'var(--danger)' }} onClick={() => revoke(d.id)}>
                <Ban size={14} /> Revocar
              </button>
            ) : (
              <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => verify(d.id)}>
                <UserCheck size={14} /> Verificar
              </button>
            )}
          </div>
        </div>
      ))}

      {detail && (
        <DoctorDetail
          doctor={detail}
          orders={orders.filter((o) => o.doctor_id === detail.id)}
          onClose={() => setDetailId(null)}
          onVerify={() => verify(detail.id)}
          onRevoke={() => revoke(detail.id)}
        />
      )}
    </div>
  )
}

function DoctorDetail({
  doctor, orders, onClose, onVerify, onRevoke,
}: {
  doctor: Profile
  orders: ReturnType<typeof useAllOrders>['data']
  onClose: () => void
  onVerify: () => void
  onRevoke: () => void
}) {
  // doctor.verified puede cambiar mientras el modal está abierto; leemos del store vía prop.
  const history = orders.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={doctor.full_name ?? '?'} />
            <div>
              <h3>{doctor.full_name}</h3>
              <div className="ms">{doctor.organization}{specialtyOf(doctor) ? ` · ${specialtyOf(doctor)}` : ''}</div>
            </div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Correo</div>{doctor.email}</div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Cédula</div>{(doctor.meta?.cedula as string) ?? '—'}</div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Estatus</div>
              <span className={'pill ' + (doctor.verified ? 'p-ok' : 'p-warn')}>{doctor.verified ? 'Verificado' : 'Pendiente'}</span>
            </div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Pedidos</div>{history.length}</div>
          </div>

          {!doctor.verified && (
            <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)', marginBottom: 14 }}>
              <Clock size={18} />
              <span>No verificado: aún no puede ordenar en el Portal. Verifícalo para habilitar su canal.</span>
            </div>
          )}

          <div className="eyebrow">Historial de pedidos</div>
          {history.length === 0 ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Sin pedidos.</div>
          ) : (
            <table>
              <thead><tr><th>Folio</th><th>Estatus</th><th>Fecha</th><th>Total</th></tr></thead>
              <tbody>
                {history.map((o) => {
                  const sv = statusView(o.status)
                  return (
                    <tr key={o.id}>
                      <td className="mono">{o.external_ref}</td>
                      <td><span className={'pill ' + sv.pill}>{sv.label}</span></td>
                      <td>{fmtDate(o.created_at)}</td>
                      <td className="mono">{money(o.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            {doctor.verified ? (
              <button className="btn ghost" type="button" style={{ color: 'var(--danger)' }} onClick={onRevoke}><Ban size={15} /> Revocar acceso</button>
            ) : (
              <button className="btn" type="button" onClick={onVerify}><UserCheck size={15} /> Verificar doctor</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
