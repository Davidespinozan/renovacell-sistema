// Hook de acceso a datos del catálogo. HOY devuelve mock; MAÑANA se cambia el
// cuerpo por una consulta a Supabase (`products_safe`) SIN tocar las pantallas.
//
// Para migrar a Supabase, reemplazar el cuerpo por algo como:
//   const { data, error } = await supabase.from('products_safe').select('*')
// y mapear a ProductSafe[]. La firma { data, loading, error } no cambia.
import { useEffect, useState } from 'react'
import type { ProductSafe, QueryResult } from '../types'
import { MOCK_PRODUCTS } from '../mock/catalog'

export function useProducts(): QueryResult<ProductSafe[]> {
  const [state, setState] = useState<QueryResult<ProductSafe[]>>({
    data: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let alive = true
    // Simula la carga asíncrona (igual forma que una llamada a Supabase).
    Promise.resolve(MOCK_PRODUCTS).then((data) => {
      if (alive) setState({ data, loading: false, error: null })
    })
    return () => {
      alive = false
    }
  }, [])

  return state
}
