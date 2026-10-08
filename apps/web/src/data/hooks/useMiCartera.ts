// CARTERA-P1 · Cartera del vendedor en sesión: ids de la asignación VIGENTE (por cliente y por perfil) y de la
// cartera histórica (Odoo). Se carga solo cuando hace falta (vendedor con el selector de cartera).
import { useEffect, useState } from 'react'
import { cartera as clientePorDefecto, type ClienteCartera } from '../ops/cartera'

export interface EstadoCartera {
  cargando: boolean
  error: string | null
  clientes: Set<string>      // customers.id asignados (vigente)
  perfiles: Set<string>      // profiles.id asignados (vigente)
  historicos: Set<string>    // customers.id por equivalencia histórica (Odoo)
  equivalencias: string[]    // nombres de Odoo equivalentes al vendedor
}
const VACIO: EstadoCartera = { cargando: false, error: null, clientes: new Set(), perfiles: new Set(), historicos: new Set(), equivalencias: [] }

export function useMiCartera(activo: boolean, cliente: ClienteCartera = clientePorDefecto): EstadoCartera {
  const [estado, setEstado] = useState<EstadoCartera>(activo ? { ...VACIO, cargando: true } : VACIO)
  useEffect(() => {
    if (!activo) { setEstado(VACIO); return }
    let vivo = true
    setEstado((e) => ({ ...e, cargando: true }))
    void Promise.all([cliente.miCartera(), cliente.miCarteraHistorica()]).then(([a, h]) => {
      if (!vivo) return
      const error = !a.ok ? a.error : !h.ok ? h.error : null
      setEstado({
        cargando: false, error,
        clientes: new Set(a.ok ? a.data.map((x) => x.customer_id).filter((x): x is string => !!x) : []),
        perfiles: new Set(a.ok ? a.data.map((x) => x.profile_id) : []),
        historicos: new Set(h.ok ? h.data.clientes.map((x) => x.customer_id) : []),
        equivalencias: h.ok ? h.data.equivalencias : [],
      })
    })
    return () => { vivo = false }
  }, [activo, cliente])
  return estado
}
