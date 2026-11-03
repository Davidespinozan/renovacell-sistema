// @vitest-environment jsdom
// WA-PLANTILLAS (3 nov 2026) · fuera de las 24 h: retomar con una plantilla aprobada (vista previa, promoción), llamar o
// abrir WhatsApp; Dirección activa las plantillas cuando Meta las aprueba; y el formato que sale a Meta.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { RetomarWhatsApp } from './RetomarWhatsApp'
import { PlantillasMeta } from '../admin/PlantillasMeta'
import { mensajePlantilla, vistaPrevia, type PlantillaWA } from '../../data/ops/plantillasWA'
import { cuerpoPlantilla } from '../../../../../supabase/functions/_shared/whatsapp'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const SEG: PlantillaWA = { nombre: 'seguimiento_vendedor', etiqueta: 'Seguimiento', categoria: 'MARKETING', cuerpo: 'Hola {{1}}, soy {{2}}, tu asesor(a) de Renovacell.', variables: ['cliente', 'vendedor'], activa: true }
const PRO: PlantillaWA = { nombre: 'promocion_vigente', etiqueta: 'Promoción', categoria: 'MARKETING', cuerpo: 'Hola {{1}}, tenemos la promoción {{2}} vigente hasta el {{3}}.', variables: ['cliente', 'promocion', 'promocion_hasta'], activa: true }
const cliente = (lista: PlantillaWA[], enviar = vi.fn(async () => ({ ok: true as const, texto: 'x' }))) => ({
  lista: vi.fn(async () => lista), promos: vi.fn(async () => [{ promocion_id: 'PM1', nombre: 'Buen Fin', hasta: '2026-11-17' }]), enviar, activar: vi.fn(async () => null),
})

describe('Retomar por WhatsApp', () => {
  it('ofrece llamar y abrir su WhatsApp siempre; elige plantilla, ve cómo le llega y la manda', async () => {
    const c = cliente([SEG, PRO]); const onEnviada = vi.fn()
    render(<RetomarWhatsApp conversationId="C1" waId="5216671234567" nombreCliente="YARA LÓPEZ" onEnviada={onEnviada} cliente={c} />)
    expect(screen.getByText('Llamar').closest('a')!.getAttribute('href')).toBe('tel:+5216671234567')
    expect(screen.getByText('Abrir en mi WhatsApp').closest('a')!.getAttribute('href')).toBe('https://wa.me/5216671234567')
    fireEvent.click(screen.getByTestId('wa-retomar-abrir'))
    fireEvent.click(await screen.findByTestId('wa-plantilla-seguimiento_vendedor'))
    expect(screen.getByTestId('wa-vista')).toHaveTextContent('Hola Yara, soy tu nombre, tu asesor(a) de Renovacell.')
    fireEvent.click(screen.getByTestId('wa-plantilla-mandar'))
    await waitFor(() => expect(c.enviar).toHaveBeenCalledWith('C1', 'seguimiento_vendedor', null))
    expect(await screen.findByTestId('wa-plantilla-msg')).toHaveTextContent('Plantilla enviada')
    expect(onEnviada).toHaveBeenCalled()
  })
  it('la de promoción pide elegir una vigente', async () => {
    const c = cliente([PRO])
    render(<RetomarWhatsApp conversationId="C1" waId="521" nombreCliente="Beto" onEnviada={() => {}} cliente={c} />)
    fireEvent.click(screen.getByTestId('wa-retomar-abrir'))
    fireEvent.click(await screen.findByTestId('wa-plantilla-promocion_vigente'))
    expect((screen.getByTestId('wa-plantilla-mandar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(await screen.findByTestId('wa-promo'), { target: { value: 'PM1' } })
    expect(screen.getByTestId('wa-vista')).toHaveTextContent('Hola Beto, tenemos la promoción Buen Fin vigente hasta el')
    fireEvent.click(screen.getByTestId('wa-plantilla-mandar'))
    await waitFor(() => expect(c.enviar).toHaveBeenCalledWith('C1', 'promocion_vigente', 'PM1'))
  })
  it('sin plantillas aprobadas lo dice y deja llamar o abrir WhatsApp', async () => {
    render(<RetomarWhatsApp conversationId="C1" waId="521" nombreCliente={null} onEnviada={() => {}} cliente={cliente([])} />)
    fireEvent.click(screen.getByTestId('wa-retomar-abrir'))
    expect(await screen.findByTestId('wa-sin-plantillas')).toHaveTextContent('Todavía no hay plantillas aprobadas por Meta')
  })
  it('motivos del servidor en palabras del vendedor', () => {
    expect(mensajePlantilla('PLANTILLA_RECIENTE: ya se le mandó una plantilla en las últimas 24 horas; espera a que conteste')).toBe('Ya se le mandó una plantilla en las últimas 24 horas; espera a que conteste.')
    expect(mensajePlantilla('NO_AUTORIZADO: no es tu cliente')).toBe('Este cliente no es de tu cartera.')
    expect(vistaPrevia(SEG, {})).toBe('Hola [cliente], soy [vendedor], tu asesor(a) de Renovacell.')
  })
})

describe('Plantillas (Dirección) y formato de Meta', () => {
  it('Dirección ve nombre, categoría y texto exactos y la activa cuando Meta la aprueba', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = cliente([{ ...SEG, activa: false }])
    render(<PlantillasMeta cliente={c} />)
    const fila = await screen.findByTestId('plantilla-meta')
    expect(fila).toHaveTextContent('seguimiento_vendedor'); expect(fila).toHaveTextContent('Marketing'); expect(fila).toHaveTextContent('{{1}} = nombre del cliente')
    fireEvent.click(screen.getByTestId('plantilla-activa-seguimiento_vendedor'))
    await waitFor(() => expect(c.activar).toHaveBeenCalledWith('seguimiento_vendedor', true))
  })
  it('cuerpo de plantilla para la API de WhatsApp', () => {
    expect(cuerpoPlantilla('521', 'seguimiento_vendedor', 'es_MX', ['Yara', 'Alejandra'])).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '521', type: 'template',
      template: { name: 'seguimiento_vendedor', language: { code: 'es_MX' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Yara' }, { type: 'text', text: 'Alejandra' }] }] },
    })
  })
})
