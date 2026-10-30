// REFERIDOS (mig 20270211) · el cliente recomienda Renovacell desde su portal con SU enlace del chat: quien lo abre habla
// directo con el asesor de su cartera y queda registrado quién lo recomendó. En vez de pasar un número de WhatsApp.
import React, { useEffect, useState } from 'react'
import { Copy, Heart, Share2 } from 'lucide-react'
import { compartir, miEnlace as miEnlacePorDefecto, textoCompartir, urlDeEnlace, type MiEnlace } from '../../data/ops/enlaces'

export function Recomendar({ cargar = miEnlacePorDefecto }: { cargar?: () => Promise<MiEnlace | null> }) {
  const [e, setE] = useState<MiEnlace | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  useEffect(() => { let vivo = true; void cargar().then((x) => { if (vivo) setE(x) }); return () => { vivo = false } }, [cargar])
  if (!e || e.tipo !== 'referido') return null
  const url = urlDeEnlace(e.codigo)
  const texto = textoCompartir(e, url)
  const asesor = e.asesor?.primer_nombre
  const avisar = (t: string) => { setAviso(t); window.setTimeout(() => setAviso(null), 3000) }
  return (
    <section className="rh-recomendar" data-testid="doctor-recomendar" aria-label="Recomienda Renovacell">
      <div className="rh-rec-h">
        <span className="rh-rec-ico" aria-hidden><Heart size={18} /></span>
        <div><b>Recomienda Renovacell</b>
          <span>{asesor ? `Quien abra tu enlace habla directo con ${asesor}, tu asesor, y sabrá que vas de tu parte.` : 'Quien abra tu enlace habla directo con nuestro equipo y sabrá que vas de tu parte.'}</span></div>
      </div>
      <div className="rh-rec-previa" data-testid="doctor-recomendar-texto">{texto}</div>
      <div className="rh-rec-acc">
        <button type="button" className="btn" onClick={() => void compartir(texto, url).then((r) => { if (r === 'copiado') avisar('Mensaje copiado: pégalo en tu chat') })} data-testid="doctor-recomendar-compartir"><Share2 size={15} /> Compartir</button>
        <button type="button" className="btn ghost" onClick={() => void navigator.clipboard?.writeText(url).then(() => avisar('Enlace copiado'), () => window.prompt('Copia tu enlace:', url))} data-testid="doctor-recomendar-copiar"><Copy size={15} /> Copiar enlace</button>
        {aviso ? <span className="rh-rec-aviso" role="status">{aviso}</span>
          : e.cifras.contactos > 0 && <span className="rh-rec-aviso">{e.cifras.contactos} {e.cifras.contactos === 1 ? 'persona ya escribió' : 'personas ya escribieron'} de tu parte</span>}
      </div>
    </section>
  )
}
