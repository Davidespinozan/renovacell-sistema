// WA-PLANTILLAS (3 nov 2026) · el cliente escribió por WhatsApp hace más de 24 h: Meta solo deja mandarle una plantilla
// aprobada. Aquí el vendedor elige cuál (seguimiento, acceso a la app, promoción), ve cómo le llegará y la manda; cuando
// el cliente conteste, la plática sigue normal. Mientras Meta no apruebe ninguna: llamarle o abrir su propio WhatsApp.
import React, { useEffect, useState, useRef } from 'react'
import { MessageCircle, Phone, Send, X } from 'lucide-react'
import { plantillasWA as plantillasPorDefecto, vistaPrevia, type PlantillaWA, type PromoVigente } from '../../data/ops/plantillasWA'
import { primerNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'

export function RetomarWhatsApp({ conversationId, waId, nombreCliente, onEnviada, cliente: inyectado }: {
  conversationId: string; waId: string; nombreCliente: string | null; onEnviada: () => void; cliente?: ReturnType<typeof plantillasPorDefecto>
}) {
  const cliente = useRef(inyectado ?? plantillasPorDefecto()).current   // una instancia por montaje
  const [abierto, setAbierto] = useState(false)
  const [lista, setLista] = useState<PlantillaWA[] | null>(null)
  const [promos, setPromos] = useState<PromoVigente[]>([])
  const [elegida, setElegida] = useState<string | null>(null)
  const [promo, setPromo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  useEffect(() => {
    if (!abierto || lista) return
    void cliente.lista().then((r) => setLista((r ?? []).filter((p) => p.activa)))
    void cliente.promos().then(setPromos)
  }, [abierto, lista, cliente])
  const p = lista?.find((x) => x.nombre === elegida) ?? null
  const pm = promos.find((x) => x.promocion_id === promo) ?? null
  const valores: Partial<Record<string, string>> = { cliente: (nombreCliente && primerNombre(nombreCliente)) || undefined, vendedor: 'tu nombre', promocion: pm?.nombre, promocion_hasta: pm ? fmtDate(pm.hasta) : undefined }
  const faltaPromo = !!p?.variables.includes('promocion') && !pm
  const mandar = async () => {
    if (!p || faltaPromo) return
    setOcupado(true); setMsg(null)
    const r = await cliente.enviar(conversationId, p.nombre, pm?.promocion_id ?? null)
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    setMsg({ ok: true, texto: 'Plantilla enviada. Cuando conteste, sigue la plática aquí mismo.' }); setElegida(null); onEnviada()
  }
  const tel = waId.replace(/\D/g, '')
  return (
    <div className="rc-wa-retomar" data-testid="wa-retomar">
      <div className="rc-wa-retomar-acc">
        <button type="button" className="btn sm" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} data-testid="wa-retomar-abrir"><Send size={14} /> Retomar por WhatsApp</button>
        <a className="btn ghost sm" href={`tel:+${tel}`}><Phone size={14} /> Llamar</a>
        <a className="btn ghost sm" href={`https://wa.me/${tel}`} target="_blank" rel="noreferrer" title="Desde tu teléfono: lo que hablen ahí no queda en el sistema"><MessageCircle size={14} /> Abrir en mi WhatsApp</a>
      </div>
      {abierto && (
        <div className="rc-wa-plantillas" data-testid="wa-plantillas">
          <div className="rc-wa-plantillas-h"><b>Mensaje aprobado por WhatsApp</b><button type="button" className="rc-ico" aria-label="Cerrar" onClick={() => setAbierto(false)}><X size={16} /></button></div>
          {lista === null ? <small>Cargando…</small> : lista.length === 0 ? (
            <small data-testid="wa-sin-plantillas">Todavía no hay plantillas aprobadas por Meta. Mientras tanto, llámale o ábrelo en tu WhatsApp. Dirección las activa en WhatsApp → Plantillas.</small>
          ) : (
            <>
              <div className="pcl-tabs" role="radiogroup" aria-label="Plantilla">
                {lista.map((x) => <button key={x.nombre} type="button" role="radio" aria-checked={elegida === x.nombre} className={'pcl-tab' + (elegida === x.nombre ? ' on' : '')} onClick={() => setElegida(x.nombre)} data-testid={`wa-plantilla-${x.nombre}`}>{x.etiqueta}</button>)}
              </div>
              {p?.variables.includes('promocion') && (
                promos.length === 0 ? <small>No hay promociones vigentes.</small> : (
                  <select className="pc-campo" value={promo ?? ''} onChange={(e) => setPromo(e.target.value || null)} aria-label="Promoción" data-testid="wa-promo">
                    <option value="">Elige la promoción…</option>
                    {promos.map((x) => <option key={x.promocion_id} value={x.promocion_id}>{x.nombre} (hasta el {fmtDate(x.hasta)})</option>)}
                  </select>
                ))}
              {p && <div className="rc-wa-vista" data-testid="wa-vista">{vistaPrevia(p, valores)}</div>}
              {p?.botones && p.botones.length > 0 && <div className="rc-wa-botones">{p.botones.map((b) => <span key={b}>{b}</span>)}</div>}
              {p && <small>Se manda una sola vez cada 24 horas a este cliente. Meta cobra cada plantilla enviada.</small>}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn" disabled={!p || faltaPromo || ocupado} onClick={() => void mandar()} data-testid="wa-plantilla-mandar">{ocupado ? 'Mandando…' : 'Mandar'}</button>
              </div>
            </>
          )}
        </div>
      )}
      {msg && <div role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'rc-wa-ok' : 'rc-wa-err'} data-testid="wa-plantilla-msg">{msg.texto}</div>}
    </div>
  )
}
