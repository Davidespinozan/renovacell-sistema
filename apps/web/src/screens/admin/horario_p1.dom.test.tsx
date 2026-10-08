// @vitest-environment jsdom
// HORARIO-P1 · frontend: contrato intacto con cc_horario_guardar (zona + 7 días L–S 10:00–18:00, domingo cerrado);
// un error NO reconocido no se muestra crudo: genérico + referencia corta, y se reporta (sanitizado) con esa misma
// referencia; los errores conocidos y de red conservan su texto; tras un guardado EXITOSO la tarjeta «Alertas por
// tiempo de espera» se relee (desaparece «Horario comercial pendiente»). Cliente real con RPC falsa: sin servidor.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { HorarioYAlertas } from './HorarioAtencion'
import { ClienteAtencion, ERROR_GENERICO, mensajeError, referenciaError, type DiaHorario } from '../../data/ops/atencion'

beforeEach(cleanup)

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const semanaVacia: DiaHorario[] = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia: d, abierto: false, abre: null, cierra: null }))
const sinConfigurar = { configurado: false, abierto: false, zona: 'America/Mazatlan', motivo: 'sin_configurar' }
const horario = (configurado: boolean, semana: DiaHorario[] = semanaVacia) => ({ zona: 'America/Mazatlan', configurado, actualizado_at: 'T', semana, excepciones: [], estado: configurado ? { configurado: true, abierto: false, zona: 'America/Mazatlan', motivo: 'fuera_de_horario' } : sinConfigurar })
const config = (configurado: boolean) => ({ aviso_min: 3, escalamiento_min: 7, pausar_fuera_horario: true, updated_at: null, horario: configurado ? { configurado: true, abierto: false, zona: 'America/Mazatlan', motivo: 'fuera_de_horario' } : sinConfigurar })

/** RPC falsa por función; `guardar` decide la respuesta de cc_horario_guardar. */
function falso(guardar: (args: Record<string, unknown>) => { data: unknown; error: { message?: string } | null } | Promise<never>) {
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  let guardado = false
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    llamadas.push({ fn, args })
    if (fn === 'cc_horario_ver') return { data: horario(guardado), error: null }
    if (fn === 'cc_atencion_config_ver') return { data: config(guardado), error: null }
    if (fn === 'cc_horario_guardar') { const r = await guardar(args ?? {}); if (!r.error) guardado = true; return r }
    return { data: null, error: { message: 'x' } }
  }
  const reportar = vi.fn()
  return { c: new ClienteAtencion(rpc, reportar), llamadas, reportar, de: (fn: string) => llamadas.filter((l) => l.fn === fn) }
}

/** El dueño marca L–S 10:00–18:00 y deja domingo cerrado (sin tocar la zona: America/Mazatlan). */
function capturarLaS() {
  for (const d of DIAS.slice(0, 6)) {
    fireEvent.click(screen.getByLabelText(`${d} abierto`))
    fireEvent.change(screen.getByLabelText(`${d} abre`), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText(`${d} cierra`), { target: { value: '18:00' } })
  }
}

describe('HORARIO-P1 · formulario y contrato', () => {
  it('la zona America/Mazatlan está disponible; L–S 10:00–18:00 y domingo cerrado viajan con el contrato exacto', async () => {
    const semanaOk = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia: d, abierto: d <= 6, abre: d <= 6 ? '10:00' : null, cierra: d <= 6 ? '18:00' : null }))
    const f = falso(() => ({ data: horario(true, semanaOk), error: null }))
    render(<HorarioYAlertas cliente={f.c} />)
    await screen.findAllByTestId('horario-dia')
    const zona = screen.getByLabelText('Zona horaria') as HTMLSelectElement
    expect(zona.value).toBe('America/Mazatlan')
    expect(Array.prototype.map.call(zona.options, (o: HTMLOptionElement) => o.value)).toContain('America/Mazatlan')
    capturarLaS()
    expect(screen.getByLabelText('Domingo abierto')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('horario-guardar'))
    await waitFor(() => expect(f.de('cc_horario_guardar')).toHaveLength(1))
    expect(f.de('cc_horario_guardar')[0].args).toEqual({ p_zona: 'America/Mazatlan', p_semana: semanaOk })
  })
})

describe('HORARIO-P1 · éxito refresca la tarjeta de alertas', () => {
  it('guardado exitoso: «Horario guardado.», estado configurado y la tarjeta de alertas se relee (sin «pendiente»)', async () => {
    const f = falso(({ p_semana }) => ({ data: horario(true, p_semana as typeof semanaVacia), error: null }))
    render(<HorarioYAlertas cliente={f.c} />)
    expect(await screen.findByTestId('config-sin-horario')).toHaveTextContent('Horario comercial pendiente de configurar')
    expect(f.de('cc_atencion_config_ver')).toHaveLength(1)
    capturarLaS()
    fireEvent.click(screen.getByTestId('horario-guardar'))
    expect(await screen.findByText('Horario guardado.')).toBeInTheDocument()
    await waitFor(() => expect(f.de('cc_atencion_config_ver')).toHaveLength(2))
    await waitFor(() => expect(screen.queryByTestId('config-sin-horario')).toBeNull())
    expect(screen.getByTestId('horario-estado').textContent).not.toMatch(/SIN CONFIGURAR/)
  })
})

describe('HORARIO-P1 · errores', () => {
  it('error NO reconocido: genérico + referencia; el detalle interno no se muestra y se reporta con la misma referencia; la tarjeta NO se relee', async () => {
    const f = falso(() => ({ data: null, error: { message: 'DELETE requires a WHERE clause' } }))
    render(<HorarioYAlertas cliente={f.c} />)
    await screen.findByTestId('config-sin-horario')
    capturarLaS()
    fireEvent.click(screen.getByTestId('horario-guardar'))
    const alerta = await screen.findByText(/No se pudo completar/)
    expect(alerta.textContent).toMatch(/^No se pudo completar\. Intenta de nuevo\. Si se repite, comparte la referencia ATN-[0-9A-Z]{6} con soporte\.$/)
    expect(screen.queryByText(/WHERE|DELETE/)).toBeNull()
    const ref = alerta.textContent!.match(/ATN-[0-9A-Z]{6}/)![0]
    expect(f.reportar).toHaveBeenCalledTimes(1)
    const [err, ctx] = f.reportar.mock.calls[0]
    expect(ctx).toEqual({ pantalla: 'atencion', clasificacion: 'rpc_no_reconocido', code: ref })
    expect(String((err as Error).message)).toMatch(/^atencion:cc_horario_guardar · /)
    expect(f.de('cc_atencion_config_ver')).toHaveLength(1)   // sin éxito no hay refresco
    expect(screen.getByTestId('config-sin-horario')).toBeInTheDocument()
    expect(screen.getByTestId('horario-estado')).toHaveTextContent('SIN CONFIGURAR')
  })
  it.each([
    ['NO_AUTORIZADO: solo Dirección', 'Solo Dirección administra la atención comercial.'],
    ['HORARIO_INVALIDO: la apertura debe ser antes del cierre', 'La hora de apertura debe ser antes de la de cierre.'],
    ['ZONA_INVALIDA', 'La zona horaria no es válida.'],
  ])('error conocido (%s): su texto, sin referencia ni reporte', async (msg, texto) => {
    const f = falso(() => ({ data: null, error: { message: msg } }))
    render(<HorarioYAlertas cliente={f.c} />)
    await screen.findAllByTestId('horario-dia')
    capturarLaS()
    fireEvent.click(screen.getByTestId('horario-guardar'))
    expect(await screen.findByText(texto)).toBeInTheDocument()
    expect(screen.queryByText(/ATN-/)).toBeNull(); expect(f.reportar).not.toHaveBeenCalled()
  })
  it('fallo de red: aviso de conexión (sin referencia)', async () => {
    const f = falso(() => Promise.reject(new Error('net')))
    render(<HorarioYAlertas cliente={f.c} />)
    await screen.findAllByTestId('horario-dia')
    capturarLaS()
    fireEvent.click(screen.getByTestId('horario-guardar'))
    expect(await screen.findByText('No hay conexión con el servidor. Intenta de nuevo.')).toBeInTheDocument()
    expect(f.reportar).not.toHaveBeenCalled()
  })
  it('la referencia es corta y no lleva datos; un reportador que falla no rompe la pantalla', async () => {
    expect(referenciaError()).toMatch(/^ATN-[0-9A-Z]{6}$/)
    expect(mensajeError('algo interno raro')).toBe(ERROR_GENERICO)
    const rpc = async () => ({ data: null, error: { message: 'boom interno' } })
    const c = new ClienteAtencion(rpc, () => { throw new Error('telemetría caída') })
    const r = await c.guardarHorario('America/Mazatlan', semanaVacia)
    expect(r.ok).toBe(false); expect(!r.ok && r.error).toMatch(/ATN-/)
  })
})
