// ENT-P · Aviso de ENVÍO GRATIS, el mismo en todas las pantallas que venden. El doctor lo ve en el carrito del Catálogo, la
// barra móvil y el carrito del chat (antes de pagar); el vendedor, dentro de la entrega de Caja y Levantar pedido. Los
// mínimos y la zona los decide el servidor (entrega_opciones con el CP de la dirección predeterminada); aquí solo se muestra.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { money } from '../lib/format'
import { avisoEnvioGratis, opcionesEntrega, type AvisoEnvioGratis as Aviso, type OpcionesEntrega } from '../data/ops/entrega'
import { defaultLocation } from '../data/ops/doctorLocation'
import { listDoctorLocations } from '../data/store/doctorLocationsStore'
import { currentUserId } from '../lib/supabase'

/** CP de la dirección predeterminada del doctor en sesión (null sin dirección). Solo se pide cuando el aviso está activo. */
async function cpPredeterminadoPorDefecto(): Promise<string | null> {
  const uid = currentUserId(); if (!uid) return null
  return defaultLocation(await listDoctorLocations(uid))?.postal_code?.trim() || null
}

/** Aviso del DOCTOR para un importe de productos: zona por su dirección predeterminada (sin dirección: las dos zonas). */
export function useAvisoEnvioGratis(subtotal: number | null, opts: { activo?: boolean; cargar?: typeof opcionesEntrega; cpPredeterminado?: () => Promise<string | null> } = {}): Aviso | null {
  const { activo = true, cargar = opcionesEntrega, cpPredeterminado = cpPredeterminadoPorDefecto } = opts
  const [cp, setCp] = useState<string | null | undefined>(undefined)   // undefined = aún no se sabe
  const [ops, setOps] = useState<OpcionesEntrega | null>(null)
  const pedido = useRef(0)
  const importe = subtotal != null && subtotal > 0 ? Math.round(subtotal * 100) / 100 : null
  useEffect(() => {
    if (!activo || cp !== undefined) return
    let vivo = true
    cpPredeterminado().then((v) => { if (vivo) setCp(v) }, () => { if (vivo) setCp(null) })
    return () => { vivo = false }
  }, [activo, cp, cpPredeterminado])
  useEffect(() => {
    const loading = cp === undefined
    if (!activo || importe == null || loading) { if (importe == null) setOps(null); return }
    const n = ++pedido.current
    const t = setTimeout(async () => {
      const r = await cargar('doctor', importe, cp ?? null)
      if (n !== pedido.current) return
      setOps(r.ok ? r.data : null)   // sin servidor no se inventa el aviso
    }, 300)
    return () => clearTimeout(t)
  }, [activo, importe, cp, cargar])
  return useMemo(() => (importe == null || !ops ? null : avisoEnvioGratis({ ...ops, subtotal: importe }, money, 'doctor')), [ops, importe])
}

/** Presentación: título, detalle opcional y barra de avance. `compacto` = una línea (barra móvil, carrito del chat). */
export function AvisoEnvioGratisVista({ aviso, compacto = false, testId = 'aviso-envio-gratis' }: { aviso: Aviso | null; compacto?: boolean; testId?: string }) {
  if (!aviso) return null
  const pct = Math.round(Math.max(0, Math.min(1, aviso.avance)) * 100)
  return (
    <div className={`rc-envio-gratis${aviso.alcanzado ? ' is-ok' : ''}${compacto ? ' is-compacto' : ''}`} role="status" aria-live="polite" data-testid={testId}>
      <div className="rc-envio-gratis-tit">{aviso.alcanzado ? '✓ ' : ''}{aviso.titulo}</div>
      {!compacto && aviso.detalle && <div className="rc-envio-gratis-det">{aviso.detalle}</div>}
      {!aviso.alcanzado && (
        <div className="rc-envio-gratis-barra" aria-hidden><span style={{ width: `${pct}%` }} /></div>
      )}
    </div>
  )
}
