// @vitest-environment jsdom
// Smoke DOM (modo mock, sin Supabase): el picker de checkout y el gestor del perfil.
// En mock no hay doctor_locations → el picker cae al domicilio legacy / captura, y el gestor
// muestra el estado vacío. (El comportamiento por rol/RLS se valida en el E2E autenticado.)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { DeliveryLocationPicker } from './DeliveryLocationPicker'
import { DeliveryLocationsManager } from './DeliveryLocationsManager'

afterEach(cleanup)

describe('<DeliveryLocationPicker> (mock)', () => {
  it('con domicilio legacy usable lo ofrece y lo reporta como snapshot', async () => {
    const onChange = vi.fn()
    render(<DeliveryLocationPicker legacyBase={{ line1: 'Calle 1', city: 'CDMX' }} onChange={onChange} />)
    await waitFor(() => expect(screen.getByText('Usar el domicilio registrado')).toBeTruthy())
    expect(onChange).toHaveBeenCalledWith({ address: { line1: 'Calle 1', city: 'CDMX' } })
  })

  it('sin ubicaciones ni legacy → pide capturar una nueva (formulario)', async () => {
    const onChange = vi.fn()
    render(<DeliveryLocationPicker legacyBase={null} onChange={onChange} />)
    await waitFor(() => expect(screen.getByPlaceholderText(/Clínica Centro/)).toBeTruthy())
    // Sin datos válidos aún, no hay dirección elegible.
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe('<DeliveryLocationPicker> staff/POS (allowManage=false)', () => {
  it('con legacy del doctor: lo ofrece y NO muestra guardar/predeterminada', async () => {
    const onChange = vi.fn()
    render(<DeliveryLocationPicker doctorId="doc-legacy" legacyBase={{ line1: 'Calle 9', city: 'GDL' }} allowManage={false} onChange={onChange} />)
    await waitFor(() => expect(screen.getByText('Usar el domicilio registrado')).toBeTruthy())
    expect(screen.queryByText(/Guardar esta ubicación/)).toBeNull()
    expect(screen.queryByText(/Guardar como predeterminada/)).toBeNull()
    expect(onChange).toHaveBeenCalledWith({ address: { line1: 'Calle 9', city: 'GDL' } })
  })

  it('sin ubicaciones ni legacy: captura one-off (AddressPicker), sin alias ni guardar', async () => {
    const onChange = vi.fn()
    render(<DeliveryLocationPicker doctorId="doc-x" legacyBase={null} allowManage={false} onChange={onChange} />)
    await waitFor(() => expect(screen.getByPlaceholderText('Calle y número')).toBeTruthy())
    expect(screen.queryByPlaceholderText(/Clínica Centro/)).toBeNull() // sin formulario de alias
    expect(screen.queryByText(/Guardar esta ubicación/)).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith(null) // sin dirección usable aún
  })
})

describe('<DeliveryLocationsManager> (mock)', () => {
  it('muestra la sección y el estado vacío', async () => {
    render(<DeliveryLocationsManager />)
    expect(screen.getByText('Ubicaciones de entrega')).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/Aún no tienes ubicaciones/)).toBeTruthy())
  })
})
