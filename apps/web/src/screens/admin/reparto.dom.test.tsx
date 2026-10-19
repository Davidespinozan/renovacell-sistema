// @vitest-environment jsdom
// REPARTO (181) · Dirección activa el reparto al azar de solicitudes sin vendedor, el plazo para pasarla a otro y si quien la
// toma se queda con la cartera; la tarjeta no se inventa si el servidor no trae 'reparto'; el vendedor ve cuánto tiene antes
// de que pase a otro.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ConfigReparto } from './HorarioAtencion'
import { ClienteAtencion, type ConfigAtencion } from '../../data/ops/atencion'
import { textoEspera, ETIQUETA_ATENCION, tonoAtencion, type Atencion } from '../../data/ops/atencionComercial'
beforeEach(cleanup)

const horario = { configurado: true, abierto: true, zona: 'America/Mazatlan', motivo: 'abierto' }
const CFG: ConfigAtencion = { aviso_min: 3, escalamiento_min: 5, pausar_fuera_horario: true, updated_at: null, horario, reparto: { activo: true, min: 5, fija_cartera: true, vendedores_elegibles: 3 } }
function cliente(cfg: ConfigAtencion) {
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    llamadas.push({ fn, args })
    if (fn === 'cc_atencion_config_ver') return { data: cfg, error: null }
    if (fn === 'cc_atencion_reparto_guardar') return { data: { ...cfg, reparto: { ...cfg.reparto!, activo: args!.p_activo as boolean, min: args!.p_min as number, fija_cartera: args!.p_fija as boolean } }, error: null }
    return { data: null, error: { message: 'no' } }
  }
  return { c: new ClienteAtencion(rpc, () => {}), llamadas }
}

describe('REPARTO · configuración de Dirección', () => {
  it('lee la configuración y guarda por el comando con activo, minutos y cartera', async () => {
    const { c, llamadas } = cliente(CFG)
    render(<ConfigReparto cliente={c} />)
    await waitFor(() => expect((screen.getByTestId('rep-activo') as HTMLInputElement).checked).toBe(true))
    expect((screen.getByTestId('rep-min') as HTMLInputElement).value).toBe('5')
    expect(screen.getByTestId('rep-elegibles')).toHaveTextContent('3 vendedores reciben clientes nuevos.')
    fireEvent.change(screen.getByTestId('rep-min'), { target: { value: '8' } })
    fireEvent.click(screen.getByTestId('rep-fija'))
    fireEvent.click(screen.getByTestId('rep-guardar'))
    await waitFor(() => expect(llamadas.some((l) => l.fn === 'cc_atencion_reparto_guardar')).toBe(true))
    expect(llamadas.find((l) => l.fn === 'cc_atencion_reparto_guardar')!.args).toEqual({ p_activo: true, p_min: 8, p_fija: false })
    expect(screen.getByRole('status')).toHaveTextContent('Reparto activo.')
  })
  it('minutos inválidos no se mandan; sin vendedores elegibles avisa; sin "reparto" del servidor no dibuja la tarjeta', async () => {
    const { c, llamadas } = cliente({ ...CFG, reparto: { ...CFG.reparto!, vendedores_elegibles: 0 } })
    render(<ConfigReparto cliente={c} />)
    expect(await screen.findByTestId('reparto-sin-vendedores')).toHaveTextContent(/Ningún vendedor recibe clientes nuevos/)
    fireEvent.change(screen.getByTestId('rep-min'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('rep-guardar'))
    expect(screen.getByRole('alert')).toHaveTextContent(/enteros de 1 a 1440/)
    expect(llamadas.some((l) => l.fn === 'cc_atencion_reparto_guardar')).toBe(false)
    cleanup()
    const viejo = cliente({ ...CFG, reparto: undefined })
    render(<ConfigReparto cliente={viejo.c} />)
    await waitFor(() => expect(viejo.llamadas.length).toBe(1))
    expect(screen.queryByTestId('config-reparto')).toBeNull()
  })
  it('el vendedor ve la solicitud repartida con su plazo y el intento', () => {
    const a = { estado: 'reparto', modo: 'human_assigned', handoff_estado: null, handler_id: 'S1', ruteo_motivo: 'reparto', solicitado_at: null, handler_asignado_at: null, iniciado_at: null, terminado_at: null,
      espera_total_min: 2, espera_total_habil_min: 2, espera_handler_min: 2, espera_handler_habil_min: 2, reloj_sla_min: 2, horario_configurado: true, en_horario: true, pausa_fuera_horario: true,
      umbral_aviso_min: 3, umbral_escalamiento_min: 5, ia_activa: true, reparto: { activo: true, umbral_min: 5, intento: 2, en_reparto: true } } as Atencion
    expect(ETIQUETA_ATENCION.reparto).toBe('Repartida · esperando que la tomen'); expect(tonoAtencion('reparto')).toBe('warn')
    expect(textoEspera(a)).toBe('2 min hábiles esperando · si nadie la inicia en 5 min pasa a otro asesor (intento 2)')
    expect(textoEspera({ ...a, reparto: { ...a.reparto!, intento: 1 } })).toBe('2 min hábiles esperando · si nadie la inicia en 5 min pasa a otro asesor')
  })
})
