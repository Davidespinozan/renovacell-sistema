// CHOFER EN EL MAPA · mientras el chofer está EN RUTA y tiene la app abierta, manda su ubicación (a lo más cada ~50 s o
// si se movió más de 150 m). Al salir de ruta o cerrar la pantalla, se detiene. Nunca frena al chofer.
import { useEffect, useRef, useState } from 'react'
import { ubicacionChofer } from '../ops/ubicacionChofer'

export type EstadoRastreo = 'apagado' | 'activo' | 'denegado' | 'no_disponible'
const api = ubicacionChofer()

function metros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function useRastreoRuta(enRuta: boolean, cadaMs = 50_000): EstadoRastreo {
  const [estado, setEstado] = useState<EstadoRastreo>('apagado')
  const ultimo = useRef<{ lat: number; lng: number; t: number } | null>(null)
  useEffect(() => {
    if (!enRuta) { setEstado('apagado'); return }
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setEstado('no_disponible'); return }
    let id: number | null = null
    const iniciar = () => {
      if (id != null) return
      id = navigator.geolocation.watchPosition(
        (p) => {
          setEstado('activo')
          const ahora = Date.now(), pos = { lat: p.coords.latitude, lng: p.coords.longitude }
          const u = ultimo.current
          if (u && ahora - u.t < cadaMs && metros(u, pos) < 150) return
          ultimo.current = { ...pos, t: ahora }
          void api.registrar({ lat: pos.lat, lng: pos.lng, precision: p.coords.accuracy })
        },
        (e) => setEstado(e.code === 1 ? 'denegado' : 'no_disponible'),
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
      )
    }
    const detener = () => { if (id != null) { navigator.geolocation.clearWatch(id); id = null } }
    const alCambiar = () => { if (document.visibilityState === 'visible') iniciar(); else detener() }
    iniciar()
    document.addEventListener('visibilitychange', alCambiar)
    return () => { detener(); document.removeEventListener('visibilitychange', alCambiar) }
  }, [enRuta, cadaMs])
  return estado
}
