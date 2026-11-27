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
  // 27 nov 2026 (dueño: «¿le avisa si hubo un problema y si necesita modificar datos? ¿le avisa que ya le envió la factura?»)
  it('al timbrar dice si el correo SÍ se le envió al cliente', async () => {
    render(<TimbrarCFDI docId="d1" modo="timbrar" onCambio={() => {}} cliente={falso()} />)
    fireEvent.click(await screen.findByTestId('cfdi-timbrar-btn'))
    expect(await screen.findByTestId('cfdi-correo-ok')).toHaveTextContent('Se envió al correo')
    expect(screen.queryByTestId('cfdi-correo-no')).toBeNull()
  })
  it('si el correo NO salió lo dice claro y manda a enviarla a mano o por WhatsApp (ya no se queda callado)', async () => {
    render(<TimbrarCFDI docId="d1" modo="timbrar" onCambio={() => {}} cliente={falso({ timbrar: vi.fn(async () => ({ status: 'timbrado', message: 'CFDI REN-1 timbrado.', correo_enviado: false })) })} />)
    fireEvent.click(await screen.findByTestId('cfdi-timbrar-btn'))
    const n = await screen.findByTestId('cfdi-correo-no')
    expect(n).toHaveTextContent('No se confirmó el envío por correo'); expect(n).toHaveTextContent('Enviar por WhatsApp')
    expect(screen.queryByTestId('cfdi-correo-ok')).toBeNull()
    cleanup()
    render(<TimbrarCFDI docId="d1" modo="timbrar" onCambio={() => {}} cliente={falso({ timbrar: vi.fn(async () => ({ status: 'timbrado', message: 'CFDI REN-1 timbrado.', correo_enviado: false, correo_falta: true })) })} />)
    fireEvent.click(await screen.findByTestId('cfdi-timbrar-btn'))
    expect(await screen.findByTestId('cfdi-correo-no')).toHaveTextContent('El cliente no dejó correo')
  })
  it('si Facturama la rechaza: enseña el motivo y dice dónde se corrige; no habla de correo', async () => {
    render(<TimbrarCFDI docId="d1" modo="timbrar" onCambio={() => {}} cliente={falso({ timbrar: vi.fn(async () => ({ status: 'fallido', message: 'Facturama lo rechazó: El nombre del receptor no coincide con el RFC.' })) })} />)
    fireEvent.click(await screen.findByTestId('cfdi-timbrar-btn'))
    const r = await screen.findByTestId('cfdi-resultado')
    expect(r).toHaveTextContent('El nombre del receptor no coincide con el RFC.')
    expect(screen.getByTestId('cfdi-que-hacer')).toHaveTextContent('Datos fiscales del pedido'); expect(screen.getByTestId('cfdi-que-hacer')).toHaveTextContent('Revisión fiscal')
    expect(screen.queryByTestId('cfdi-correo-no')).toBeNull(); expect(screen.queryByTestId('cfdi-correo-ok')).toBeNull()
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
