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

// PANTALLA ENCENDIDA (21 nov 2026) · el GPS de una app web se detiene cuando la pantalla se apaga sola. Mientras el chofer
// está en ruta se le pide al navegador que no apague la pantalla (como Waze). El chofer lo puede desactivar.
const CLAVE_PANTALLA = 'rc_ruta_pantalla_encendida'
export function leerPantallaEncendida(): boolean { try { return localStorage.getItem(CLAVE_PANTALLA) !== 'no' } catch { return true } }
export function guardarPantallaEncendida(v: boolean): void { try { localStorage.setItem(CLAVE_PANTALLA, v ? 'si' : 'no') } catch { /* sin almacenamiento */ } }
type Bloqueo = { release: () => Promise<void> }
type ConWakeLock = { wakeLock?: { request: (t: 'screen') => Promise<Bloqueo> } }

/** Mantiene la pantalla encendida mientras `activo` y la app esté a la vista. Devuelve si el navegador lo soporta. */
export function usePantallaEncendida(activo: boolean): boolean {
  const soportado = typeof navigator !== 'undefined' && !!(navigator as unknown as ConWakeLock).wakeLock
  useEffect(() => {
    if (!activo || !soportado) return
    let bloqueo: Bloqueo | null = null, vivo = true
    const pedir = async () => {
      if (document.visibilityState !== 'visible' || bloqueo) return
      try { const b = await (navigator as unknown as ConWakeLock).wakeLock!.request('screen'); if (vivo) bloqueo = b; else void b.release() } catch { /* sin permiso o batería baja: se ignora */ }
    }
    const alCambiar = () => { if (document.visibilityState === 'visible') { bloqueo = null; void pedir() } }
    void pedir()
    document.addEventListener('visibilitychange', alCambiar)
    return () => { vivo = false; document.removeEventListener('visibilitychange', alCambiar); if (bloqueo) void bloqueo.release().catch(() => {}); bloqueo = null }
  }, [activo, soportado])
  return soportado
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
  // GPS EN LA ENTREGA (23 nov 2026) · la oficina se entera si el chofer en ruta trae la ubicación bloqueada o sin señal.
  const reportado = useRef<string | null>(null)
  useEffect(() => {
    if (estado === 'apagado' || reportado.current === estado) return
    reportado.current = estado
    void api.reportarGps(estado)
  }, [estado])
  return estado
}
