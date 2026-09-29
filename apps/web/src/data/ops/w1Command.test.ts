// W1 · cliente de comandos: op_id estable, sin éxito optimista, ambigüedad segura.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: h.rpc } }))

import { runW1Command, w1Message, w1Code, isAmbiguous, newOpId, AMBIGUO_MSG } from './w1Command'

beforeEach(() => { h.rpc.mockReset() })

describe('runW1Command', () => {
  it('éxito: devuelve el status que confirma el servidor', async () => {
    h.rpc.mockResolvedValueOnce({ data: { status: 'applied', lot_id: 'L1' }, error: null })
    const r = await runW1Command('recibir_lote', { p_op_id: 'op-1' } as never, 'op-1')
    expect(r).toEqual({ ok: true, status: 'applied', data: { status: 'applied', lot_id: 'L1' } })
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })
  it('reintento del servidor: already_applied se trata como éxito', async () => {
    h.rpc.mockResolvedValueOnce({ data: { status: 'already_applied' }, error: null })
    const r = await runW1Command('surtir_pedido', { p_op_id: 'op-1' } as never, 'op-1')
    expect(r.ok && r.status).toBe('already_applied')
  })
  it('error de NEGOCIO: definitivo, mensaje de operador con el detalle numérico, sin consultar estado', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'RECEPCION_EXCEDE_PENDIENTE: pendiente de recibir 40 (pedido 100, recibido 60).' } })
    const r = await runW1Command('recibir_lote', { p_op_id: 'op-2' } as never, 'op-2')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('RECEPCION_EXCEDE_PENDIENTE')
      expect(r.ambiguous).toBeUndefined()
      expect(r.error).toMatch(/supera lo pendiente/)
      expect(r.error).toMatch(/40/)
    }
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })
  it('falla de TRANSPORTE + el servidor SÍ la registró ⇒ éxito recuperado con el MISMO op_id', async () => {
    h.rpc
      .mockResolvedValueOnce({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } })
      .mockResolvedValueOnce({ data: { status: 'already_applied', order_id: 'O1' }, error: null })
    const r = await runW1Command('cancelar_pedido', { p_op_id: 'op-3' } as never, 'op-3')
    expect(r.ok && r.status).toBe('already_applied')
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'inv_estado_operacion', { p_op_id: 'op-3' })
  })
  it('falla de TRANSPORTE sin registro ⇒ AMBIGUO (nunca "no se aplicó")', async () => {
    h.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'network timeout' } })
      .mockResolvedValueOnce({ data: null, error: null })
    const r = await runW1Command('vender_pos', { p_order_id: 'op-4' } as never, 'op-4')
    expect(r).toEqual({ ok: false, ambiguous: true, error: AMBIGUO_MSG })
    expect(AMBIGUO_MSG).toMatch(/NO la duplicará/)
  })
  it('excepción del cliente HTTP ⇒ también ambiguo', async () => {
    h.rpc.mockRejectedValueOnce(new Error('Load failed')).mockResolvedValueOnce({ data: null, error: null })
    const r = await runW1Command('ajustar_lote', {} as never, 'op-5')
    expect(!r.ok && r.ambiguous).toBe(true)
  })
  it('valor escalar (vender_pos devuelve boolean) se envuelve', async () => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null })
    const r = await runW1Command<{ value?: boolean }>('vender_pos', {} as never, 'op-6')
    expect(r.ok && r.data.value).toBe(true)
  })
})

describe('mensajes y clasificación', () => {
  it('traduce códigos y conserva texto del servidor cuando no hay mapeo', () => {
    expect(w1Message('OP_ID_REUTILIZADO: el op_id x ya se usó')).toMatch(/Recarga la pantalla/)
    expect(w1Message('GUIA_ACTIVA: el pedido tiene una guía en estado succeeded; Dirección…')).toMatch(/guía de paquetería activa/)
    expect(w1Message('Inventario insuficiente en el lote 123')).toBe('Inventario insuficiente en el lote 123')
    expect(w1Code('LOTE_CADUCIDAD_DISTINTA: el lote A ya existe')).toBe('LOTE_CADUCIDAD_DISTINTA')
  })
  it('isAmbiguous: red sí; error de negocio/PG no', () => {
    expect(isAmbiguous({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true)
    expect(isAmbiguous({ message: 'CANTIDAD_INVALIDA: …', code: 'P0001' })).toBe(false)
    expect(isAmbiguous({ message: 'permission denied for function x', code: '42501' })).toBe(false)
  })
  it('newOpId genera UUIDs distintos', () => {
    const a = newOpId(), b = newOpId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
  })
})
