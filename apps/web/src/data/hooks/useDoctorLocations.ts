// Hook de ubicaciones de entrega (Fase 1). Carga las ubicaciones del doctor (propias o, para
// admin/ventas, las de un doctorId dado) y expone las operaciones del data layer.
import { useCallback, useEffect, useState } from 'react'
import type { DoctorLocation } from '../ops/doctorLocation'
import { listDoctorLocations, createDoctorLocation, updateDoctorLocation, deactivateDoctorLocation, setDefaultDoctorLocation } from '../store/doctorLocationsStore'

export function useDoctorLocations(doctorId?: string) {
  const [data, setData] = useState<DoctorLocation[]>([])
  const [loading, setLoading] = useState(false)

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
