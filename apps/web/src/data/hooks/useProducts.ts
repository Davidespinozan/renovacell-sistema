// Hook de acceso al catálogo. HOY lee del store editable (productsStore); el
// Portal del Doctor ve solo los ACTIVOS. MAÑANA (Supabase) se cambia el cuerpo
// por un select a `products_safe` SIN tocar las pantallas.
import { useSyncExternalStore } from 'react'
import type { ProductSafe, QueryResult } from '../types'
import { hasSupabase } from '../../lib/supabase'
import {
  subscribe, getSnapshot, ready,
  createProduct, updateProduct, toggleActive, deleteProduct, type ProductInput,
} from '../store/productsStore'

// Catálogo completo (incluye ocultos) — se usa para resolver nombres de
// productos en pedidos/reportes. Las pantallas del DOCTOR filtran por `active`
// con isActiveProduct() para no mostrar los ocultos.
export function useProducts(): QueryResult<ProductSafe[]> {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, loading: hasSupabase && !ready(), error: null }
}

export const isActiveProduct = (p: ProductSafe): boolean => p.active !== false

// Visible en el Portal del Doctor. Ocultarlo NO impide venderlo en mostrador:
// para eso está `active`. Sirve para productos que aún no deben mostrarse al
// cliente — por ejemplo, mientras no tienen fotografía.
export const isPortalProduct = (p: ProductSafe): boolean =>
  p.active !== false && p.show_portal !== false

// Catálogo COMPLETO (Admin/Contenido): incluye los ocultos + mutaciones.
export function useCatalogAdmin() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, createProduct, updateProduct, toggleActive, deleteProduct }
}

export type { ProductInput }
