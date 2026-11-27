// AVISOS AL CLIENTE, dentro de la venta (27 nov 2026, dueño: «en el sistema no hay manera de ver que se envió eso»).
// Lista lo que el sistema le mandó al cliente por ese pedido —WhatsApp y correo—: qué aviso, cuándo, a dónde (enmascarado)
// y, si no salió, por qué. Solo consulta: aquí no se manda ni se reintenta nada.
import React, { useEffect, useState } from 'react'
import { Icon } from './icons'
import { hasSupabase } from '../lib/supabase'
import { estadoAviso, leerAvisosDelPedido, nombreAviso, NOMBRE_CANAL, resumenAvisos, type AvisoPedido } from '../data/ops/avisosPedido'

const cuandoFmt = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mazatlan', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
const cuando = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : cuandoFmt.format(d) }

export function AvisosDelPedido({ orderId, leer = leerAvisosDelPedido }: { orderId: string; leer?: typeof leerAvisosDelPedido }) {
  const [avisos, setAvisos] = useState<AvisoPedido[] | null | undefined>(undefined)   // undefined = leyendo · null = no se pudo
  useEffect(() => {
    let vivo = true
    setAvisos(undefined)
    void leer(orderId).then((a) => { if (vivo) setAvisos(a) })
    return () => { vivo = false }
  }, [orderId, leer])

  if (!hasSupabase && leer === leerAvisosDelPedido) return null                   // modo demostración: no hay avisos que leer
  if (avisos === undefined) return null                                           // sin parpadeo mientras llega
  return (
    <div className="sysnote avisos-pedido" data-testid="avisos-pedido">
      <div className="avisos-pedido-cab"><b>Avisos al cliente</b>{avisos && avisos.length > 0 && <span data-testid="avisos-pedido-resumen"> · {resumenAvisos(avisos)}</span>}</div>
      {avisos === null && <div className="avisos-pedido-nota" data-testid="avisos-pedido-error">No se pudieron leer los avisos de este pedido. Cierra la venta y vuelve a abrirla.</div>}
      {avisos && avisos.length === 0 && <div className="avisos-pedido-nota" data-testid="avisos-pedido-vacio">A este cliente todavía no se le ha mandado ningún aviso de este pedido.</div>}
      {avisos && avisos.length > 0 && (
        <ul className="avisos-pedido-lista">
          {avisos.map((a, i) => {
            const e = estadoAviso(a)
            return (
              <li key={`${a.canal}-${a.aviso}-${i}`} className={`avisos-pedido-fila avisos-pedido-fila--${e.tono}`} data-testid="avisos-pedido-fila">
                <Icon name={a.canal === 'whatsapp' ? 'chat' : 'mail'} />
                <span className="avisos-pedido-que"><b>{nombreAviso(a.aviso)}</b> · {NOMBRE_CANAL[a.canal]}{a.destino ? ` a ${a.destino}` : ''}</span>
                <span className="avisos-pedido-estado">{e.texto}{e.tono !== 'no' && cuando(a.cuando) ? ` · ${cuando(a.cuando)}` : ''}{a.respondio ? ' · el cliente respondió' : ''}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
