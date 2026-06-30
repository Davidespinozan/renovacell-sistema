// Hook ÚNICO del Asistente IA. Hoy: motor mock local sobre data real (catálogo +
// pedidos del doctor). Mañana: `ask` hace una llamada al LLM con el mismo (texto,
// contexto) y devuelve la misma forma → la UI no cambia. El swap vive aquí.
import { useCallback, useRef } from 'react'
import { useProducts, isActiveProduct } from './useProducts'
import { useOrders } from './useOrders'
import { answer, type AssistantReply } from '../assistant/engine'

export function useAssistant() {
  const { data: products } = useProducts()
  const { data: orders, createOrder } = useOrders()

  // El asistente solo ofrece productos ACTIVOS (visibles en el catálogo del doctor).
  const visible = products.filter(isActiveProduct)
  // Snapshot vivo para que `ask` siempre vea el último catálogo/pedidos.
  const ctx = useRef({ products: visible, orders })
  ctx.current = { products: visible, orders }

  const ask = useCallback((text: string): AssistantReply => answer(text, ctx.current), [])

  return { ask, products: visible, orders, createOrder }
}
