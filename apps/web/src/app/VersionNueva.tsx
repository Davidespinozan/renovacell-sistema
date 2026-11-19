// VERSIÓN PUBLICADA · si se publicó una versión nueva mientras la app estaba abierta, la app SE ACTUALIZA SOLA en un
// momento seguro (dueño, 19 nov 2026: «¿no se puede hacer que el sistema recargue solo?»):
//   · al REGRESAR a la app (cambió de pestaña, bloqueó el teléfono, volvió), si no dejó nada a medio escribir;
//   · o tras 1 minuto sin tocar nada, sin ventanas abiertas y sin nada escrito en un campo.
// Si está trabajando (escribiendo, con una ventana abierta), NO recarga: muestra el aviso y espera. Compara el commit con
// el que se compiló esta app con /version.json del sitio.
import React, { useEffect, useRef, useState } from 'react'

type Leer = () => Promise<string | null>
const leerPorDefecto: Leer = async () => {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const d = (await r.json()) as { commit?: unknown }
    return typeof d.commit === 'string' ? d.commit : null
  } catch { return null }
}

/** ¿Hay algo a medio hacer? Una ventana abierta o texto escrito en un campo (los buscadores no cuentan). */
export function hayTrabajoAbierto(doc: Document = document): boolean {
  if (doc.querySelector('.overlay, .modal, [role=dialog], .hoja-fondo, [data-testid$="-hoja"]')) return true
  const campos = Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type=text], input[type=number], input[type=email], input[type=tel], input:not([type])'))
  return campos.some((c) => {
    if (!c.value || !c.value.trim()) return false
    const ph = (c.getAttribute('placeholder') ?? '') + ' ' + (c.getAttribute('aria-label') ?? '')
    return !/buscar|filtrar/i.test(ph)
  })
}

export function VersionNueva({ actual = __VERSION__, leer = leerPorDefecto, cadaMs = 2 * 60_000, quietoMs = 60_000, recargar = () => window.location.reload(), trabajoAbierto = hayTrabajoAbierto }: {
  actual?: string; leer?: Leer; cadaMs?: number; quietoMs?: number; recargar?: () => void; trabajoAbierto?: () => boolean
}) {
  const [nueva, setNueva] = useState(false)
  const [oculto, setOculto] = useState(false)
  const ultimoToque = useRef(Date.now())
  const recargando = useRef(false)

  // 1) ¿Hay versión nueva? (cada 2 min y al volver a la app)
  useEffect(() => {
    if (!actual || actual === 'desconocida') return
    let vivo = true
    const revisar = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const publicada = await leer()
      if (vivo && publicada && publicada !== actual) setNueva(true)
    }
    void revisar()
    const t = setInterval(() => void revisar(), cadaMs)
    const alVolver = () => { if (document.visibilityState === 'visible') void revisar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [actual, leer, cadaMs])

  // 2) Con versión nueva: recargar sola en el primer momento seguro.
  useEffect(() => {
    if (!nueva) return
    const tocar = () => { ultimoToque.current = Date.now() }
    const intentar = (motivo: 'volvio' | 'quieto') => {
      if (recargando.current || trabajoAbierto()) return
      if (motivo === 'quieto' && Date.now() - ultimoToque.current < quietoMs) return
      recargando.current = true
      recargar()
    }
    const alVolver = () => { if (document.visibilityState === 'visible') intentar('volvio') }
    const ev = ['pointerdown', 'keydown', 'input', 'scroll', 'touchstart'] as const
    ev.forEach((e) => window.addEventListener(e, tocar, { passive: true, capture: true }))
    document.addEventListener('visibilitychange', alVolver)
    const t = setInterval(() => intentar('quieto'), 15_000)
    return () => { ev.forEach((e) => window.removeEventListener(e, tocar, { capture: true })); document.removeEventListener('visibilitychange', alVolver); clearInterval(t) }
  }, [nueva, quietoMs, recargar, trabajoAbierto])

  if (!nueva || oculto) return null
  return (
    <div className="version-nueva" role="status" data-testid="version-nueva">
      <span>Hay una versión nueva: se actualiza sola en cuanto termines lo que estás haciendo.</span>
      <button type="button" className="btn sm" onClick={recargar} data-testid="version-actualizar">Actualizar ahora</button>
      <button type="button" className="rc-link" onClick={() => setOculto(true)}>Ocultar</button>
    </div>
  )
}
