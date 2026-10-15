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
    // REORG CRM · compacto: una fila con el enlace y sus botones; la explicación va plegada (sigue en el DOM para quien la busca).
    <div className="card" data-testid="enlace-contacto" style={{ display: 'grid', gap: 8, padding: '10px 14px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link2 size={16} style={{ color: 'var(--green-deep)', flex: 'none' }} />
        <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>Enlace de contacto</div>
        <code className="mono" data-testid="enlace-contacto-url" style={{ flex: '1 1 220px', minWidth: 0, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--hueso)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</code>
        <button type="button" className="btn sm" style={{ minHeight: 36 }} onClick={() => void copiar()} data-testid="enlace-contacto-copiar"><Copy size={14} /> {copiado ? 'Copiado' : 'Copiar'}</button>
        <a className="btn ghost sm" style={{ minHeight: 36 }} href={whatsapp} target="_blank" rel="noreferrer" data-testid="enlace-contacto-whatsapp"><Send size={14} /> Compartir por WhatsApp</a>
        <a className="btn ghost sm" style={{ minHeight: 36 }} href={url} target="_blank" rel="noreferrer" title="Con tu sesión abierta verás un aviso; para verlo como cliente usa una ventana de incógnito."><ExternalLink size={14} /> Abrir</a>
      </div>
      <details style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--ink-2)' }}>¿Para qué sirve y a quién le llega?</summary>
        <div style={{ marginTop: 6 }}>Es el enlace oficial para promocionar a Renovacell: mándalo en grupos, redes, anuncios o tarjetas. Quien lo abre deja su nombre, celular y correo y <b>chatea directo con nosotros</b>, sin tener que registrarse antes.</div>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>Es <b>un solo enlace para todos</b>: no hay uno por vendedor, y quien lo comparte no decide quién atiende.</li>
          <li>Si los datos coinciden con un cliente que ya tiene vendedor, la conversación le llega a <b>ese vendedor</b>, marcada como posible cliente sin confirmar.</li>
          <li>Si no coincide con nadie, te llega <b>a ti (Dirección)</b> para que le asignes vendedor aquí, en Solicitudes.</li>
          <li>Cada contacto queda como lead con origen "Enlace de contacto".</li>
        </ul>
      </details>
    </div>
  )
}
