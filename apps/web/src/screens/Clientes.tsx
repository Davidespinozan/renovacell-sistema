// CLIENTES — cartera del vendedor (directorio de doctores). Aislado por vendedor:
// cada quien ve SOLO su cartera (doctor.meta.owner); Admin ve todos. Solo lectura.
import React, { useMemo } from 'react'
import { ShieldCheck, Clock, ShoppingBag } from 'lucide-react'
import { initials, avatarColor } from '../lib/format'
import { useDoctors } from '../data/hooks/useDoctors'
import { useAllOrders } from '../data/hooks/useOrders'
import { useRole } from '../auth/RoleContext'
import type { Profile } from '../data/types'

const ownerOf = (d: Profile): string | null => ((d.meta as Record<string, unknown>)?.owner as string) ?? null
const specialtyOf = (d: Profile): string => ((d.meta as Record<string, unknown>)?.specialty as string) ?? ''

export function Clientes() {
  const { data: doctors } = useDoctors()
  const { data: orders } = useAllOrders()
  const { role, user } = useRole()

  const mine = useMemo(
    () => (role === 'admin' ? doctors : doctors.filter((d) => ownerOf(d) === user?.email)),
    [doctors, role, user],
  )
  const orderCount = useMemo(() => {
    const m: Record<string, number> = {}
    orders.forEach((o) => { if (o.doctor_id) m[o.doctor_id] = (m[o.doctor_id] ?? 0) + 1 })
    return m
  }, [orders])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">{role === 'admin' ? 'Administración' : 'Ventas'} · Clientes</div>

      {mine.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          Aún no tienes clientes en tu cartera.
        </div>
      ) : mine.map((d) => (
        <div key={d.id} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="avatar" style={{ background: avatarColor(d.full_name ?? '?') }}>{initials(d.full_name ?? '?')}</div>
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
        </div>
      ))}
    </div>
  )
}
