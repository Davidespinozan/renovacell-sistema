// VERSIÓN PUBLICADA · si se publicó una versión nueva mientras la app estaba abierta, la app SE ACTUALIZA SOLA en un
// momento seguro (dueño, 19 nov 2026: «¿no se puede hacer que el sistema recargue solo?»).
// 23 nov 2026 (dueño: «cada vez que estás en la página se actualiza sola»): ya NUNCA recarga mientras la persona está en
// la pantalla (antes recargaba tras 1 minuto sin tocar nada, p. ej. leyendo una conversación). Solo al REGRESAR a la app
// después de haberse ido un rato (≥ 2 min fuera: cambió de app/pestaña o bloqueó el teléfono) y si no dejó nada a medio
// escribir. Mientras tanto, aviso con «Actualizar ahora». Compara el commit compilado con /version.json del sitio.
// 23 nov 2026 (noche, dueño: «la página se actualiza sola»): el día del arranque hubo ~25 publicaciones y bastaba irse
// 2 min (contestar WhatsApp) para que al regresar recargara. Ahora solo tras ≥ 30 min fuera; si no, el aviso y ya.
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

export function VersionNueva({ actual = __VERSION__, leer = leerPorDefecto, cadaMs = 2 * 60_000, fueraMs = 30 * 60_000, recargar = () => window.location.reload(), trabajoAbierto = hayTrabajoAbierto }: {
  actual?: string; leer?: Leer; cadaMs?: number; fueraMs?: number; recargar?: () => void; trabajoAbierto?: () => boolean
}) {
  const [nueva, setNueva] = useState(false)
  const [oculto, setOculto] = useState(false)
  const seFue = useRef<number | null>(null)
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

  // 2) Con versión nueva: recargar SOLO al regresar tras haberse ido ≥ fueraMs y sin trabajo a medio hacer.
  useEffect(() => {
    if (!nueva) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') seFue.current = Date.now()
    const alCambiar = () => {
      if (document.visibilityState === 'hidden') { seFue.current = Date.now(); return }
      const fuera = seFue.current == null ? 0 : Date.now() - seFue.current
      seFue.current = null
      if (recargando.current || fuera < fueraMs || trabajoAbierto()) return
      recargando.current = true
      recargar()
    }
    document.addEventListener('visibilitychange', alCambiar)
    return () => document.removeEventListener('visibilitychange', alCambiar)
  }, [nueva, fueraMs, recargar, trabajoAbierto])

  if (!nueva || oculto) return null
  return (
    <div className="version-nueva" role="status" data-testid="version-nueva">
      <span>Hay una versión nueva del sistema. Actualiza cuando termines lo que estás haciendo.</span>
      <button type="button" className="btn sm" onClick={recargar} data-testid="version-actualizar">Actualizar ahora</button>
      <button type="button" className="rc-link" onClick={() => setOculto(true)}>Ocultar</button>
    </div>
  )
}
