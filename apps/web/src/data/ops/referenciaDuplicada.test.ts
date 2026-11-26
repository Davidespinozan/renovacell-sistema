// REF-DUP (26 nov 2026): una referencia de pago repetida dice en QUÉ venta ya está.
import { describe, it, expect } from 'vitest'
import { mensajeDeError } from '../store/escritura'
import { codigoConocido, isAmbiguous } from './w1Command'
import { mensajeCobro } from './cobro'
import mig from '../../../../../supabase/migrations/20270407940000_referencia_duplicada_dice_donde.sql?raw'

const e = { message: 'REFERENCIA_DUPLICADA: ya está en el cobro de S055597 · LUIS CLEMENTE GIL GARCIA', code: '23505', status: 409 }

describe('referencia de pago repetida', () => {
  it('al levantar el pedido: aviso claro con folio y cliente, sin dejarlo como «incierto»', () => {
    expect(codigoConocido(e.message)).toBeTruthy()
    expect(isAmbiguous(e as never)).toBe(false)
    const m = mensajeDeError(e as never, 'comando')
    expect(m).toMatch(/ya está registrada en otro cobro/)
    expect(m).toMatch(/S055597/); expect(m).toMatch(/LUIS CLEMENTE GIL GARCIA/)
  })
  it('al cobrar un pedido existente también dice dónde', () => {
    expect(mensajeCobro(e.message)).toBe('Esa referencia de pago ya está en el cobro de S055597 · LUIS CLEMENTE GIL GARCIA, así que no se guardó nada. Escribe la clave de rastreo o la referencia del comprobante de ESTE pago.')
  })
  it('el servidor revisa antes de asentar y la regla no se relaja', () => {
    expect(mig).toMatch(/perform public\._w2_referencia_libre\(p_reference\);\s+-- F-9/)
    expect(mig).toMatch(/revoke all on function public\._w2_referencia_libre\(text\) from public, anon, authenticated/)
  })
})
