// HORA DE SALIDA · la hora de corte de paquetería (Configuración → Regla de entrega), leída una vez por sesión.
import { useEffect, useState } from 'react'
import { CORTE_POR_DEFECTO, verConfigEntrega } from '../ops/entrega'

let conocido: string | null = null
let pidiendo: Promise<string> | null = null
export function useCorteEntrega(): string {
  const [corte, setCorte] = useState(conocido ?? CORTE_POR_DEFECTO)
  useEffect(() => {
    if (conocido) return
    let vivo = true
    pidiendo ??= verConfigEntrega().then((r) => (r.ok && /^\d{1,2}:\d{2}/.test(r.data.corte ?? '') ? r.data.corte.slice(0, 5) : CORTE_POR_DEFECTO), () => CORTE_POR_DEFECTO)
    void pidiendo.then((c) => { conocido = c; if (vivo) setCorte(c) })
    return () => { vivo = false }
  }, [])
  return corte
}
