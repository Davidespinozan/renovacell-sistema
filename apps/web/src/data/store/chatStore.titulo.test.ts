// Chat del equipo · el título de un directo es SIEMPRE la otra persona. Antes salía de `profiles` (solo Dirección lee
// perfiles ajenos): Almacén veía el título guardado por quien abrió el chat — su propio nombre — como si hablara solo.
import { describe, expect, it, vi } from 'vitest'

vi.mock('./directoryStore', () => ({
  getSnapshot: () => [{ id: 'u-blanca', name: 'Blanca Barraza', role: 'packing' }],
  subscribe: () => () => {},
}))
const { dmTitle } = await import('./chatStore')

const dm = (title: string, member_ids: string[]) => ({ id: 'c1', kind: 'dm' as const, title, area: null, member_ids, created_at: '', last_message_at: null })

describe('dmTitle', () => {
  it('Alberto abre el chat que creó Blanca (título guardado = Alberto): ve "Blanca Barraza"', () => {
    expect(dmTitle(dm('Alberto Gutiérrez', ['u-blanca', 'u-alberto']), 'u-alberto', 'Alberto Gutiérrez')).toBe('Blanca Barraza')
  })
  it('sin la otra persona en el directorio, nunca muestra el nombre propio', () => {
    expect(dmTitle(dm('Alberto Gutiérrez', ['u-otro', 'u-alberto']), 'u-alberto', 'Alberto Gutiérrez')).toBe('Mensaje directo')
    expect(dmTitle(dm('Claudia López', ['u-otro', 'u-alberto']), 'u-alberto', 'Alberto Gutiérrez')).toBe('Claudia López')
  })
  it('los grupos conservan su nombre', () => {
    expect(dmTitle({ ...dm('Almacén y Empaque', []), kind: 'group' }, 'u-alberto', 'Alberto')).toBe('Almacén y Empaque')
  })
})
