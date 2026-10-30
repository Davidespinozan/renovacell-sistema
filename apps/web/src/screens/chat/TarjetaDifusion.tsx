// HERRAMIENTAS DEL VENDEDOR · difusión en el chat del portal: título, texto con enlaces, imagen y botón al enlace (un video
// va como enlace). Los mensajes del sistema no convierten enlaces; esta tarjeta sí.
import React from 'react'
import { ExternalLink, Megaphone } from 'lucide-react'
import { leerDifusion } from '../../data/ops/difusiones'
import { conEnlaces } from './ChatCanonico'

export function TarjetaDifusion({ content }: { content: string }) {
  const d = leerDifusion(content)
  if (!d) return <div className="rc-sys">{content}</div>
  return (
    <div className="rc-dif" data-testid="tarjeta-difusion">
      <div className="rc-dif-h"><Megaphone size={14} aria-hidden /> Renovacell</div>
      {d.imagen && <img className="rc-dif-img" src={d.imagen} alt="" loading="lazy" />}
      <div className="rc-dif-b">
        <b>{d.titulo}</b>
        {d.texto && <p>{conEnlaces(d.texto)}</p>}
        {d.enlace && <a className="rc-dif-btn" href={d.enlace} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden /> {/youtu|vimeo|video/i.test(d.enlace) ? 'Ver el video' : 'Ver más'}</a>}
      </div>
    </div>
  )
}
