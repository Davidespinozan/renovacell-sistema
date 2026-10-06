// W6-A3.2 · Salud del sistema para la bandeja de Dirección. Una lectura al montar y otra
// cuando la pestaña vuelve a estar visible: sin sondeo. Cuatro estados, y un error de
// lectura NUNCA se confunde con "sano".
import { useCallback, useEffect, useState } from 'react'
import { leerSalud, esProblema, type Salud } from '../ops/salud'

export type EstadoHook =
  | { estado: 'loading' }
  | { estado: 'sin_backend' }
  | { estado: 'healthy'; salud: Salud }
  | { estado: 'unhealthy'; salud: Salud }
  | { estado: 'read_error'; error: string }

export function useSaludSistema(activo = true): EstadoHook & { reload: () => Promise<void> } {
  const [st, setSt] = useState<EstadoHook>({ estado: 'loading' })
  const reload = useCallback(async () => {
    const r = await leerSalud()
    if ('sinBackend' in r) { setSt({ estado: 'sin_backend' }); return }
    if (!r.ok) { setSt({ estado: 'read_error', error: r.error }); return }
    setSt(esProblema(r.data) ? { estado: 'unhealthy', salud: r.data } : { estado: 'healthy', salud: r.data })
  }, [])
  useEffect(() => {
    if (!activo) return
    let vigente = true
    const leer = () => { void leerSalud().then((r) => {
      if (!vigente) return
      if ('sinBackend' in r) setSt({ estado: 'sin_backend' })
      else if (!r.ok) setSt({ estado: 'read_error', error: r.error })
      else setSt(esProblema(r.data) ? { estado: 'unhealthy', salud: r.data } : { estado: 'healthy', salud: r.data })
    }) }
    leer()
    const alVolver = () => { if (document.visibilityState === 'visible') leer() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vigente = false; document.removeEventListener('visibilitychange', alVolver) }
  }, [activo])
  return { ...st, reload }
}
