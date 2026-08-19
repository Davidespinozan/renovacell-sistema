// Hook de configuración de empresa (emisor CFDI + identidad). Lo lee cualquier pantalla que
// muestre al emisor (recibos, manifiestos); solo Dirección lo edita en Configuración.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, saveCompany, type CompanySettings } from '../store/companyStore'

export function useCompany() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { company: data[0], saveCompany }
}

export type { CompanySettings }
