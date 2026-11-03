// EQUIPO-LECTURAS (mig 20270328) · palomitas azules y "escribiendo…" en el Chat del equipo. La base guarda hasta dónde
// leyó cada quien y si está tecleando (nunca el texto); quién lo ve lo decide la misma regla de los mensajes. Realtime
// solo despierta una relectura; sin backend o sin canal, queda el sondeo.
import { useCallback, useEffect, useRef, useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'

export interface Lector { profile_id: string; nombre: string; leido_hasta: string | null; escribiendo: boolean }
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export interface ClienteLecturas {
  lectores: (conv: string) => Promise<Lector[] | null>
  leido: (conv: string, hasta: string) => Promise<void>
  escribiendo: (conv: string, activo: boolean) => Promise<void>
  suscribir: (conv: string, alCambiar: () => void) => () => void
}
const callar = async (p: PromiseLike<unknown>) => { try { await p } catch { /* las palomitas nunca rompen el chat */ } }
export const lecturasPorDefecto = (rpc: Rpc = rpcPorDefecto): ClienteLecturas => ({
  lectores: async (conv) => {
    if (!hasSupabase && rpc === rpcPorDefecto) return []
    try { const { data, error } = await rpc('equipo_lectores', { p_conv: conv }); return error ? null : Array.isArray(data) ? data as Lector[] : [] } catch { return null }
  },
  leido: async (conv, hasta) => { if (hasSupabase || rpc !== rpcPorDefecto) await callar(rpc('equipo_leido', { p_conv: conv, p_hasta: hasta })) },
  escribiendo: async (conv, activo) => { if (hasSupabase || rpc !== rpcPorDefecto) await callar(rpc('equipo_escribiendo', { p_conv: conv, p_activo: activo })) },
  suscribir: (conv, alCambiar) => {
    if (!hasSupabase || typeof supabase?.channel !== 'function') return () => {}
    let canal: ReturnType<typeof supabase.channel> | null = null; let vivo = true
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (!vivo || !data.session?.access_token) return
        supabase.realtime.setAuth(data.session.access_token)
        canal = supabase.channel(`rc-equipo-lect-${conv}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'equipo_lecturas', filter: `conversation_id=eq.${conv}` }, () => alCambiar())
          .subscribe()
        if (!vivo && canal) { void supabase.removeChannel(canal); canal = null }
      } catch { /* sin Realtime: queda el sondeo */ }
    })()
    return () => { vivo = false; if (canal) { void supabase.removeChannel(canal); canal = null } }
  },
})

/** ¿Ya lo vieron? Directo: el otro. Grupo: todos los que deben leerlo. Sin lectores (p. ej. sin backend): no se sabe. */
export function vistoPor(lectores: Lector[], creado: string): { visto: boolean; n: number; de: number } {
  // Por instante (no por texto): la base devuelve +00:00 y lo optimista del navegador trae Z.
  const t = Date.parse(creado)
  const n = lectores.filter((l) => l.leido_hasta && Date.parse(l.leido_hasta) >= t).length
  return { visto: lectores.length > 0 && n === lectores.length, n, de: lectores.length }
}
/** "escribiendo…" (directo) o "Ana está escribiendo…" / "Ana y Beto están escribiendo…" (grupo). */
export function textoEscribiendo(lectores: Lector[], grupo: boolean): string | null {
  const q = lectores.filter((l) => l.escribiendo).map((l) => l.nombre.split(' ')[0])
  if (q.length === 0) return null
  if (!grupo) return 'escribiendo…'
  return q.length === 1 ? `${q[0]} está escribiendo…` : `${q.slice(0, -1).join(', ')} y ${q[q.length - 1]} están escribiendo…`
}

const PING_MS = 4000
/** Lectores de la conversación abierta, en vivo; marcar leído y avisar que escribo (como mucho cada 4 s). */
export function useLecturasEquipo(conv: string | null, ultimo: string | null, cliente: ClienteLecturas = lecturasPorDefecto(), intervaloMs = 20_000) {
  const [lectores, setLectores] = useState<Lector[]>([])
  const cli = useRef(cliente).current
  const recargar = useCallback(async () => { if (!conv) return; const r = await cli.lectores(conv); if (r) setLectores(r) }, [conv, cli])
  useEffect(() => {
    setLectores([])
    if (!conv) return
    void recargar()
    const quitar = cli.suscribir(conv, () => void recargar())
    const t = setInterval(() => { if (document.visibilityState === 'visible') void recargar() }, intervaloMs)
    return () => { quitar(); clearInterval(t) }
  }, [conv, cli, recargar, intervaloMs])
  // Con la conversación abierta y a la vista, lo último que llegó ya está leído.
  useEffect(() => { if (conv && ultimo && document.visibilityState === 'visible') void cli.leido(conv, ultimo) }, [conv, ultimo, cli])
  const ultimoPing = useRef(0)
  const escribo = useCallback((activo: boolean) => {
    if (!conv) return
    const ahora = Date.now()
    if (activo && ahora - ultimoPing.current < PING_MS) return
    ultimoPing.current = activo ? ahora : 0
    void cli.escribiendo(conv, activo)
  }, [conv, cli])
  return { lectores, escribo }
}
