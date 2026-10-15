// @vitest-environment jsdom
// CANCELACIÓN (162) · solicitar con motivo, el aviso sobre el pedido (Dirección resuelve ahí) y el bloqueo de envío.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AvisoCancelacion, SolicitarCancelacion } from './Cancelacion'
import colaSrc from '../screens/packing/Cola.tsx?raw'
import c360Src from './Customer360.tsx?raw'
import shippingSrc from '../../../../supabase/functions/shipping/index.ts?raw'
import mig from '../../../../supabase/migrations/20261215120000_cancelacion_solicitudes.sql?raw'

afterEach(cleanup)
const sol = { id: 'R1', order_id: 'O1', requester_role: 'warehouse', reason: 'Caja dañada', created_at: '2026-10-15T18:00:00Z' }

describe('Cancelación solicitada', () => {
  it('solicitar: pide motivo (mínimo 5 letras) y ofrece motivos frecuentes', () => {
    render(<SolicitarCancelacion orderId="O1" folio="S100001" />)
    fireEvent.click(screen.getByTestId('btn-solicitar-cancelacion'))
    const enviar = screen.getByTestId('enviar-solicitud-cancelacion') as HTMLButtonElement
    expect(enviar.disabled).toBe(true)
    fireEvent.click(screen.getByText('Pedido duplicado'))
    expect((screen.getByTestId('motivo-cancelacion') as HTMLTextAreaElement).value).toBe('Pedido duplicado')
    expect(enviar.disabled).toBe(false)
  })
  it('el aviso dice quién y por qué; solo Dirección ve Aprobar / No cancelar (y "no cancelar" pide la razón)', () => {
    const { rerender } = render(<AvisoCancelacion solicitud={sol} esDireccion={false} />)
    expect(screen.getByTestId('aviso-cancelacion').textContent).toMatch(/Cancelación solicitada por Almacén.*Caja dañada/)
    expect(screen.queryByTestId('aprobar-cancelacion')).toBeNull()
    rerender(<AvisoCancelacion solicitud={sol} esDireccion />)
    fireEvent.click(screen.getByTestId('rechazar-cancelacion'))
    expect((screen.getByTestId('confirmar-rechazo-cancelacion') as HTMLButtonElement).disabled).toBe(true)
  })
  it('Por enviar: con solicitud pendiente no se asigna envío; Dirección cancela directo y los demás solicitan', () => {
    expect(colaSrc).toMatch(/disabled=\{!!sol\}/)
    expect(colaSrc).toMatch(/esDireccion\s*\n?\s*\? <button[^\n]*Cancelar pedido/)
    expect(c360Src).toMatch(/<SolicitarCancelacion key="c"/)
  })
  it('servidor: la Edge de guías y la base bloquean el envío; los avisos salen al cancelar por cualquier camino', () => {
    expect(shippingSrc.indexOf("from('order_cancel_requests')")).toBeLessThan(shippingSrc.indexOf("from('shipping_attempts')\n        .insert"))
    expect(mig).toMatch(/create trigger order_cancellations_avisos after insert on public\.order_cancellations/)
    expect(mig).toMatch(/v_res := public\.cancelar_pedido\(/)   // aprobar = la cancelación de siempre (mismas reglas)
  })
})
