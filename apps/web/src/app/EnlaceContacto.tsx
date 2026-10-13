// CX-ENLACE · Tarjeta del ENLACE DE CONTACTO para Dirección: el enlace único que se usa para promocionar a
// Renovacell en grupos, redes y anuncios. Explica qué es, a quién le llega cada conversación y deja copiarlo o
// compartirlo. El enlace es UNO (no hay enlaces por vendedor): quien lo comparte no decide quién atiende.
import React, { useState } from 'react'
import { Copy, ExternalLink, Link2, Send } from 'lucide-react'
import { urlEnlaceContacto } from '../data/ops/contactoEnlace'

export const TEXTO_COMPARTIR = 'Renovacell · Tecnologías Antiedad. Chatea con un asesor:'

export function EnlaceContacto({ url = urlEnlaceContacto() }: { url?: string }) {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); setCopiado(true); window.setTimeout(() => setCopiado(false), 2500) }
    catch { window.prompt('Copia el enlace de contacto:', url) }
  }
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${TEXTO_COMPARTIR} ${url}`)}`
  return (
    <div className="card" data-testid="enlace-contacto" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link2 size={18} style={{ color: 'var(--green-deep)', flex: 'none' }} />
        <div style={{ fontWeight: 700 }}>Enlace de contacto</div>
        <span className="pill p-ok" style={{ marginLeft: 'auto' }}>Para promoción</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        Es el enlace oficial para promocionar a Renovacell: mándalo en grupos, redes, anuncios o tarjetas. Quien lo abre deja su nombre, celular y correo y <b>chatea directo con nosotros</b>, sin tener que registrarse antes.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <code className="mono" data-testid="enlace-contacto-url" style={{ flex: '1 1 240px', minWidth: 0, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--hueso)', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</code>
        <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => void copiar()} data-testid="enlace-contacto-copiar"><Copy size={15} /> {copiado ? 'Copiado' : 'Copiar'}</button>
        <a className="btn ghost" style={{ minHeight: 40 }} href={whatsapp} target="_blank" rel="noreferrer" data-testid="enlace-contacto-whatsapp"><Send size={15} /> Compartir por WhatsApp</a>
        <a className="btn ghost" style={{ minHeight: 40 }} href={url} target="_blank" rel="noreferrer" title="Con tu sesión abierta verás un aviso; para verlo como cliente usa una ventana de incógnito."><ExternalLink size={15} /> Abrir</a>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        <li>Es <b>un solo enlace para todos</b>: no hay uno por vendedor, y quien lo comparte no decide quién atiende.</li>
        <li>Si los datos coinciden con un cliente que ya tiene vendedor, la conversación le llega a <b>ese vendedor</b>, marcada como posible cliente sin confirmar.</li>
        <li>Si no coincide con nadie, te llega <b>a ti (Dirección)</b> para que le asignes vendedor aquí, en Pendientes.</li>
        <li>Cada contacto queda como prospecto con origen "Enlace de contacto".</li>
      </ul>
    </div>
  )
}
