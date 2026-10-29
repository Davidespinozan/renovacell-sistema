// DOCTORES (Administración): gate del canal comercial. El admin verifica/revoca
// el acceso del doctor al Portal (profiles.verified). Solo lectura excepto
// verificar/revocar. Agrega de profiles (doctores) + orders existentes.
import { Vacio } from '../../app/EmptyState'
import React, { useEffect, useMemo, useState } from 'react'
import { UserCheck, ShieldCheck, Ban, X, ShoppingBag, Clock, Plus, Pencil, Trash2, ScanFace, IdCard } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { UserAvatar } from '../../app/UserAvatar'
import { ConfirmModal } from '../../app/ConfirmModal'
import { ExportButton } from '../../app/ExportButton'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useCustomers } from '../../data/hooks/useCustomers'
import { useAllOrders } from '../../data/hooks/useOrders'
import { usePricing } from '../../data/hooks/usePricing'
import { findCustomerCandidates, type CustomerCandidate } from '../../data/ops/customerMatch'
import { findVerifiedOrphans } from '../../data/ops/orphans'
import { deriveVerificationStatus, VERIF_LABEL, VERIF_PILL } from '../../data/ops/verification'
import { profileContact } from '../../data/ops/profileContact'
import { formatAddress } from '../../data/ops/shippingAddress'
import type { CustomerFields } from '../../data/store/customersStore'
import { supabase } from '../../lib/supabase'
import { NuevoPedido } from '../sales/NuevoPedido'
import { statusView } from '../doctor/orderStatus'
import type { Profile } from '../../data/types'

// ---- Identificación (INE) que el doctor subió: la revisa una persona (sin verificación automática). ----
interface IdentityRecord {
  status?: 'approved' | 'pending' | 'rejected'
  evidence?: Record<string, string>
}
const identityOf = (d: Profile): IdentityRecord | null => ((d.meta as Record<string, unknown>)?.identity as IdentityRecord) ?? null

const avatarOf = (d: Profile): string | undefined => ((d.meta as Record<string, unknown>)?.avatar_url as string) ?? undefined
function Avatar({ name, url }: { name: string; url?: string }) {
  return <UserAvatar name={name} url={url} />
}

const specialtyOf = (d: Profile): string => (d.meta?.specialty as string) ?? ''
const cedulaOf = (d: Profile): string => ((d.meta?.cedula as string) ?? '').trim()

export function Doctores() {
  const { data: doctors, approve, reject, revoke, setCedula, setPriceList, inviteDoctor, updateDoctor, deleteDoctor } = useDoctors()
  const { data: customers } = useCustomers()
  const [editDoc, setEditDoc] = useState<{ id: string; name: string; org: string } | null>(null)
  // Eliminar un doctor es irreversible (borra su cuenta e historial): confirmación tecleada.
  const doDeleteDoctor = async (id: string) => {
    const r = await deleteDoctor(id)
    if (!r.ok) window.alert(r.error ?? 'No se pudo eliminar.')
  }
  const { data: orders } = useAllOrders()
  const { lists } = usePricing()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [pedidoFor, setPedidoFor] = useState<{ id: string; name: string } | null>(null)
  const [delDoctor, setDelDoctor] = useState<{ id: string; name: string } | null>(null)
  const detail = doctors.find((d) => d.id === detailId) ?? null // siempre el doctor vivo del store

  const orderCount = useMemo(() => {
    const m: Record<string, number> = {}
    orders.forEach((o) => { if (o.doctor_id) m[o.doctor_id] = (m[o.doctor_id] ?? 0) + 1 })
    return m
  }, [orders])

  // "Por verificar" es una COLA DE REVISIÓN: SOLO pending (incluye el dictamen IA 'review',
  // que mantiene status pending). Excluye verified/rejected/revoked. profiles.verified es la
  // autoridad: verified=true SIEMPRE sale de la cola (aunque un meta legacy diga 'pending').
  const queue = useMemo(
    () => doctors.filter((d) => deriveVerificationStatus(d) === 'pending')
      .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '')),
    [doctors],
  )
  const pendientes = queue.length
  // Export: la población completa de doctores (no solo la cola).
  const sorted = useMemo(
    () => doctors.slice().sort((a, b) => Number(a.verified) - Number(b.verified) || (a.full_name ?? '').localeCompare(b.full_name ?? '')),
    [doctors],
  )
  // ORPHANS tipo A (caso Magaly): verificados SIN customer vinculado → no aparecen en Doctores.
  const orphans = useMemo(() => findVerifiedOrphans(doctors, customers), [doctors, customers])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow crumb">Administración · Por verificar</div>
        <ExportButton name="doctores" rows={sorted} style={{ marginLeft: 'auto' }} columns={[
          { key: 'full_name', label: 'Nombre' },
          { key: 'organization', label: 'Consultorio' },
          { key: 'meta', label: 'Especialidad', format: (_v, d) => specialtyOf(d) },
          { key: 'email', label: 'Correo' },
          { key: 'meta', label: 'Cédula', format: (_v, d) => cedulaOf(d) },
          { key: 'verified', label: 'Verificado', format: (v) => (v ? 'Sí' : 'No') },
          { key: 'id', label: 'Pedidos', format: (v) => orderCount[v as string] ?? 0 },
        ]} />
      </div>

      {pendientes > 0 && (
        <div className="alert" style={{ cursor: 'default' }}>
          <div className="ico"><Clock size={20} /></div>
          <div className="x"><b>{pendientes} {pendientes === 1 ? 'doctor pendiente' : 'doctores pendientes'} de verificar.</b> Revisa su cédula y las fotos de su INE en <b>Revisar / Aprobar</b> (ahí también se vincula su ficha de cliente).</div>
        </div>
      )}

      {orphans.length > 0 && (
        <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)', display: 'block' }}>
          <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ScanFace size={15} /> {orphans.length} {orphans.length === 1 ? 'doctor verificado' : 'doctores verificados'} SIN cliente vinculado
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 8 }}>
            Están verificados pero no aparecen en <b>Clientes</b> (que se alimenta de clientes). Vincula su ficha comercial para completarlos.
          </div>
          {orphans.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{d.full_name} <span style={{ color: 'var(--ink-3)' }}>· {d.email ?? 's/correo'}</span></span>
              <button className="btn ghost sm" type="button" onClick={() => setDetailId(d.id)}>Vincular cliente</button>
            </div>
          ))}
        </div>
      )}

      {queue.length === 0 && orphans.length === 0 && (
        <Vacio icono="usercheck" titulo="No hay doctores pendientes de verificación." pista="Los registros nuevos del Portal del Doctor aparecerán aquí." />
      )}

      {queue.map((d) => (
        <div key={d.id} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={d.full_name ?? '?'} url={avatarOf(d)} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{d.full_name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                {d.organization}{specialtyOf(d) ? ` · ${specialtyOf(d)}` : ''}
              </div>
            </div>
            {(() => { const st = deriveVerificationStatus(d); return (
              <span className={'pill ' + VERIF_PILL[st]}>
                {st === 'verified' ? <ShieldCheck size={12} /> : st === 'rejected' || st === 'revoked' ? <Ban size={12} /> : <Clock size={12} />} {VERIF_LABEL[st]}
              </span>
            ) })()}
            <span className="pill p-neu" style={{ display: 'inline-flex', gap: 5 }}><ShoppingBag size={12} /> {orderCount[d.id] ?? 0}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
              Precios:
              <select value={d.price_list_id ?? ''} onChange={(e) => setPriceList(d.id, e.target.value || null)}
                style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 12, outline: 'none', backgroundColor: 'var(--cp-surface)' }}>
                <option value="">General (base)</option>
                {lists.filter((l) => !l.is_default).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <button className="btn ghost sm" type="button" onClick={() => setDetailId(d.id)}>Ver detalle</button>
            <button className="btn ghost sm" type="button" onClick={() => setEditDoc({ id: d.id, name: d.full_name ?? '', org: d.organization ?? '' })}><Pencil size={14} /> Editar</button>
            <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => setDelDoctor({ id: d.id, name: d.full_name ?? 'este doctor' })}><Trash2 size={14} /> Eliminar</button>
            {d.verified ? (
              <>
                <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setPedidoFor({ id: d.id, name: d.full_name ?? 'Doctor' })}>
                  <Plus size={14} /> Levantar pedido
                </button>
                <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => revoke(d.id)}>
                  <Ban size={14} /> Revocar
                </button>
              </>
            ) : cedulaOf(d) ? (
              <>
                {Object.keys(identityOf(d)?.evidence ?? {}).length > 0
                  ? <span className="pill p-warn" style={{ display: 'inline-flex', gap: 5 }}><ScanFace size={12} /> INE por revisar</span>
                  : <span className="pill p-neu" style={{ display: 'inline-flex', gap: 5 }}><IdCard size={12} /> Sin INE</span>}
                <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} title="Revisar y aprobar (vincula cliente)" onClick={() => setDetailId(d.id)}>
                  <UserCheck size={14} /> Revisar / Aprobar
                </button>
              </>
            ) : (
              <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} disabled title="Falta la cédula profesional" onClick={() => setDetailId(d.id)}>
                <UserCheck size={14} /> Falta cédula
              </button>
            )}
          </div>
        </div>
      ))}

      {detail && (
        <DoctorDetail
          doctor={detail}
          orders={orders.filter((o) => o.doctor_id === detail.id)}
          candidates={findCustomerCandidates(customers, { email: detail.email, phone: (detail.meta?.phone as string) ?? null, full_name: detail.full_name }, detail.id)}
          needsCustomer={orphans.some((o) => o.id === detail.id)}
          onClose={() => setDetailId(null)}
          onApprove={(choice) => approve(detail.id, choice)}
          onReject={(reason) => { reject(detail.id, reason); setDetailId(null) }}
          onRevoke={() => { revoke(detail.id); setDetailId(null) }}
          onSetCedula={(c) => setCedula(detail.id, c)}
          onInvite={() => inviteDoctor(detail.id)}
        />
      )}

      {pedidoFor && <NuevoPedido doctor={pedidoFor} placedBy="Administración" onClose={() => setPedidoFor(null)} />}
      {delDoctor && (
        <ConfirmModal
          title="Eliminar doctor"
          confirmLabel="Eliminar definitivamente"
          requireType="ELIMINAR"
          message={<>Vas a eliminar a <b>{delDoctor.name}</b>: perderá el acceso, se borra su cuenta y su historial. <b>Esta acción no se puede deshacer.</b></>}
          onConfirm={() => doDeleteDoctor(delDoctor.id)}
          onClose={() => setDelDoctor(null)}
        />
      )}
      {editDoc && (
        <EditDoctorModal
          initial={editDoc}
          onClose={() => setEditDoc(null)}
          onSave={(name, org) => { updateDoctor(editDoc.id, { full_name: name, organization: org }); setEditDoc(null) }}
        />
      )}
    </div>
  )
}

function EditDoctorModal({ initial, onClose, onSave }: { initial: { name: string; org: string }; onClose: () => void; onSave: (name: string, org: string) => void }) {
  const [name, setName] = useState(initial.name)
  const [org, setOrg] = useState(initial.org)
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead"><div><h3>Editar doctor</h3></div><button className="mclose" type="button" onClick={onClose}><X size={16} /></button></div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dra. / Dr. Nombre Apellido" autoFocus />
          <label style={label}>Clínica / organización</label>
          <input style={input} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Nombre de la clínica" />
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!name.trim()} style={!name.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onSave(name.trim(), org.trim())}>Guardar cambios</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Panel de identificación: las fotos del INE que subió el doctor (enlace firmado del bucket privado `proofs`). Una
// persona coteja nombre y foto con su registro y su cédula; el botón "Verificar doctor" del modal es el que aprueba.
const EVID_LABELS: Record<string, string> = { 'ine-front': 'INE · frente', 'ine-back': 'INE · reverso' }
function IdentityReview({ doctor }: { doctor: Profile }) {
  const id = identityOf(doctor)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const evidence = id?.evidence ?? {}
  const evidenceKey = JSON.stringify(evidence)
  useEffect(() => {
    let alive = true
    const entries = Object.entries(evidence).filter(([k]) => EVID_LABELS[k])
    if (entries.length === 0) { setUrls({}); return }
    Promise.all(entries.map(([k, path]) =>
      supabase.storage.from('proofs').createSignedUrl(path, 600).then((r) => [k, r.data?.signedUrl ?? ''] as const),
    )).then((res) => {
      if (!alive) return
      const m: Record<string, string> = {}
      res.forEach(([k, u]) => { if (u) m[k] = u })
      setUrls(m)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctor.id, evidenceKey])

  const fotos = ['ine-front', 'ine-back'].filter((k) => evidence[k])
  return (
    <div className="sysnote" data-testid="identificacion-ine" style={{ display: 'block', background: '#F7F8F5', color: 'var(--ink-2)', border: '1px solid var(--line)', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <IdCard size={16} style={{ color: 'var(--green-deep)' }} />
        <b style={{ fontSize: 13 }}>Identificación (INE)</b>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: fotos.length ? 10 : 0 }}>
        {fotos.length
          ? 'Coteja el nombre y la foto del INE con los datos del registro y la cédula antes de aprobar.'
          : 'Sin fotos del INE: pídeselas por el chat o que las suba en "Mi verificación" antes de aprobar.'}
      </div>
      {fotos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
          {fotos.map((k) => (
            <a key={k} href={urls[k] ?? undefined} target="_blank" rel="noopener" title={`Abrir ${EVID_LABELS[k]}`}
              style={{ display: 'block', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '8/5', position: 'relative' }}>
              {urls[k]
                ? <img src={urls[k]} alt={EVID_LABELS[k]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 11 }}>Cargando…</div>}
              <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 10.5, padding: '3px 6px', textAlign: 'center' }}>{EVID_LABELS[k]}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function DoctorDetail({
  doctor, orders, candidates, needsCustomer = false, onClose, onApprove, onReject, onRevoke, onSetCedula, onInvite,
}: {
  doctor: Profile
  orders: ReturnType<typeof useAllOrders>['data']
  candidates: CustomerCandidate[]
  needsCustomer?: boolean
  onClose: () => void
  onApprove: (choice: { customerId?: string; newCustomer?: CustomerFields }) => Promise<{ ok: boolean; error?: string }> | void
  onReject: (reason: string) => void
  onRevoke: () => void
  onSetCedula: (cedula: string) => void
  onInvite: () => void
}) {
  // doctor.verified puede cambiar mientras el modal está abierto; leemos del store vía prop.
  const history = orders.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  // Precargado con la cédula actual: mientras el doctor NO esté verificado se puede
  // CORREGIR una cédula mal capturada, no solo registrar la primera.
  const [ced, setCed] = useState(cedulaOf(doctor))
  const status = deriveVerificationStatus(doctor)
  const hasCedula = !!cedulaOf(doctor)
  // Resolución de identidad comercial (customer). '' sin elegir; '__new__' crear; otro = id.
  const linkable = candidates.filter((c) => !c.linkedToOther)
  const [choice, setChoice] = useState<string>(linkable.length === 1 && linkable[0].strong ? linkable[0].customer.id : '')
  const [rejectMode, setRejectMode] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Contacto del perfil por su RUTA REAL (meta.shipping → prospecto → legacy). Lo usan la ficha
  // y la creación del customer, para que ambos vean exactamente lo que el doctor capturó.
  const contacto = profileContact(doctor)

  // Preserva TODO el contexto comercial disponible (incl. el que viajó desde el prospecto en
  // doctor.meta.commercial): teléfono, ciudad, source, organización, notas y vendedor. NULL/'' no
  // fabrica valores; el seller queda como seller_profile_id en meta (no perdemos la atribución).
  const buildNewCustomer = (): CustomerFields => {
    const c = (doctor.meta?.commercial ?? {}) as Record<string, unknown>
    const meta: Record<string, unknown> = {}
    const org = doctor.organization ?? (c.organization as string) ?? null
    if (org) meta.organization = org
    if (c.notes) meta.notes = c.notes
    if (c.seller_profile_id) meta.seller_profile_id = c.seller_profile_id
    if (c.from_prospect) meta.from_prospect = c.from_prospect
    return {
      full_name: doctor.full_name ?? 'Doctor',
      email: doctor.email ?? null,
      // F2A: el alta guarda el contacto en meta.shipping.{phone,city}; leerlo por la ruta
      // canónica (con fallback prospecto/legacy) evita crear customers sin teléfono ni ciudad.
      phone: contacto.phone.value,
      city: contacto.city.value,
      source: (c.source as string) ?? 'portal',
      seller_name: (c.seller_name as string) ?? null,
      profile_id: doctor.id,
      meta,
    } as CustomerFields
  }

  const doApprove = async () => {
    setErr(null)
    // La cédula se exige para APROBAR (aún no verificado). Para vincular cliente a un orphan
    // ya verificado no se re-exige (solo completa su ficha comercial).
    if (!doctor.verified && !hasCedula) { setErr('Falta la cédula profesional (regístrala arriba) antes de aprobar.'); return }
    if (!choice) { setErr('Elige un cliente existente para vincular, o "Crear cliente nuevo".'); return }
    const payload = choice === '__new__' ? { newCustomer: buildNewCustomer() } : { customerId: choice }
    setBusy(true)
    try {
      const r = await onApprove(payload)
      if (r && !r.ok) { setErr(r.error ?? 'No se pudo aprobar.'); return }
      onClose()
    } catch (e) {
      setErr((e as Error)?.message ?? 'No se pudo aprobar.') // nunca dejar la UI colgada
    } finally {
      setBusy(false)
    }
  }
  const doReject = () => {
    setErr(null)
    if (!reason.trim()) { setErr('Escribe el motivo del rechazo.'); return }
    onReject(reason.trim())
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={doctor.full_name ?? '?'} url={avatarOf(doctor)} />
            <div>
              <h3>{doctor.full_name}</h3>
              <div className="ms">{doctor.organization}{specialtyOf(doctor) ? ` · ${specialtyOf(doctor)}` : ''}</div>
            </div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="form-grid-2" style={{ marginBottom: 14 }}>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Correo</div>{doctor.email}</div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Cédula</div>{(doctor.meta?.cedula as string) ?? '—'}</div>
            {/* F2A: el alta escribe meta.shipping.{phone,line1,city}; se lee por la ruta real
                (con fallback legacy) — antes mostraba "—" aunque el doctor sí los capturó. */}
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Teléfono</div>{contacto.phone.value ?? '—'}</div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Dirección</div>{contacto.address.value ? formatAddress(contacto.address.value) : '—'}</div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Estatus</div>
              <span className={'pill ' + VERIF_PILL[status]}>{VERIF_LABEL[status]}</span>
            </div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Pedidos</div>{history.length}</div>
          </div>
          {(status === 'rejected' || status === 'revoked') && (doctor.meta as { verification?: { reason?: string } } | null)?.verification?.reason && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10 }}>Motivo: {(doctor.meta as { verification?: { reason?: string } }).verification!.reason}</div>
          )}

          <IdentityReview doctor={doctor} />

          {!doctor.verified && (
            <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)', marginBottom: 14 }}>
              <Clock size={18} />
              <span>
                {cedulaOf(doctor)
                  ? 'No verificado: aún no puede ordenar en el Portal. Confirma la cédula profesional y verifícalo para habilitar su canal.'
                  : 'No verificado: falta la cédula profesional. Regístrala abajo para poder verificarlo.'}
              </span>
            </div>
          )}

          {!doctor.verified && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                value={ced}
                onChange={(e) => setCed(e.target.value)}
                placeholder="Cédula profesional"
                style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none' }}
              />
              <button className="btn sm" type="button" disabled={!ced.trim() || ced.trim() === cedulaOf(doctor)} style={(!ced.trim() || ced.trim() === cedulaOf(doctor)) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onSetCedula(ced.trim())}>{cedulaOf(doctor) ? 'Actualizar cédula' : 'Registrar cédula'}</button>
            </div>
          )}

          {(!doctor.verified || needsCustomer) && (
            <div style={{ marginBottom: 16 }}>
              <div className="eyebrow">Identidad comercial (cliente)</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
                Aprobar exige vincular a un cliente del directorio o crear uno nuevo. No se vincula por correo automáticamente.
              </div>
              {candidates.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 6 }}>No se encontraron clientes coincidentes.</div>
              )}
              {candidates.map((c) => (
                <label key={c.customer.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 6, opacity: c.linkedToOther ? 0.55 : 1 }}>
                  <input type="radio" name="cust-choice" disabled={c.linkedToOther} checked={choice === c.customer.id} onChange={() => setChoice(c.customer.id)} style={{ marginTop: 3 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{c.customer.full_name}</span>{c.strong && <span className="pill p-ok" style={{ marginLeft: 6, fontSize: 10.5 }}>coincidencia fuerte</span>}
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)' }}>
                      {c.customer.email ?? 's/correo'} · {c.customer.phone ?? 's/tel'} · coincide por {c.reasons.join(', ')}
                      {c.linkedToOther && ' · ya vinculado a otro portal'}
                    </span>
                  </span>
                </label>
              ))}
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', border: '1px dashed var(--line)', borderRadius: 10 }}>
                <input type="radio" name="cust-choice" checked={choice === '__new__'} onChange={() => setChoice('__new__')} />
                <span style={{ fontSize: 13 }}>Crear cliente nuevo con los datos del doctor</span>
              </label>
            </div>
          )}

          <div className="eyebrow">Historial de pedidos</div>
          {history.length === 0 ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Sin pedidos.</div>
          ) : (
            <table className="tbl-cards">
              <thead><tr><th>Folio</th><th>Estatus</th><th>Fecha</th><th>Total</th></tr></thead>
              <tbody>
                {history.map((o) => {
                  const sv = statusView(o.status)
                  return (
                    <tr key={o.id}>
                      <td data-label="Folio" className="mono">{o.external_ref}</td>
                      <td data-label="Estatus"><span className={'pill ' + sv.pill}>{sv.label}</span></td>
                      <td data-label="Fecha">{fmtDate(o.created_at)}</td>
                      <td data-label="Total" className="mono">{money(o.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {doctor.verified && (
            <div className="sysnote" style={{ marginTop: 4, marginBottom: 4, alignItems: 'center' }}>
              <span>
                {(doctor.meta?.accessPending as boolean)
                  ? 'Verificado. Acceso al Portal pendiente de activación (Fase 2): todavía no existe canal para que el doctor reciba/active su cuenta.'
                  : 'Verificado: puede comprar. La activación de su acceso al Portal se habilitará en la Fase 2.'}
              </span>
            </div>
          )}

          {err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
          {rejectMode && !doctor.verified && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo del rechazo"
                style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none' }} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {doctor.verified && needsCustomer ? (
              // Orphan tipo A (verificado sin cliente): resolver vinculando/creando su ficha.
              <>
                <button className="btn ghost" type="button" style={{ color: 'var(--danger)' }} onClick={onRevoke}><Ban size={15} /> Revocar acceso</button>
                <button className="btn" type="button" disabled={busy} onClick={doApprove}><UserCheck size={15} /> {busy ? 'Vinculando…' : 'Vincular cliente'}</button>
              </>
            ) : doctor.verified ? (
              <>
                <button className="btn ghost" type="button" disabled={Boolean(doctor.meta?.accessPending)} style={Boolean(doctor.meta?.accessPending) ? { opacity: 0.6 } : undefined} onClick={onInvite}>
                  <UserCheck size={15} /> {(doctor.meta?.accessPending as boolean) ? 'Acceso pendiente de activación' : 'Marcar acceso pendiente (Fase 2)'}
                </button>
                <button className="btn ghost" type="button" style={{ color: 'var(--danger)' }} onClick={onRevoke}><Ban size={15} /> Revocar acceso</button>
              </>
            ) : rejectMode ? (
              <>
                <button className="btn ghost" type="button" onClick={() => { setRejectMode(false); setErr(null) }}>Cancelar</button>
                <button className="btn" type="button" style={{ background: 'var(--danger)' }} onClick={doReject}><Ban size={15} /> Confirmar rechazo</button>
              </>
            ) : (
              <>
                <button className="btn ghost" type="button" style={{ color: 'var(--danger)' }} onClick={() => { setRejectMode(true); setErr(null) }}><Ban size={15} /> Rechazar</button>
                <button className="btn" type="button" disabled={busy} onClick={doApprove}><UserCheck size={15} /> {busy ? 'Aprobando…' : 'Aprobar doctor'}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
