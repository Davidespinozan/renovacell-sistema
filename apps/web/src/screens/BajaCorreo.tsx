// DIFUSIONES · "Dejar de recibir": página pública del enlace que trae cada correo de difusión (renovacell.mx/baja?t=…).
// Con el token del correo deja de recibir difusiones por correo (sus avisos de pedido siguen). No pide sesión.
import React, { useEffect, useState } from 'react'
import { BrandLogo } from '../app/BrandLogo'
import { hasSupabase, supabase } from '../lib/supabase'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ data: unknown; error: unknown }>

export function BajaCorreo({ token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('t') : null, rpc = rpcPorDefecto }: { token?: string | null; rpc?: Rpc }) {
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'invalido' | 'error'>('cargando')
  useEffect(() => { document.title = 'Renovacell · Correos' }, [])
  useEffect(() => {
    if (!token || !UUID.test(token)) { setEstado('invalido'); return }
    if (!hasSupabase && rpc === rpcPorDefecto) { setEstado('error'); return }
    void Promise.resolve(rpc('correo_baja', { p_token: token })).then(({ data, error }) => setEstado(error ? 'error' : (data as { ok?: boolean } | null)?.ok ? 'listo' : 'invalido'), () => setEstado('error'))
  }, [token, rpc])
  return (
    <main className="baja" data-testid="baja-correo">
      <div className="baja-card">
        <BrandLogo alt="Renovacell" className="baja-logo" />
        {estado === 'cargando' && <p>Un momento…</p>}
        {estado === 'listo' && <><h1>Listo</h1><p>Ya no te mandaremos difusiones por correo. Seguirás recibiendo los avisos de tus pedidos.</p></>}
        {estado === 'invalido' && <><h1>Enlace no válido</h1><p>Este enlace ya no sirve o está incompleto. Si quieres dejar de recibir correos, respóndenos el correo y lo hacemos por ti.</p></>}
        {estado === 'error' && <><h1>No se pudo completar</h1><p>Intenta de nuevo en unos minutos.</p></>}
        <a href="/" className="baja-link">Ir a Renovacell</a>
      </div>
    </main>
  )
}
