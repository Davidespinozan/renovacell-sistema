// Recuadro para tomar o subir una foto (INE frente o reverso). Reemplaza al "Choose File / No file chosen" del
// navegador: un recuadro con ícono de cámara que, ya con foto, muestra la miniatura y deja cambiarla.
import React, { useRef } from 'react'
import { Camera, RefreshCw } from 'lucide-react'

export function FotoIne({ etiqueta, ayuda, valor, onArchivo, testId }: { etiqueta: string; ayuda?: string; valor: string | null; onArchivo: (f: File) => void; testId?: string }) {
  const input = useRef<HTMLInputElement | null>(null)
  return (
    <div className={'rc-foto' + (valor ? ' rc-foto--lista' : '')}>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden aria-label={etiqueta} data-testid={testId}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onArchivo(f); e.target.value = '' }} />
      <button type="button" className="rc-foto-boton" onClick={() => input.current?.click()} aria-label={valor ? `Cambiar foto: ${etiqueta}` : `Tomar foto: ${etiqueta}`}>
        {valor ? (
          <>
            <img src={valor} alt={etiqueta} className="rc-foto-img" />
            <span className="rc-foto-cambiar"><RefreshCw size={13} /> Cambiar</span>
          </>
        ) : (
          <>
            <Camera size={26} className="rc-foto-ico" aria-hidden />
            <span className="rc-foto-titulo">{etiqueta}</span>
            <span className="rc-foto-ayuda">{ayuda ?? 'Toca para tomar la foto'}</span>
          </>
        )}
      </button>
    </div>
  )
}
