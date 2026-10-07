// CHV2-B · Deduplicación de PRESENTACIÓN de alertas entre pestañas del mismo navegador. Una señal en
// vivo llega a todas las pestañas abiertas; solo UNA (la visible que la reclama primero) la muestra, y
// descartarla en una la quita de las demás. Es solo presentación: la idempotencia de los avisos la
// garantiza la base (event_key único) y descartar NO resuelve el trabajo.
// localStorage + BroadcastChannel, ambos opcionales (try/catch): sin ellos, cada pestaña decide sola.
const PREFIJO = 'rc-aviso:'
const CANAL = 'rc-avisos-comerciales'
const VIGENCIA_MS = 12 * 60 * 60_000

export type EstadoPresentacion = 'visto' | 'descartado' | 'atendido'
type Registro = { e: EstadoPresentacion; t: number }

function leer(clave: string): Registro | null {
  try {
    const v = localStorage.getItem(PREFIJO + clave)
    if (!v) return null
    const r = JSON.parse(v) as Registro
    return Date.now() - r.t > VIGENCIA_MS ? null : r
  } catch { return null }
}

let canal: BroadcastChannel | null = null
function obtenerCanal(): BroadcastChannel | null {
  if (canal) return canal
  try { canal = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CANAL) } catch { canal = null }
  return canal
}

/** ¿Otra pestaña (o esta) ya presentó/descartó esta señal? */
export function yaPresentado(clave: string): boolean { return leer(clave) != null }

/** Reclama la señal para esta pestaña. Devuelve false si ya estaba reclamada. */
export function reclamar(clave: string): boolean {
  if (yaPresentado(clave)) return false
  marcar(clave, 'visto')
  return true
}

export function marcar(clave: string, e: EstadoPresentacion) {
  try { localStorage.setItem(PREFIJO + clave, JSON.stringify({ e, t: Date.now() } satisfies Registro)) } catch { /* almacenamiento no disponible */ }
  try { obtenerCanal()?.postMessage({ clave, e }) } catch { /* canal no disponible */ }
}

/** Escucha lo que otras pestañas hacen con una señal (descartar/atender la quita aquí también). */
export function escucharPestanas(cb: (clave: string, e: EstadoPresentacion) => void): () => void {
  const c = obtenerCanal()
  const onMsg = (ev: MessageEvent) => { const d = ev.data as { clave?: string; e?: EstadoPresentacion }; if (d?.clave && d.e) cb(d.clave, d.e) }
  const onStorage = (ev: StorageEvent) => {
    if (!ev.key?.startsWith(PREFIJO) || !ev.newValue) return
    try { cb(ev.key.slice(PREFIJO.length), (JSON.parse(ev.newValue) as Registro).e) } catch { /* valor ajeno */ }
  }
  c?.addEventListener('message', onMsg)
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => { c?.removeEventListener('message', onMsg); if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage) }
}

/** Limpieza de registros vencidos (barato; se llama al montar la alerta). */
export function limpiarVencidos() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIJO) && !leer(k.slice(PREFIJO.length))) localStorage.removeItem(k)
    }
  } catch { /* almacenamiento no disponible */ }
}
