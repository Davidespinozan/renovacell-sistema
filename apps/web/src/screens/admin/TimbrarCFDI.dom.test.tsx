// @vitest-environment jsdom
// TIMBRADO REAL (2 nov 2026) · lo que falta se dice (y se va a Revisión fiscal); listo + conectado = botón Timbrar;
// tarjeta pide crédito o débito; incierto solo concilia.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { TimbrarCFDI } from './TimbrarCFDI'
import type { ClienteCfdiTimbrado } from '../../data/ops/cfdiTimbrado'

beforeEach(() => { cleanup(); vi.spyOn(window, 'confirm').mockReturnValue(true) })
const listo = { listo: true, configurado: true, entorno: 'sandbox' as const, faltantes: [], resumen: { conceptos: 2, subtotal: 2000, iva: 320, total: 2320, forma_pago: '03' } }
const falso = (over: Partial<ClienteCfdiTimbrado> = {}): ClienteCfdiTimbrado => ({
  preparar: async () => listo,
  timbrar: vi.fn(async () => ({ status: 'timbrado', message: 'CFDI REN-1 timbrado.', correo_enviado: true })),
  conciliar: vi.fn(async () => ({ status: 'timbrado', message: 'La factura sí existía en Facturama: quedó registrada.' })),
  ...over,
})

describe('<TimbrarCFDI>', () => {
  it('sin claves: dice qué falta y no ofrece timbrar', async () => {
    render(<TimbrarCFDI docId="d1" modo="timbrar" onCambio={() => {}} cliente={falso({ preparar: async () => ({ listo: false, configurado: true, faltantes: ['Botox 100: falta clave de producto o servicio (SAT)'] }) })} />)
    expect(await screen.findByTestId('cfdi-faltantes')).toHaveTextContent('Botox 100: falta clave')
    expect(screen.queryByTestId('cfdi-timbrar-btn')).toBeNull()
  })
  it('listo: resumen con ambiente de pruebas y timbra', async () => {
    const c = falso(); const onCambio = vi.fn()
    render(<TimbrarCFDI docId="d1" modo="timbrar" onCambio={onCambio} cliente={c} />)
    expect(await screen.findByTestId('cfdi-resumen')).toHaveTextContent('PRUEBAS')
    fireEvent.click(screen.getByTestId('cfdi-timbrar-btn'))
    expect(await screen.findByTestId('cfdi-resultado')).toHaveTextContent('CFDI REN-1 timbrado.')
    expect(c.timbrar).toHaveBeenCalledWith('d1', null); expect(onCambio).toHaveBeenCalled()
  })
  it('cobro con tarjeta: pide crédito o débito', async () => {
    render(<TimbrarCFDI docId="d1" modo="timbrar" onCambio={() => {}} cliente={falso({ preparar: async () => ({ listo: false, configurado: true, requiere_forma_tarjeta: true, faltantes: ['Se cobró con tarjeta: indica si fue de crédito (04) o débito (28).'] }) })} />)
    expect(await screen.findByTestId('cfdi-forma')).toBeInTheDocument()
  })
  it('sin Facturama conectado: lista para timbrar pero sin botón', async () => {
    render(<TimbrarCFDI docId="d1" modo="timbrar" onCambio={() => {}} cliente={falso({ preparar: async () => ({ ...listo, configurado: false, entorno: null }) })} />)
    expect(await screen.findByText(/todavía no está conectado/)).toBeInTheDocument()
    expect(screen.queryByTestId('cfdi-timbrar-btn')).toBeNull()
  })
  it('incierto: solo concilia', async () => {
    const c = falso()
    render(<TimbrarCFDI docId="d1" modo="conciliar" onCambio={() => {}} cliente={c} />)
    fireEvent.click(screen.getByRole('button', { name: /Conciliar con Facturama/ }))
    await waitFor(() => expect(c.conciliar).toHaveBeenCalledWith('d1', null))
    expect(c.timbrar).not.toHaveBeenCalled()
  })
})
