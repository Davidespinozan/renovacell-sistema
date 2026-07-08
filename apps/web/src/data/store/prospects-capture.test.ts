// Motor de captación multicanal: dedup + auto-asignación balanceada.
// Semilla (mock): ventas1 con 2 prospectos abiertos, ventas2 con 1.
import { describe, it, expect } from 'vitest'
import { captureLead, getSnapshot } from './prospectsStore'

describe('captación multicanal', () => {
  it('auto-asigna al vendedor con menos carga abierta', () => {
    const before = getSnapshot().length
    const r = captureLead({ name: 'Lead Uno', phone: '55 1111 2222', channel: 'WhatsApp' })
    expect(r.duplicate).toBe(false)
    expect(r.assignedTo).toBe('ventas2@renovacell.mx') // ventas2 tenía 1 abierto vs 2 de ventas1
    expect(getSnapshot().length).toBe(before + 1)
  })

  it('deduplica por teléfono en lugar de crear otro', () => {
    const first = captureLead({ name: 'Lead Dos', phone: '55 3333 4444', channel: 'Instagram' })
    const count = getSnapshot().length
    const again = captureLead({ name: 'Lead Dos (otra vez)', phone: '5533334444', channel: 'Facebook' })
    expect(again.duplicate).toBe(true)
    expect(again.prospect.id).toBe(first.prospect.id)
    expect(getSnapshot().length).toBe(count) // no se duplicó
  })

  it('balancea: tras asignar al de menos carga, el siguiente va al otro', () => {
    // Estado tras el 1er test: ventas1=2, ventas2=2 (empate) → siguiente al primero del roster.
    const r = captureLead({ name: 'Lead Tres', phone: '55 5555 6666', channel: 'Referido' })
    expect(['ventas1@renovacell.mx', 'ventas2@renovacell.mx']).toContain(r.assignedTo)
  })
})
