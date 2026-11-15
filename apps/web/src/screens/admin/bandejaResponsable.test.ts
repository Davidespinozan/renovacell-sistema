// BANDEJA-RESPONSABLE (15 nov 2026) · una conversación que atiende el asistente muestra la vendedora de cartera (antes
// "sin vendedor" aunque el cliente es de alguien; caso Kitzia Dajimer Alacio León → Alejandra Cázarez).
import { describe, it, expect } from 'vitest'
import { estadoLinea } from './BandejaConversaciones'
import type { ItemBandeja } from '../../data/ops/atencion'

const item = (x: Partial<ItemBandeja>): ItemBandeja => ({ conversation_id: 'C', dueno: 'visitante', profile_id: null, nombre: 'Kitzia', modo: 'ai_active', seller_id: null, seller_nombre: null,
  ruteo_motivo: null, origen: null, fuera_horario: null, solicitado_at: null, edad_min: null, iniciada: false, cart_id: null, n_items: 0,
  grupo: 'ia', tomada: false, sin_responder: false, ultimo_actor: 'ai', hace_min: 5, ...x })

describe('Bandeja · vendedora responsable', () => {
  it('IA atendiendo, de la cartera de su vendedora', () => {
    expect(estadoLinea(item({ responsable_id: 'S', responsable_nombre: 'Alejandra Cázarez' })).texto).toBe('IA atendiendo · de la cartera de Alejandra Cázarez')
  })
  it('sin respuesta: dice quién es su vendedora', () => {
    expect(estadoLinea(item({ grupo: 'por_atender', sin_responder: true, responsable_id: 'S', responsable_nombre: 'Alejandra Cázarez' })).texto).toBe('El cliente quedó sin respuesta · su vendedora: Alejandra Cázarez')
  })
  it('sin vendedora de cartera, igual que antes', () => {
    expect(estadoLinea(item({})).texto).toBe('IA atendiendo')
  })
})
