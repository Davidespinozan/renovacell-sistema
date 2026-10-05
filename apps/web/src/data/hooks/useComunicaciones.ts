// W4-05 · Lectura del buzón de mensajes al cliente. Se relee del servidor tras cada
// acción: la pantalla nunca supone el resultado de un envío.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cargarMensajes, requiereAccion, type MensajeCliente } from '../ops/comunicaciones'

export function useComunicaciones() {
  const [data, setData] = useState<MensajeCliente[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const r = await cargarMensajes()
    setData(r.data); setError(r.error); setLoading(false)
  }, [])
  useEffect(() => { void reload() }, [reload])

  const cuentas = useMemo(() => ({
    porEnviar: data.filter((m) => m.status === 'pendiente' || m.status === 'enviando').length,
    enviados: data.filter((m) => m.status === 'enviado').length,
    conProblema: data.filter(requiereAccion).length,
  }), [data])

  return { data, error, loading, reload, cuentas }
}
