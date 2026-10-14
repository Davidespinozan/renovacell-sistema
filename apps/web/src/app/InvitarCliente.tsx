// INVITACIONES · "Invitar a crear cuenta" desde la ficha del cliente (Dirección o su vendedor). Genera el enlace y
// deja mandarlo por WhatsApp, copiarlo o enviarlo por correo. La cuenta que se cree con él nace verificada.
import React, { useState } from 'react'
import { Copy, Mail, Send, UserPlus } from 'lucide-react'
import { crearInvitacion, whatsappInvitacion, TEXTO_CORREO, type InvitacionCreada } from '../data/ops/invitacion'

export function InvitarCliente({ customerId, crear = crearInvitacion }: { customerId: string; crear?: typeof crearInvitacion }) {
  const [inv, setInv] = useState<InvitacionCreada | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const generar = async (correo: boolean) => {
    if (ocupado) return
    setOcupado(true); setMsg(null)
    const r = await crear(customerId, { correo })
    setOcupado(false)
    if (!r.ok) { setMsg(r.mensaje); return }
    setInv(r.data); setMsg(TEXTO_CORREO[r.data.correo] || null)
  }
  const copiar = async () => {
    if (!inv) return
    try { await navigator.clipboard.writeText(inv.enlace); setCopiado(true); window.setTimeout(() => setCopiado(false), 2500) } catch { window.prompt('Copia el enlace:', inv.enlace) }
  }
  if (!inv) return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button type="button" className="btn sm" disabled={ocupado} onClick={() => void generar(false)} data-testid="btn-invitar"><UserPlus size={14} /> {ocupado ? 'Generando…' : 'Invitar a crear cuenta'}</button>
      {msg && <span role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>{msg}</span>}
    </span>
  )
  return (
    <div className="card" style={{ display: 'grid', gap: 8, padding: 12, width: '100%' }} data-testid="invitacion-lista">
      <div style={{ fontSize: 13 }}><b>Invitación lista.</b> Al crear su contraseña, {inv.nombre} entra ya verificado y ligado a su expediente. Vence en 14 días; generar otra anula esta.</div>
      <code className="mono" style={{ fontSize: 12, padding: '8px 10px', background: 'var(--hueso)', borderRadius: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.enlace}</code>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <a className="btn sm" href={whatsappInvitacion(inv.nombre, inv.enlace, inv.telefono)} target="_blank" rel="noreferrer" data-testid="invitar-whatsapp"><Send size={14} /> Enviar por WhatsApp</a>
        <button type="button" className="btn ghost sm" onClick={() => void copiar()} data-testid="invitar-copiar"><Copy size={14} /> {copiado ? 'Copiado' : 'Copiar enlace'}</button>
        <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void generar(true)} title="Genera una invitación nueva y la manda al correo del cliente" data-testid="invitar-correo"><Mail size={14} /> Enviar por correo</button>
      </div>
      {msg && <div role="status" style={{ fontSize: 12.5, color: inv.correo === 'enviado' ? 'var(--green-deep)' : 'var(--warn)' }} data-testid="invitar-aviso">{msg}</div>}
    </div>
  )
}
