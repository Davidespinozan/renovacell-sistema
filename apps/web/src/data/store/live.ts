// Adaptador de colección "viva": mantiene un cache SÍNCRONO (para
// useSyncExternalStore) hidratado desde Supabase. Re-hidrata al iniciar/cerrar
// sesión (para que el catálogo cargue tras el login) y tras cada mutación
// (write-through). Sin backend (hasSupabase=false) opera sobre el fallback mock.
import { supabase, hasSupabase } from '../../lib/supabase'

export interface Live<T> {
  subscribe: (cb: () => void) => () => void
  getSnapshot: () => T[]
  reload: () => Promise<void>
  setLocal: (next: T[]) => void
  current: () => T[]
}

export function makeLive<T>(load: () => Promise<T[]>, fallback: T[]): Live<T> {
  let cache: T[] = hasSupabase ? [] : [...fallback]
  let snap: T[] = cache
  const listeners = new Set<() => void>()
  const emit = () => { snap = cache; listeners.forEach((l) => l()) }

  const reload = async () => {
    if (!hasSupabase) return
    try { cache = await load(); emit() } catch (e) { console.warn('[live] error al cargar', e) }
  }

  if (hasSupabase) {
    reload()
    // Re-hidrata en los eventos de sesión: al entrar (SIGNED_IN / INITIAL_SESSION)
    // el usuario ya está autenticado y el RLS le permite leer lo suyo.
    supabase.auth.onAuthStateChange((ev) => {
      if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'SIGNED_OUT' || ev === 'TOKEN_REFRESHED') reload()
    })
  }

  return {
    subscribe: (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    getSnapshot: () => snap,
    reload,
    setLocal: (next) => { cache = next; emit() },
    current: () => cache,
  }
}
