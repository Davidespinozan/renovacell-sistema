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
import { validar, nombreTecnico, payloadMeta, errorMeta } from '../../../../../supabase/functions/_shared/plantillasMeta'

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
  it('Dirección ve el estado en Meta, el texto legible y la manda a revisión (se consulta a Meta al abrir)', async () => {
    const c = { ...cliente([{ ...SEG, activa: false, estado_meta: 'sin_enviar' }, { ...PRO, estado_meta: 'APPROVED' }]),
      sincronizar: vi.fn(async () => null), mandarAMeta: vi.fn(async () => ({ ok: true as const, estado: 'PENDING' })), guardar: vi.fn(async () => null), borrar: vi.fn(async () => null), escribirCliente: vi.fn() }
    render(<PlantillasMeta cliente={c} />)
    const filas = await screen.findAllByTestId('plantilla-meta')
    expect(filas[0]).toHaveTextContent('Hola [nombre del cliente], soy [nombre del vendedor]')
    expect(screen.getByTestId('plantilla-estado-seguimiento_vendedor')).toHaveTextContent('Sin mandar a Meta')
    expect(screen.getByTestId('plantilla-estado-promocion_vigente')).toHaveTextContent('Aprobada')
    expect(screen.queryByTestId('plantilla-mandar-promocion_vigente')).toBeNull()   // aprobada: ya no se manda ni se edita
    await waitFor(() => expect(c.sincronizar).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('plantilla-mandar-seguimiento_vendedor'))
    await waitFor(() => expect(c.mandarAMeta).toHaveBeenCalledWith('seguimiento_vendedor'))
    expect(await screen.findByTestId('plantillas-msg')).toHaveTextContent('se mandó a Meta')
  })
  it('crear una plantilla: datos, botones de respuesta y vista previa; se guarda numerada y se manda', async () => {
    const c = { ...cliente([]), sincronizar: vi.fn(async () => null), mandarAMeta: vi.fn(async () => ({ ok: true as const, estado: 'PENDING' })), guardar: vi.fn(async () => null), borrar: vi.fn(async () => null), escribirCliente: vi.fn() }
    render(<PlantillasMeta cliente={c} />)
    fireEvent.click(await screen.findByTestId('plantilla-nueva'))
    fireEvent.change(screen.getByTestId('plantilla-etiqueta'), { target: { value: 'Recordatorio de pedido' } })
    fireEvent.change(screen.getByTestId('plantilla-texto'), { target: { value: 'Hola {{cliente}}, soy {{vendedor}}. ¿Le preparo su pedido de este mes?' } })
    fireEvent.click(screen.getByTestId('plantilla-boton-mas'))
    fireEvent.change(screen.getByLabelText('Botón 1'), { target: { value: 'Sí, por favor' } })
    expect(screen.getByTestId('plantilla-vista')).toHaveTextContent('Hola [nombre del cliente], soy [nombre del vendedor]')
    fireEvent.click(screen.getByTestId('plantilla-guardar-mandar'))
    await waitFor(() => expect(c.guardar).toHaveBeenCalledWith({ nombre: 'recordatorio_de_pedido', etiqueta: 'Recordatorio de pedido', categoria: 'MARKETING',
      cuerpo: 'Hola {{1}}, soy {{2}}. ¿Le preparo su pedido de este mes?', variables: ['cliente', 'vendedor'], botones: ['Sí, por favor'] }))
    await waitFor(() => expect(c.mandarAMeta).toHaveBeenCalledWith('recordatorio_de_pedido'))
  })
  it('reglas de Meta revisadas antes de mandar', () => {
    const b = (texto: string, botones: string[] = []) => validar({ etiqueta: 'Prueba', categoria: 'MARKETING', texto, botones })
    expect(b('{{cliente}}, tenemos ofertas')).toMatchObject({ ok: false })                            // empieza con dato
    expect(b('Hola, gracias {{cliente}}')).toMatchObject({ ok: false })                               // termina con dato
    expect(b('Hola {{cliente}} {{vendedor}} aquí')).toMatchObject({ ok: false })                      // dos datos seguidos
    expect(b('Hola {{nombre}}, qué tal')).toMatchObject({ ok: false })                                // dato desconocido
    expect(b('Hola {{cliente}}, vence el {{promocion_hasta}} pronto')).toMatchObject({ ok: false })   // fecha sin promoción
    expect(b('Hola {{cliente}}, qué tal', ['a', 'b', 'c', 'd'])).toMatchObject({ ok: false })         // más de 3 botones
    expect(b('Hola {{cliente}}, le escribe {{vendedor}}; saludos {{cliente}} y buen día.')).toMatchObject({ ok: true, plantilla: { cuerpo: 'Hola {{1}}, le escribe {{2}}; saludos {{1}} y buen día.', variables: ['cliente', 'vendedor'] } })
    expect(nombreTecnico('Promoción Buen Fin!')).toBe('promocion_buen_fin')
  })
  it('lo que se manda a Meta: cuerpo numerado, ejemplo de cada dato y botones de respuesta rápida', () => {
    expect(payloadMeta({ nombre: 'x_y', categoria: 'UTILITY', cuerpo: 'Hola {{1}}, soy {{2}}.', variables: ['cliente', 'vendedor'], botones: ['Ok'] })).toEqual({
      name: 'x_y', language: 'es_MX', category: 'UTILITY', components: [
        { type: 'BODY', text: 'Hola {{1}}, soy {{2}}.', example: { body_text: [['Dra. López', 'Roberto']] } },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ok' }] }] })
    expect(errorMeta({ error_subcode: 2388023, message: 'x' })).toMatch(/Ya existe/)
  })
  it('cuerpo de plantilla para la API de WhatsApp', () => {
    expect(cuerpoPlantilla('521', 'seguimiento_vendedor', 'es_MX', ['Yara', 'Alejandra'])).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '521', type: 'template',
      template: { name: 'seguimiento_vendedor', language: { code: 'es_MX' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Yara' }, { type: 'text', text: 'Alejandra' }] }] },
    })
  })
})
