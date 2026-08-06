// Bandeja multicanal: el HILO de conversación del prospecto (mensajes de entrada del
// canal + respuestas del vendedor). Distinto de las notas internas.
import { describe, it, expect } from 'vitest'
import { captureLead, replyProspect, messagesOf, getSnapshot } from './prospectsStore'

describe('hilo de conversación (bandeja multicanal)', () => {
  it('abre el hilo con el primer mensaje entrante del canal', () => {
    const r = captureLead({ name: 'Dra. Chat', phone: '55 7777 0001', channel: 'WhatsApp', message: 'Hola, ¿tienen Golden Serum?' })
    const msgs = messagesOf(r.prospect)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ dir: 'in', text: 'Hola, ¿tienen Golden Serum?', channel: 'WhatsApp' })
  })

  it('el mensaje entrante de un duplicado se enhebra, no se pierde', () => {
    const first = captureLead({ name: 'Dr. Repetido', phone: '55 7777 0002', channel: 'Instagram', message: 'primer mensaje' })
    const again = captureLead({ name: 'Dr. Repetido', phone: '5577770002', channel: 'Instagram', message: 'segundo mensaje' })
    expect(again.duplicate).toBe(true)
    const p = getSnapshot().find((x) => x.id === first.prospect.id)!
    const msgs = messagesOf(p)
    expect(msgs.map((m) => m.text)).toEqual(['primer mensaje', 'segundo mensaje'])
  })

  it('la respuesta del vendedor se agrega como saliente y pendiente de envío', () => {
    const r = captureLead({ name: 'Dra. Responder', phone: '55 7777 0003', channel: 'WhatsApp', message: 'info por favor' })
    replyProspect(r.prospect.id, 'Con gusto, le comparto la lista.')
    const p = getSnapshot().find((x) => x.id === r.prospect.id)!
    const msgs = messagesOf(p)
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ dir: 'out', text: 'Con gusto, le comparto la lista.', pending: true })
  })

  it('sin mensaje, el hilo queda vacío (lead sin conversación)', () => {
    const r = captureLead({ name: 'Lead Silencioso', phone: '55 7777 0004', channel: 'Referido' })
    expect(messagesOf(r.prospect)).toHaveLength(0)
  })
})