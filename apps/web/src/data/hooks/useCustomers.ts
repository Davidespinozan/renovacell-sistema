// Hook del DIRECTORIO COMERCIAL (customers). Carga TODO el directorio una vez (paginado en el
// store) y filtra en cliente → búsqueda inmediata, sin N+1 ni consulta de profiles por fila.
// La RLS es la autoridad (admin/pos leen; doctor solo el suyo).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listCustomers } from '../store/customersStore'
import { matchCustomer, type Customer } from '../ops/customer'

export function useCustomers() {
  const [data, setData] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await listCustomers()) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el directorio.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  return { data, loading, error, reload }
}

// Filtro puro reutilizable (memoizable en la pantalla).
export function filterCustomers(customers: Customer[], query: string): Customer[] {
  const q = (query ?? '').trim()
  if (!q) return customers
  return customers.filter((c) => matchCustomer(c, q))
}

export function useCustomerSearch(customers: Customer[], query: string): Customer[] {
  return useMemo(() => filterCustomers(customers, query), [customers, query])
}
