// VERSIÓN PUBLICADA · si se publicó una versión nueva mientras la app estaba abierta, se avisa con discreción (sin recargar
// sola: alguien puede estar a media venta). Compara el commit con el que se compiló esta app con /version.json del sitio.
import React, { useEffect, useState } from 'react'

type Leer = () => Promise<string | null>
const leerPorDefecto: Leer = async () => {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const d = (await r.json()) as { commit?: unknown }
    return typeof d.commit === 'string' ? d.commit : null
  } catch { return null }
}

export function VersionNueva({ actual = __VERSION__, leer = leerPorDefecto, cadaMs = 10 * 60_000, recargar = () => window.location.reload() }: {
  actual?: string; leer?: Leer; cadaMs?: number; recargar?: () => void
}) {
  const [nueva, setNueva] = useState(false)
  const [oculto, setOculto] = useState(false)
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
  if (!nueva || oculto) return null
  return (
    <div className="version-nueva" role="status" data-testid="version-nueva">
      <span>Hay una versión nueva de Renovacell.</span>
      <button type="button" className="btn sm" onClick={recargar} data-testid="version-actualizar">Actualizar</button>
      <button type="button" className="rc-link" onClick={() => setOculto(true)}>Después</button>
    </div>
  )
}
