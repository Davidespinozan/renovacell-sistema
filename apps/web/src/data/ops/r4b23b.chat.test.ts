// R4-B2-3b · la Edge del chat traduce los rechazos de exclusividad del servidor a mensajes claros para el personal.
import { describe, it, expect } from 'vitest'
import { mapearErrorChat } from '../../../../../supabase/functions/_shared/chat'

describe('mapearErrorChat · exclusividad en canales', () => {
  it('TOMA_REQUERIDA → 409 toma_requerida', () => expect(mapearErrorChat('TOMA_REQUERIDA: toma la conversación')).toEqual({ status: 409, body: { error: 'toma_requerida', message: 'Toma la conversación antes de responder.' } }))
  it('ATENDIDA_POR_OTRO → 409 atendida_por_otro', () => expect(mapearErrorChat('ATENDIDA_POR_OTRO: otra persona')).toMatchObject({ status: 409, body: { error: 'atendida_por_otro' } }))
  it('CANAL_EN_ESPEJO → 409 canal_en_espejo', () => expect(mapearErrorChat('CANAL_EN_ESPEJO: el canal whatsapp no está activo')).toMatchObject({ status: 409, body: { error: 'canal_en_espejo' } }))
  it('los códigos previos no cambian', () => {
    expect(mapearErrorChat('ASESORIA_NO_INICIADA: modo ai_active').body.error).toBe('asesoria_no_iniciada')
    expect(mapearErrorChat('NO_AUTORIZADO').body.error).toBe('no_autorizado')
    expect(mapearErrorChat('algo raro').status).toBe(503)
  })
})
