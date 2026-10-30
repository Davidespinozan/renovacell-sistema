// CX-ENLACE → ENLACE-VENDEDOR · enlaces del chat de Renovacell. Cada vendedor tiene el SUYO (renovacell.mx/contacto/
// roberto-ibarra): lo manda en sus canales y quien llega por él lo atiende él, salvo que ya sea cliente de cartera de otro
// (gana la cartera). Dirección ve el enlace general y el de cada vendedor con sus cifras. Todo es el chat propio, no WhatsApp.
import React, { useEffect, useState } from 'react'
import { Copy, ExternalLink, Link2, Share2 } from 'lucide-react'
import { urlEnlaceContacto } from '../data/ops/contactoEnlace'
import { compartir, enlacesEquipo, miEnlace, textoCompartir, urlDeEnlace, type EnlaceEquipo, type MiEnlace } from '../data/ops/enlaces'
import { useRoleOpcional } from '../auth/RoleContext'

export const TEXTO_COMPARTIR = 'Renovacell · Tecnologías Antiedad. Chatea con un asesor:'

function useCopiar() {
  const [copiado, setCopiado] = useState<string | null>(null)
  const copiar = async (texto: string, clave = 'x') => {
    try { await navigator.clipboard.writeText(texto); setCopiado(clave); window.setTimeout(() => setCopiado(null), 2500) }
    catch { window.prompt('Copia el enlace:', texto) }
  }
  return { copiado, copiar }
}
const cifrasTexto = (c: { visitas: number; contactos: number; cuentas: number }) =>
  `${c.visitas} ${c.visitas === 1 ? 'visita' : 'visitas'} · ${c.contactos} ${c.contactos === 1 ? 'contacto' : 'contactos'} · ${c.cuentas} con cuenta`

/** El enlace del vendedor con sesión (o null si no aplica). */
export function useMiEnlace(activo: boolean): MiEnlace | null {
  const [e, setE] = useState<MiEnlace | null>(null)
  useEffect(() => { if (activo) void miEnlace().then(setE) }, [activo])
  return e
}

// Barra del encabezado de Conversaciones: el vendedor tiene a la mano SU enlace; Dirección, el general.
export function EnlaceContactoBotones({ url: urlFija }: { url?: string }) {
  const rol = useRoleOpcional()
  const esVendedor = rol?.role === 'pos'
  const mio = useMiEnlace(esVendedor && !urlFija)
  const { copiado, copiar } = useCopiar()
  const [aviso, setAviso] = useState<string | null>(null)
  const url = urlFija ?? (mio ? urlDeEnlace(mio.codigo) : urlEnlaceContacto())
  const texto = mio ? textoCompartir(mio, url, rol?.user?.name ?? null) : `${TEXTO_COMPARTIR} ${url}`
  return (
    <span className="enlace-barra" data-testid="enlace-contacto-barra"
      title={mio ? `Tu enlace: ${url}. Quien llega por él lo atiendes tú (salvo que ya sea cliente de otro vendedor). ${cifrasTexto(mio.cifras)}.` : `Enlace de contacto: ${url}. Quien lo abre conversa con nosotros; llega a su vendedor o a Dirección.`}>
      <span className="enlace-barra-et"><Link2 size={15} aria-hidden /> {mio ? 'Tu enlace' : 'Enlace de contacto'}{mio && <small className="enlace-barra-cifras" data-testid="mi-enlace-cifras">{mio.cifras.contactos} {mio.cifras.contactos === 1 ? 'contacto' : 'contactos'}</small>}</span>
      <button type="button" onClick={() => void copiar(url)} data-testid="copiar-enlace"><Copy size={14} /> {copiado ? 'Copiado' : 'Copiar'}</button>
      <button type="button" onClick={() => void compartir(texto, url).then((r) => { if (r === 'copiado') { setAviso('Mensaje copiado: pégalo donde quieras'); window.setTimeout(() => setAviso(null), 3000) } })} data-testid="compartir-enlace"><Share2 size={14} /> {aviso ? 'Copiado' : 'Compartir'}</button>
    </span>
  )
}

export function EnlaceContacto({ url = urlEnlaceContacto() }: { url?: string }) {
  const { copiado, copiar } = useCopiar()
  const [equipo, setEquipo] = useState<EnlaceEquipo[] | null>(null)
  useEffect(() => { void enlacesEquipo().then(setEquipo) }, [])
  return (
    <div className="card" data-testid="enlace-contacto" style={{ display: 'grid', gap: 8, padding: '10px 14px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link2 size={16} style={{ color: 'var(--green-deep)', flex: 'none' }} />
        <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>Enlace general</div>
        <code className="mono" data-testid="enlace-contacto-url" style={{ flex: '1 1 220px', minWidth: 0, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--hueso)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</code>
        <button type="button" className="btn sm" style={{ minHeight: 36 }} onClick={() => void copiar(url, 'general')} data-testid="enlace-contacto-copiar"><Copy size={14} /> {copiado === 'general' ? 'Copiado' : 'Copiar'}</button>
        <a className="btn ghost sm" style={{ minHeight: 36 }} href={url} target="_blank" rel="noreferrer" title="Con tu sesión abierta verás un aviso; para verlo como cliente usa una ventana de incógnito."><ExternalLink size={14} /> Abrir</a>
      </div>
      {equipo && equipo.length > 0 && (
        <div className="enlace-equipo" data-testid="enlaces-equipo">
          <div className="enlace-equipo-h">Enlace de cada vendedor</div>
          {equipo.map((e) => {
            const u = urlDeEnlace(e.codigo, url)
            return (
              <div key={e.seller} className="enlace-equipo-fila">
                <span className="enlace-equipo-tx"><b>{e.nombre}</b><small className="mono">{u.replace(/^https?:\/\//, '')}</small></span>
                <span className="enlace-equipo-cif">{cifrasTexto(e.cifras)}</span>
                <button type="button" className="btn ghost sm" onClick={() => void copiar(u, e.seller)}><Copy size={13} /> {copiado === e.seller ? 'Copiado' : 'Copiar'}</button>
              </div>
            )
          })}
        </div>
      )}
      <details style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--ink-2)' }}>¿A quién le llega cada conversación?</summary>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>Cada vendedor tiene <b>su propio enlace</b>: quien llega por él lo atiende ese vendedor y el prospecto queda en su cartera al verificarse.</li>
          <li>Cada cliente puede <b>recomendar</b> Renovacell desde su portal: su enlace lleva al vendedor de su cartera y queda quién recomendó.</li>
          <li>Si quien llega ya es cliente de otro vendedor, <b>gana la cartera</b>: le llega a su vendedor de siempre y al del enlace se le avisa.</li>
          <li>Por el enlace general: si coincide con un cliente, a su vendedor; si no, se reparte o te llega a ti para asignarlo.</li>
        </ul>
      </details>
    </div>
  )
}
