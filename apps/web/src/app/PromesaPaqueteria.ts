// PAQ-SIMPLE (23 nov 2026, reemplaza ServicioPaqueteria del 2 nov) · Al vender solo se elige la PAQUETERÍA (DHL o
// Estafeta); ya no hay lista de servicios ni recargo. Para DHL se cotiza en vivo SOLO para prometer la fecha: la llegada
// más tardía de los servicios permitidos (Almacén elige el servicio al hacer la guía). Si la cotización falla o tarda, se
// vende con el rango de la regla: nunca se detiene la venta. Lo usan el vendedor (SelectorEntrega) y el doctor (Checkout).
import { useEffect, useRef, useState } from 'react'
import { sumarDias } from '../data/periodo'
import { cotizarEnvio, promesaCotizacion, type CotizacionEnvio, type ServicioElegido } from '../data/ops/entrega'

export interface PromesaDhl {
  estado: 'inactiva' | 'cargando' | 'ok' | 'regla'
  /** Lo que viaja al servidor para que fije la misma fecha (la cotización; la base la recalcula). */
  servicio: ServicioElegido | null
  /** Fecha prometida (AAAA-MM-DD), ya corrida si la salida está agendada. Null = se usa la regla. */
  llega_fecha: string | null
  /** Por qué se usa la regla (la cotización falló). */
  aviso: string | null
}

export function usePromesaDhl({ activa, cp, piezas, destino, cargar = cotizarEnvio, corrimientoDias = 0 }: {
  activa: boolean
  cp: string | null | undefined
  piezas: number
  destino?: { ciudad?: string | null; estado?: string | null }
  cargar?: typeof cotizarEnvio
  /** SALIDA PROGRAMADA · la cotización es para salir hoy: la fecha se corre estos días (la base hace lo mismo). */
  corrimientoDias?: number
}): PromesaDhl {
  const [cot, setCot] = useState<CotizacionEnvio | null>(null)
  const [estado, setEstado] = useState<PromesaDhl['estado']>('inactiva')
  const [aviso, setAviso] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const pedido = useRef(0)
  const valido = activa && !!cp && /^\d{5}$/.test(cp) && piezas >= 1

  useEffect(() => {
    const n = ++pedido.current
    if (!valido) { setCot(null); setEstado('inactiva'); setAviso(null); return }
    setEstado((e) => (e === 'ok' ? e : 'cargando'))
    const t = setTimeout(async () => {
      const r = await cargar(cp!, piezas, destino).catch(() => ({ ok: false as const, error: 'No se pudo cotizar el envío: se usa la regla de entrega.' }))
      if (n !== pedido.current) return
      if (!r.ok || !promesaCotizacion(r.data)) { setCot(null); setEstado('regla'); setAviso(r.ok ? 'Sin servicios para ese código postal: se usa la regla de entrega.' : r.error); return }
      setCot(r.data); setEstado('ok'); setAviso(null)
    }, 300)
    return () => clearTimeout(t)
  }, [valido, cp, piezas, vuelta])   // eslint-disable-line react-hooks/exhaustive-deps

  // La cotización vale 2 horas: al vencer se vuelve a pedir sola.
  useEffect(() => {
    if (!cot) return
    const ms = Date.parse(cot.expira_at) - Date.now() - 60_000
    if (!(ms > 0)) return
    const t = setTimeout(() => setVuelta((v) => v + 1), Math.min(ms, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [cot])

  const p = estado === 'ok' ? promesaCotizacion(cot) : null
  if (!p || !cot) return { estado: valido ? estado : 'inactiva', servicio: null, llega_fecha: null, aviso }
  return {
    estado: 'ok',
    servicio: { cotizacion_id: cot.cotizacion_id, codigo: p.codigo, llega_fecha: p.llega_fecha },
    llega_fecha: corrimientoDias ? sumarDias(p.llega_fecha, corrimientoDias) : p.llega_fecha,
    aviso: null,
  }
}
