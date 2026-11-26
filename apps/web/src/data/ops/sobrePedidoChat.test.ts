// SOBRE PEDIDO EN EL CHAT (26 nov 2026): el carrito y el checkout del chat aceptan productos marcados sin existencia.
import { describe, it, expect } from 'vitest'
import { ETIQUETA_DISPONIBILIDAD } from './carrito'
import mig from '../../../../../supabase/migrations/20270408010000_sobre_pedido_chat.sql?raw'

describe('sobre pedido en el chat', () => {
  it('el carrito lo muestra como sobre pedido, no como sin disponibilidad', () => {
    expect(ETIQUETA_DISPONIBILIDAD.sobre_pedido).toMatch(/Sobre pedido/)
  })
  it('servidor: disponibilidad, revisión y pedido del checkout', () => {
    expect(mig).toMatch(/when prod\.sobre_pedido then 'sobre_pedido'/)
    expect(mig).toMatch(/not in \('disponible', 'sobre_pedido'\)/)
    expect(mig).toMatch(/perform public\._sobre_pedido_marcar\(v_order\);/)
  })
})
