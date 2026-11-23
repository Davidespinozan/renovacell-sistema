// WHATSAPP A TODA LA CARTERA (15 nov 2026, dueño: «los vendedores deben poder mandar WhatsApp a todos los clientes que ya
// están en la base y aún no están en el portal»). La vendedora elige a un cliente de su cartera, escoge un mensaje aprobado
// por Meta (WhatsApp no deja escribir primero con texto libre), ve cómo le llega y lo manda. Queda en su conversación:
// cuando el cliente conteste, sigue la plática normal en Conversaciones.
import React, { useEffect, useRef, useState } from 'react'
import { Hoja } from '../../app/Hoja'
import { plantillasWA as plantillasPorDefecto, paraEscribir, vistaPrevia, type PlantillaWA, type PromoVigente } from '../../data/ops/plantillasWA'
import { primerNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'
import { useRoleOpcional } from '../../auth/RoleContext'

export function EscribirWhatsApp({ cliente: c, onCerrar, onListo, api: inyectada, sugerida }: {
  cliente: { id: string; nombre: string } | null
  onCerrar: () => void
  /** Ya quedó (o ya se puede escribir normal): la conversación de ese cliente. */
  onListo: (conversacion: string, ventanaAbierta: boolean) => void
  api?: ReturnType<typeof plantillasPorDefecto>
  /** PROSPECTAR · mensaje que se elige solo (p. ej. la presentación para un prospecto nuevo), si está aprobado. */
  sugerida?: string
}) {
  const api = useRef(inyectada ?? plantillasPorDefecto()).current
  const sesion = useRoleOpcional()
  const [lista, setLista] = useState<PlantillaWA[] | null>(null)
  const [promos, setPromos] = useState<PromoVigente[]>([])
  const [elegida, setElegida] = useState<string | null>(null)
  const [promo, setPromo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!c || lista) return
    void api.lista().then((r) => { const l = (r ?? []).filter(paraEscribir); setLista(l); const s = sugerida && l.find((x) => x.nombre === sugerida); if (s) setElegida(s.nombre); else if (l.length === 1) setElegida(l[0].nombre) })
    void api.promos().then(setPromos)
  }, [c, lista, api])
  useEffect(() => { setError(null) }, [c?.id])
  const p = lista?.find((x) => x.nombre === elegida) ?? null
  const pm = promos.find((x) => x.promocion_id === promo) ?? null
  const valores: Partial<Record<string, string>> = {
    cliente: (c && primerNombre(c.nombre)) || undefined, vendedor: primerNombre(sesion?.user?.name ?? '') || 'tu nombre',
    promocion: pm?.nombre, promocion_hasta: pm ? fmtDate(pm.hasta) : undefined,
  }
  const faltaPromo = !!p?.variables.includes('promocion') && !pm
  const mandar = async () => {
    if (!c || !p || faltaPromo) return
    setOcupado(true); setError(null)
    const r = await api.escribirCliente(c.id, p.nombre, pm?.promocion_id ?? null)
    setOcupado(false)
    if (!r.ok) { setError(r.mensaje); return }
    setElegida(null); setPromo(null)
    onListo(r.conversacion, r.ventanaAbierta)
  }
  return (
    <Hoja abierta={!!c} onCerrar={onCerrar} titulo={c ? `WhatsApp a ${c.nombre}` : ''} testid="escribir-wa"
      pie={<button type="button" className="btn" disabled={!p || faltaPromo || ocupado} onClick={() => void mandar()} data-testid="escribir-wa-mandar">{ocupado ? 'Mandando…' : 'Mandar por WhatsApp'}</button>}>
      {lista === null ? <small>Cargando…</small> : lista.length === 0 ? (
        <small data-testid="escribir-wa-sin">Todavía no hay mensajes aprobados por Meta. Dirección los manda a revisión en Conversaciones → Canales → WhatsApp → Plantillas.</small>
      ) : (
        <div className="escribir-wa">
          <small>WhatsApp solo deja escribirle primero con un mensaje aprobado. Cuando conteste, sigues la plática normal en Conversaciones.</small>
          <div className="pcl-tabs" role="radiogroup" aria-label="Mensaje">
            {lista.map((x) => <button key={x.nombre} type="button" role="radio" aria-checked={elegida === x.nombre} className={'pcl-tab' + (elegida === x.nombre ? ' on' : '')} onClick={() => setElegida(x.nombre)} data-testid={`escribir-wa-${x.nombre}`}>{x.etiqueta}</button>)}
          </div>
          {p?.variables.includes('promocion') && (
            promos.length === 0 ? <small>No hay promociones vigentes.</small> : (
              <select className="pc-campo" value={promo ?? ''} onChange={(e) => setPromo(e.target.value || null)} aria-label="Promoción" data-testid="escribir-wa-promo">
                <option value="">Elige la promoción…</option>
                {promos.map((x) => <option key={x.promocion_id} value={x.promocion_id}>{x.nombre} (hasta el {fmtDate(x.hasta)})</option>)}
              </select>
            ))}
          {p && <div className="dif-wa-burbuja" data-testid="escribir-wa-vista">{vistaPrevia(p, valores)}{p.botones && p.botones.length > 0 && <span className="dif-wa-botones">{p.botones.map((b) => <span key={b}>{b}</span>)}</span>}</div>}
          {p && <small>Una vez cada 24 horas por cliente. Meta cobra cada mensaje (aprox. $1 MXN).</small>}
        </div>
      )}
      {error && <div className="pc-msg" role="alert" data-testid="escribir-wa-error">{error}</div>}
    </Hoja>
  )
}
