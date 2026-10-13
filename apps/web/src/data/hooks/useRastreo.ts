// PAQ-A · Rastreo de la guía de un pedido: se pone al día al montar (el servidor decide si consulta a la paquetería)
// y expone `actualizar()` para forzarlo. Sin rastreo disponible ⇒ rastreo null (la pantalla no muestra nada).
import { useCallback, useEffect, useRef, useState } from 'react'
import { sincronizarRastreo, type Rastreo } from '../shipping/rastreo'

export function useRastreo(orderId: string | null, activo: boolean, alCerrar?: () => void, sincronizar: typeof sincronizarRastreo = sincronizarRastreo) {
  const [rastreo, setRastreo] = useState<Rastreo | null>(null)
  const [cargando, setCargando] = useState(false)
  const vivo = useRef(true)
  const cerrar = useRef(alCerrar); cerrar.current = alCerrar
  const pedir = useCallback(async (forzar: boolean) => {
    if (!orderId) return
    setCargando(true)
    const r = await sincronizar(orderId, { forzar })
    if (!vivo.current) return
    setCargando(false)
    if (r) { setRastreo(r); if (r.cierre === 'cerrado') cerrar.current?.() }
  }, [orderId, sincronizar])
  useEffect(() => { vivo.current = true; if (activo) void pedir(false); return () => { vivo.current = false } }, [activo, pedir])
  return { rastreo, cargando, actualizar: () => pedir(true) }
}
