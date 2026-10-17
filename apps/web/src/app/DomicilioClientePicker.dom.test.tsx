// @vitest-environment jsdom
// ENT-2 · Domicilio del cliente comercial al levantar pedido: lista los guardados (principal preseleccionado), otra
// dirección solo para el pedido, o uno nuevo guardado en el cliente por el comando del servidor (cliente_ubicacion_guardar).
import React, { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DomicilioClientePicker, type DomicilioElegido } from './DomicilioClientePicker'

vi.mock('../lib/supabase', () => ({ hasSupabase: true, currentUserId: () => 'U1', supabase: { rpc: vi.fn(), from: vi.fn() } }))
vi.mock('./AddressPicker', () => ({ AddressPicker: ({ onChange }: { onChange: (a: unknown) => void }) => <button type="button" onClick={() => onChange({ line1: 'Calle 9', cp: '80020', city: 'Culiacán', phone: '6671234567' })}>otra</button> }))
vi.mock('./LocationForm', () => ({ EMPTY_LOCATION: {}, isLocationValid: (f: { line1?: string }) => !!f.line1, LocationForm: ({ onChange }: { onChange: (f: unknown) => void }) => <button type="button" onClick={() => onChange({ name: 'Bodega', line1: 'Av. Nueva 5', postal_code: '80030', city: 'Culiacán', state: 'Sinaloa', contact_phone: '6670000000' })}>llenar</button> }))
beforeEach(cleanup)

const L = (id: string, extra: Record<string, unknown> = {}) => ({ id, doctor_id: null, customer_id: 'C1', name: 'Consultorio ' + id, line1: 'Av. ' + id, exterior_number: '1', interior_number: null, neighborhood: 'Centro', postal_code: '82000', city: 'Mazatlán', state: 'Sinaloa', country: 'México', reference_notes: null, contact_name: null, contact_phone: '6691234567', is_default: false, active: true, created_at: '', updated_at: '', ...extra })

function Arnes({ lista, cliente }: { lista: ReturnType<typeof L>[]; cliente?: { guardarDomicilio: (...a: unknown[]) => Promise<unknown> } }) {
  const [v, setV] = useState<DomicilioElegido | null>(null)
  const listar = vi.fn(async () => lista as never)
  return <div><DomicilioClientePicker customerId="C1" onChange={setV} listar={listar} cliente={(cliente ?? { guardarDomicilio: async () => ({ ok: false, error: 'x' }) }) as never} /><pre data-testid="valor">{JSON.stringify(v)}</pre></div>
}

describe('ENT-2 · DomicilioClientePicker', () => {
  it('preselecciona el principal y reporta el snapshot con su id', async () => {
    render(<Arnes lista={[L('A'), L('B', { is_default: true })]} />)
    await waitFor(() => expect(screen.getByTestId('domicilio-B').querySelector('input')).toBeChecked())
    expect(screen.getByTestId('valor')).toHaveTextContent('"locationId":"B"'); expect(screen.getByTestId('valor')).toHaveTextContent('"cp":"82000"')
    fireEvent.click(screen.getByTestId('domicilio-A'))
    expect(screen.getByTestId('valor')).toHaveTextContent('"locationId":"A"')
  })
  it('varios sin principal: no se elige en silencio; un guardado incompleto no se acepta', async () => {
    render(<Arnes lista={[L('A'), L('B', { postal_code: '' })]} />)
    await waitFor(() => expect(screen.getByTestId('domicilio-A')).toBeInTheDocument())
    expect(screen.getByTestId('valor')).toHaveTextContent('null')
    fireEvent.click(screen.getByTestId('domicilio-B'))
    expect(screen.getByTestId('domicilio-incompleto')).toBeInTheDocument(); expect(screen.getByTestId('valor')).toHaveTextContent('null')
  })
  it('sin domicilios: captura una dirección solo para el pedido', async () => {
    render(<Arnes lista={[]} />)
    await waitFor(() => expect(screen.getByText('otra')).toBeInTheDocument())
    fireEvent.click(screen.getByText('otra'))
    expect(screen.getByTestId('valor')).toHaveTextContent('"line1":"Calle 9"'); expect(screen.getByTestId('valor')).not.toHaveTextContent('locationId')
  })
  it('agregar al cliente: guarda por el comando del servidor y queda elegido', async () => {
    const guardarDomicilio = vi.fn(async () => ({ ok: true, data: { id: 'N1' } }))
    const lista = [L('A')]
    const listar = vi.fn(async () => (guardarDomicilio.mock.calls.length ? [...lista, L('N1', { name: 'Bodega', postal_code: '80030', city: 'Culiacán' })] : lista) as never)
    const Caso = () => { const [v, setV] = useState<DomicilioElegido | null>(null); return <div><DomicilioClientePicker customerId="C1" onChange={setV} listar={listar} cliente={{ guardarDomicilio } as never} /><pre data-testid="valor">{JSON.stringify(v)}</pre></div> }
    render(<Caso />)
    await waitFor(() => expect(screen.getByTestId('domicilio-nuevo')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('domicilio-nuevo')); fireEvent.click(screen.getByText('llenar')); fireEvent.click(screen.getByTestId('domicilio-guardar'))
    await waitFor(() => expect(screen.getByTestId('valor')).toHaveTextContent('"locationId":"N1"'))
    expect(guardarDomicilio).toHaveBeenCalledWith('C1', null, expect.objectContaining({ line1: 'Av. Nueva 5', postal_code: '80030', tipo: 'OTRO' }), false)
  })
})
