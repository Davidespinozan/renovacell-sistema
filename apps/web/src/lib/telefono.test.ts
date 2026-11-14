import { describe, expect, it } from 'vitest'
import { telefonoLegible } from './telefono'

describe('telefonoLegible', () => {
  it('WhatsApp de México sin el 1', () => expect(telefonoLegible('+5216678675738')).toBe('+52 667 867 5738'))
  it('México de 12 dígitos', () => expect(telefonoLegible('526671234567')).toBe('+52 667 123 4567'))
  it('10 dígitos locales', () => expect(telefonoLegible('667 123 4567')).toBe('+52 667 123 4567'))
  it('Estados Unidos', () => expect(telefonoLegible('+17373683464')).toBe('+1 737 368 3464'))
  it('vacío', () => { expect(telefonoLegible(null)).toBeNull(); expect(telefonoLegible('  ')).toBeNull() })
})
