// ENLACE-VENDEDOR · en la franja del chat: de dónde llegó esta persona (tu enlace, el de otro vendedor o la recomendación
// de un cliente). Solo lo ve quien puede ver la conversación; si no llegó por un enlace, no se muestra nada.
import React, { useEffect, useState } from 'react'
import { Heart, Link2 } from 'lucide-react'
import { origenConversacion as leerPorDefecto, type OrigenConversacion } from '../../data/ops/enlaces'
import { capitalizarNombre } from '../../lib/nombres'

export function textoOrigen(o: OrigenConversacion): string {
  if (o.tipo === 'referido') return `Recomendada por ${capitalizarNombre(o.recomienda ?? 'un cliente')}${o.es_tuyo ? ' (tu cliente)' : ''}`
  return o.es_tuyo ? 'Llegó por tu enlace' : `Llegó por el enlace de ${o.vendedor ?? 'otro vendedor'}`
}

export function OrigenChip({ conversationId, leer = leerPorDefecto }: { conversationId: string; leer?: typeof leerPorDefecto }) {
  const [o, setO] = useState<OrigenConversacion | null>(null)
  useEffect(() => { setO(null); let vivo = true; void leer(conversationId).then((x) => { if (vivo) setO(x) }); return () => { vivo = false } }, [conversationId, leer])
  if (!o) return null
  return (
    <div className={'rc-origen' + (o.tipo === 'referido' ? ' rc-origen--rec' : '')} data-testid="origen-conversacion">
      {o.tipo === 'referido' ? <Heart size={14} aria-hidden /> : <Link2 size={14} aria-hidden />} {textoOrigen(o)}
    </div>
  )
}
