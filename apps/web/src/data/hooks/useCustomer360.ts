// Hook del Customer 360 (C360-F2B → C360-F3). Una sola lectura al servidor (`cliente_360`), que agrega
// y redacta por rol: sin N+1 ni reconstrucción en el navegador. `recargar` tras cada comando.
import { useCallback, useEffect, useState } from 'react'
import { cliente360 as clientePorDefecto, type Cliente360, type ClienteC360 } from '../ops/customer360'

export function useCustomer360(customerId: string | null, cliente: ClienteC360 = clientePorDefecto): { data: Cliente360 | null; loading: boolean; error: string | null; recargar: () => Promise<void> } {
  const [data, setData] = useState<Cliente360 | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const recargar = useCallback(async () => {
    const r = await cliente.leer(customerId)
    if (r.ok) { setData(r.data); setError(null) } else setError(r.error)
    setLoading(false)
  }, [cliente, customerId])
  useEffect(() => { setLoading(true); void recargar() }, [recargar])
  return { data, loading, error, recargar }
}
