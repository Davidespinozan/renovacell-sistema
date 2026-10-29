// Hook de ubicaciones de entrega (Fase 1). Carga las ubicaciones del doctor (propias o, para
// admin/ventas, las de un doctorId dado) y expone las operaciones del data layer.
import { useCallback, useEffect, useState } from 'react'
import type { DoctorLocation } from '../ops/doctorLocation'
import { listDoctorLocations, createDoctorLocation, updateDoctorLocation, deactivateDoctorLocation, setDefaultDoctorLocation } from '../store/doctorLocationsStore'

export function useDoctorLocations(doctorId?: string) {
  const [data, setData] = useState<DoctorLocation[]>([])
  // Nace cargando: la primera carga sale en el efecto, y quien preselecciona (el selector del checkout) no debe
  // decidir con la lista vacía de antes de que llegue la respuesta.
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try { setData(await listDoctorLocations(doctorId)) } finally { setLoading(false) }
  }, [doctorId])

  useEffect(() => { void reload() }, [reload])

  return {
    data, loading, reload,
    createDoctorLocation, updateDoctorLocation, deactivateDoctorLocation, setDefaultDoctorLocation,
  }
}
