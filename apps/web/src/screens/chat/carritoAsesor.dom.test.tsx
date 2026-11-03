// @vitest-environment jsdom
// ENSAYO E2E (2 nov 2026) · El asesor ve el carrito DEL CLIENTE si existe; sin carrito del cliente no abre uno a su nombre
// (en producción eran cientos de 403 al día: la consulta corre cada 20 s y con cada mensaje).
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { CarritoPanel } from './CarritoPanel'
import type { ClienteCarrito } from '../../data/ops/carrito'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } }, currentUserId: () => null }))
afterEach(cleanup)

const falso = () => {
  const abrir = vi.fn(async () => ({ ok: false as const, error: { codigo: 'no_autorizado', mensaje: 'Solo visitantes y doctores tienen carrito.' } }))
  const ver = vi.fn(async () => ({ ok: false as const, error: { codigo: 'no_encontrado', mensaje: 'x' } }))
  return { abrir, ver, cliente: { abrir, ver } as unknown as ClienteCarrito }
}

describe('CarritoPanel del asesor', () => {
  it('sin carrito del cliente: no abre uno a nombre del asesor', async () => {
    const f = falso()
    render(<CarritoPanel conversationId={null} cartId={null} soloLectura cliente={f.cliente} intervaloMs={50} />)
    await new Promise((r) => setTimeout(r, 200))
    expect(f.abrir).not.toHaveBeenCalled()
    expect(f.ver).not.toHaveBeenCalled()
  })
  it('con carrito del cliente: lo consulta por su id', async () => {
    const f = falso()
    render(<CarritoPanel conversationId={null} cartId="cart-1" soloLectura cliente={f.cliente} intervaloMs={60_000} />)
    await waitFor(() => expect(f.ver).toHaveBeenCalledWith('cart-1'))
    expect(f.abrir).not.toHaveBeenCalled()
  })
})
