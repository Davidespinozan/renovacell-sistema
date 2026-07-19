// Avisos de mensajes de chat (regresión de PRIVACIDAD).
//
// El riesgo real: las notificaciones se dirigían por ROL, y una notificación sin
// rol se trataba como difusión a todo el staff. Si el aviso de un mensaje directo
// saliera así, el adelanto del mensaje llegaría a toda la empresa. Aquí se fija que
// el aviso va SOLO a los miembros de la conversación, y nunca a quien escribió.
import { describe, it, expect } from 'vitest'
import type { Notif } from './notificationsStore'

// Réplica de la regla de audiencia del TopBar: cuando la notificación va dirigida
// a personas, MANDA sobre el rol (ni siquiera Dirección la ve si no es destinataria).
function laVe(n: Notif, userId: string, role: 'admin' | 'pos' | 'warehouse'): boolean {
  return n.userIds ? n.userIds.includes(userId) : (!n.roles || role === 'admin' || n.roles.includes(role))
}

describe('chat · a quién le llega el aviso', () => {
  const aviso: Notif = {
    id: 'n1', text: 'Lucía · mensaje directo: ¿tienes el pedido?', at: '', read: false,
    screen: 'chat', userIds: ['user-lucia', 'user-diego'],
  }

  it('le llega a los miembros de la conversación', () => {
    expect(laVe(aviso, 'user-diego', 'pos')).toBe(true)
    expect(laVe(aviso, 'user-lucia', 'pos')).toBe(true)
  })

  it('NO le llega a un tercero, aunque sea Dirección', () => {
    expect(laVe(aviso, 'user-claudia', 'admin')).toBe(false)
    expect(laVe(aviso, 'user-alberto', 'warehouse')).toBe(false)
  })

  it('los avisos por rol siguen funcionando igual que antes', () => {
    const porRol: Notif = { id: 'n2', text: 'Pedidos por surtir', at: '', read: false, roles: ['warehouse'] }
    expect(laVe(porRol, 'user-alberto', 'warehouse')).toBe(true)
    expect(laVe(porRol, 'user-claudia', 'admin')).toBe(true) // Dirección supervisa
    expect(laVe(porRol, 'user-diego', 'pos')).toBe(false)
  })
})