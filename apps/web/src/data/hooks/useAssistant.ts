// Hook ÚNICO del Asistente IA. Hoy: motor mock local sobre data real (catálogo +
// pedidos del doctor). Mañana: `ask` hace una llamada al LLM con el mismo (texto,
// contexto) y devuelve la misma forma → la UI no cambia. El swap vive aquí.
import { useCallback, useRef } from 'react'
import { useProducts, isActiveProduct } from './useProducts'
import { useOrders } from './useOrders'
import { answer, type AssistantReply } from '../assistant/engine'
import { askLLM } from '../assistant/llm'

export function useAssistant() {
  const { data: products } = useProducts()
  const { data: orders, createOrder } = useOrders()

  // El asistente solo ofrece productos ACTIVOS (visibles en el catálogo del doctor).
  const visible = products.filter(isActiveProduct)
  // Snapshot vivo para que `ask` siempre vea el último catálogo/pedidos.
  const ctx = useRef({ products: visible, orders })
  ctx.current = { products: visible, orders }

  // El motor local resuelve lo ESTRUCTURADO y lo clínico (acciones + seguridad
  // deterministas). Solo la conversación libre (`out_of_scope`) va a la IA real; si no
  // está configurada (501) o falla, se queda la respuesta local. La UI recibe la MISMA forma.
  const ask = useCallback(async (text: string): Promise<AssistantReply> => {
    const local = answer(text, ctx.current)
    if (local.intent !== 'out_of_scope') return local
    const llm = await askLLM(text, ctx.current, 'doctor')
    return llm ? { ...local, text: llm } : local
  }, [])

  return { ask, products: visible, orders, createOrder }
}
