// MI PERFIL — edición básica del propio usuario (no es red social): foto, nombre
// visible y contraseña. Mock: la foto/nombre viven en la sesión; la contraseña
// se confirma en falso. Con Supabase = update de auth + profiles.
import React, { useEffect, useState } from 'react'
import { X, Camera, Check } from 'lucide-react'
import { initials, avatarColor } from '../lib/format'
import { traducirError } from '../lib/errorMsg'
import { useRole } from '../auth/RoleContext'
import { uploadImage } from '../lib/uploads'
import { hasSupabase, supabase, currentUserId } from '../lib/supabase'
import { DeliveryLocationsManager } from '../app/DeliveryLocationsManager'
import { FiscalFields } from '../app/FiscalFields'
import { emptyFiscalProfile, normalizeFiscalProfile, validateFiscalProfile, type FiscalProfile } from '../data/ops/fiscal'
import { customerFiscal, upsertCustomerFiscal } from '../data/store/customersStore'

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, role, updateProfile } = useRole()
  const [name, setName] = useState(user?.name ?? '')
  const [avatar, setAvatar] = useState(user?.avatarUrl ?? '')
  const [uploading, setUploading] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Datos fiscales del doctor (para su CFDI). AUTORIDAD = customers.meta.fiscal (master omnicanal).
  // profiles.meta.fiscal solo se lee como fallback legacy de transición.
  const isDoctor = role === 'doctor'
  const [fiscal, setFiscal] = useState<FiscalProfile>(emptyFiscalProfile())
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [showFiscalErr, setShowFiscalErr] = useState(false)

  useEffect(() => {
    if (!isDoctor || !hasSupabase) return
    const uid = currentUserId(); if (!uid) return
    ;(async () => {
      // Master: el customer ligado a este perfil.
      const { data: cust } = await supabase.from('customers').select('id, meta').eq('profile_id', uid).maybeSingle()
      if (cust?.id) setCustomerId(cust.id)
      const master = customerFiscal(cust as { meta: unknown } | null)
      if (master.rfc || master.razon_social) { setFiscal(master); return }
      // Fallback legacy: profiles.meta.fiscal (para migración controlada del doctor al confirmar).
      const { data: prof } = await supabase.from('profiles').select('meta').eq('id', uid).single()
      const legacy = (prof?.meta as { fiscal?: unknown } | null)?.fiscal
      if (legacy) setFiscal(normalizeFiscalProfile(legacy))
    })()
  }, [isDoctor])

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  // Sube la foto a Storage y guarda su URL (persistente), no un data-URI temporal.
  const onFile = async (f: File | undefined) => {
    if (!f) return
    setUploading(true)
    const url = await uploadImage(f, 'avatars')
    setAvatar(url)
    setUploading(false)
  }

  const pwError = pw && pw !== pw2 ? 'Las contraseñas no coinciden.' : (pw && pw.length < 6 ? 'La contraseña debe tener al menos 6 caracteres.' : null)

  const save = async () => {
    if (pwError || busy || uploading) return
    setBusy(true); setError(null)
    // Cambio de contraseña REAL (Supabase Auth).
    if (pw && hasSupabase) {
      const { error: pErr } = await supabase.auth.updateUser({ password: pw })
      if (pErr) { setError(traducirError(pErr)); setBusy(false); return }
    }
    await updateProfile({ name: name.trim() || user?.name, avatarUrl: avatar || undefined })
    // Datos fiscales (opcionales): si el doctor capturó algo, se persiste en el MASTER
    // (customers.meta.fiscal) vía RPC. Si está incompleto, se bloquea y se marca el error.
    if (isDoctor) {
      const touched = Object.values(fiscal).some((v) => (v ?? '').toString().trim() !== '')
      if (touched) {
        if (!validateFiscalProfile(fiscal).ok) { setShowFiscalErr(true); setError('Revisa tus datos fiscales.'); setBusy(false); return }
        if (customerId) {
          const res = await upsertCustomerFiscal(customerId, fiscal)
          if (!res.ok) { setError(res.error ?? 'No se pudieron guardar los datos fiscales.'); setBusy(false); return }
        } else {
          // Sin customer ligado (caso legacy/transición): conserva en profiles.meta.fiscal.
          updateProfile({ fiscal: normalizeFiscalProfile(fiscal) as unknown as Record<string, string> })
        }
      }
    }
    setBusy(false)
    setToast(pw ? 'Perfil y contraseña actualizados.' : 'Perfil actualizado.')
    window.setTimeout(() => { setToast(null); onClose() }, 1100)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Mi perfil</h3><div className="ms">Edita lo básico de tu cuenta.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          {/* Foto */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {avatar
              ? <img src={avatar} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--line)' }} />
              : <div className="avatar" style={{ width: 64, height: 64, fontSize: 22, background: avatarColor(name || 'U') }}>{initials(name || 'U')}</div>}
            <label className="btn ghost sm" style={{ cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
              <Camera size={14} /> {uploading ? 'Subiendo…' : (avatar ? 'Cambiar foto' : 'Subir foto')}
              <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploading} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>

          <label style={label}>Nombre visible</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />

          {isDoctor && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Datos fiscales (para tu factura CFDI)</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>Los usamos solo al emitir tu factura. Opcional si no la necesitas.</div>
              <FiscalFields value={fiscal} onChange={setFiscal} showErrors={showFiscalErr} />
            </div>
          )}

          {isDoctor && <DeliveryLocationsManager />}

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Cambiar contraseña</div>
            <input style={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nueva contraseña" />
            <input style={input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirmar contraseña" />
            {pwError && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{pwError}</div>}
          </div>

          {error && <div className="sysnote" style={{ marginTop: 14, background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}><span>{error}</span></div>}
          {toast && <div className="sysnote" style={{ marginTop: 14 }}><Check size={16} /> <span>{toast}</span></div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={Boolean(pwError) || busy || uploading} style={(pwError || busy || uploading) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={save}>
              <Check size={15} /> {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
