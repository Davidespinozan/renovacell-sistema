// @vitest-environment jsdom
// R4-C5-A2 · el panel muestra el ESTADO REAL del modo prueba (nunca "Espejo"): cuántos contactos autorizados, número
// enmascarado y vencimiento; distingue prueba operativa de prueba sin permisos vigentes; "Volver a espejo" disponible en
// prueba; "Encender IA" solo si el servidor reporta la prueba operativa; Pausar/Reanudar/Apagar IA se conservan; la
// bandeja dice "prueba". Servidor FALSO: sin red ni mensajes reales.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { PanelOperativoCanal } from './CanalOperacion'
import { AtencionComercial } from './AtencionComercial'
import { ClienteCanalOperacion, accionesCanal, resumenOperativo, type ControlCanal, type EstadoPrueba } from '../../data/ops/canalOperacion'
import { ClienteAtencion } from '../../data/ops/atencion'
import { ClienteChat } from '../../data/ops/chat'
import mig from '../../../../../supabase/migrations/20270123120000_canal_prueba_contacto.sql?raw'

afterEach(cleanup)
const VENCE = '2026-10-27T03:30:00Z'
const prueba = (vigentes: number): EstadoPrueba => ({ modo_whatsapp: 'prueba', vigentes, operativa: vigentes > 0, permisos: vigentes ? [{ id: 1, contacto: '…3464', vence_at: VENCE, autorizado_por: 'Dirección' }] : [] })
function servidor(o: { modo?: 'espejo' | 'activo' | 'prueba'; ia?: boolean; pausa?: boolean; vigentes?: number } = {}) {
  const st = { modo: o.modo ?? 'prueba', ia: o.ia ?? false, pausa: o.pausa ?? false, vigentes: o.vigentes ?? 1 }
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    llamadas.push({ fn, args })
    if (fn === 'cc_canal_estado') return { data: { activacion_disponible: false, canales: [{ canal: 'whatsapp', modo: st.modo, ia_habilitada: st.ia, envio_pausado: st.pausa, updated_at: null }, { canal: 'instagram', modo: 'espejo', ia_habilitada: false, envio_pausado: false, updated_at: null }, { canal: 'messenger', modo: 'espejo', ia_habilitada: false, envio_pausado: false, updated_at: null }], historial: [], prueba: { ...prueba(st.modo === 'prueba' ? st.vigentes : 0), modo_whatsapp: st.modo, operativa: st.modo === 'prueba' && st.vigentes > 0 } }, error: null }
    if (fn === 'cc_canal_cambiar') {
      const c = args!.p_cambios as Record<string, unknown>
      if (c.modo === 'espejo') { st.modo = 'espejo'; st.ia = false; st.vigentes = 0 }
      if (typeof c.ia_habilitada === 'boolean') st.ia = c.ia_habilitada
      if (typeof c.envio_pausado === 'boolean') st.pausa = c.envio_pausado
      return { data: { cambiado: true }, error: null }
    }
    if (fn === 'cc_salida_revision') return { data: { canal: 'whatsapp', envio_habilitado: st.modo !== 'espejo' && !st.pausa, conteos: {}, por_decidir: [] }, error: null }
    if (fn === 'cc_canal_panel') return { data: { canal: 'whatsapp', atencion_humana: [], descartados: [] }, error: null }
    if (fn === 'cc_ruteo_pendientes') return { data: { resumen: { horario: { configurado: true, abierto: true, zona: 'America/Mazatlan', motivo: '' }, sin_vendedor: 0, reasignacion: 0, handoffs_sin_asignar: 0, handoffs_pendientes: 0, vendedores_elegibles: 1 }, conversaciones: [], carritos_pendientes: [] }, error: null }
    if (fn === 'cc_vendedores') return { data: [], error: null }
    if (fn === 'cc_canales_bandeja') return { data: { modos: { whatsapp: st.modo, instagram: 'espejo', messenger: 'espejo' }, chats: [] }, error: null }
    return { data: null, error: { message: 'FUNCION_DESCONOCIDA ' + fn } }
  }
  return { rpc, llamadas, st }
}
const abrir = async () => { fireEvent.click(await screen.findByTestId('panel-canal-detalle')) }

describe('lógica pura del modo prueba', () => {
  const c: ControlCanal = { canal: 'whatsapp', modo: 'prueba', ia_habilitada: false, envio_pausado: false, updated_at: null }
  it('prueba operativa: volver a espejo visible; encender IA habilitado (lo autoriza el servidor); activar oculto', () => {
    const a = accionesCanal(c, false, prueba(1))
    expect(a.espejo).toMatchObject({ visible: true, habilitada: true })
    expect(a.encenderIA).toMatchObject({ visible: true, habilitada: true, porque: null })
    expect(a.activar.visible).toBe(false)
    expect(a.pausar.visible && a.pausar.habilitada).toBe(true)
  })
  it('prueba sin permisos vigentes: encender IA deshabilitado con su motivo', () => {
    expect(accionesCanal(c, false, prueba(0)).encenderIA).toMatchObject({ habilitada: false, porque: 'La prueba no tiene contactos autorizados vigentes.' })
  })
  it('activo sigue tras la compuerta; espejo no cambia', () => {
    expect(accionesCanal({ ...c, modo: 'activo' }, false).encenderIA.habilitada).toBe(false)
    expect(accionesCanal({ ...c, modo: 'espejo' }, false).espejo.visible).toBe(false)
  })
  it('resumen: nunca dice "espejo" en prueba', () => {
    const r1 = resumenOperativo(c, false, null, null, prueba(1)).map((l) => l.texto).join(' | ')
    expect(r1).toMatch(/PRUEBA: solo 1 contacto\(s\) autorizado\(s\)/); expect(r1).toMatch(/Envíos solo a los contactos autorizados/); expect(r1).not.toMatch(/Modo espejo/)
    const r0 = resumenOperativo(c, false, null, null, prueba(0)).map((l) => l.texto).join(' | ')
    expect(r0).toMatch(/inoperante/); expect(r0).toMatch(/ningún contacto vigente/)
  })
})

describe('<PanelOperativoCanal> en modo prueba', () => {
  it('operativa: "Prueba · 1 contacto autorizado", número enmascarado y vencimiento; nunca "Espejo"', async () => {
    const s = servidor({ vigentes: 1 })
    render(<PanelOperativoCanal cliente={new ClienteCanalOperacion(s.rpc, vi.fn())} />); await abrir()
    expect(screen.getByTestId('dato-modo').textContent).toBe('Prueba · 1 contacto autorizado')
    expect(screen.getByTestId('dato-prueba').textContent).toMatch(/^…3464 · vence /)
    expect(screen.getByTestId('res-ia').textContent).toMatch(/^PRUEBA: solo 1/)
    expect(screen.getByTestId('panel-canal').textContent).not.toMatch(/Modo espejo|Sin envíos \(espejo\)/)
    expect((screen.getByTestId('ctl-encender-ia') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId('ctl-pausar')).toBeTruthy()
    expect(screen.queryByTestId('ctl-activar')).toBeNull()
  })
  it('sin permisos vigentes: "inoperante" y encender IA deshabilitado', async () => {
    const s = servidor({ vigentes: 0 })
    render(<PanelOperativoCanal cliente={new ClienteCanalOperacion(s.rpc, vi.fn())} />); await abrir()
    expect(screen.getByTestId('dato-modo').textContent).toBe('Prueba · sin contactos vigentes (inoperante)')
    expect(screen.getByTestId('dato-prueba').textContent).toBe('Ninguno vigente')
    expect(screen.getByTestId('res-ia').textContent).toMatch(/inoperante/)
    expect((screen.getByTestId('ctl-encender-ia') as HTMLButtonElement).disabled).toBe(true)
  })
  it('"Volver a espejo" desde prueba: confirma (avisa la revocación), manda modo espejo y queda en espejo', async () => {
    const s = servidor({ vigentes: 1, ia: true })
    render(<PanelOperativoCanal cliente={new ClienteCanalOperacion(s.rpc, vi.fn())} />); await abrir()
    fireEvent.click(screen.getByTestId('ctl-espejo'))
    const m = await screen.findByTestId('confirmar-espejo')
    expect(m.textContent).toMatch(/quedan revocados/)
    fireEvent.change(within(m).getByTestId('confirmar-espejo-motivo'), { target: { value: 'Cierre de la prueba' } })
    fireEvent.click(within(m).getByTestId('confirmar-espejo-confirmar'))
    await waitFor(() => expect(screen.getByTestId('dato-modo').textContent).toBe('Espejo'))
    expect(s.llamadas.find((l) => l.fn === 'cc_canal_cambiar')!.args).toEqual({ p_canal: 'whatsapp', p_cambios: { modo: 'espejo' }, p_motivo: 'Cierre de la prueba' })
    expect(s.st).toMatchObject({ modo: 'espejo', ia: false })
  })
  it('Pausar, Reanudar y Apagar IA se conservan en prueba', async () => {
    const s = servidor({ vigentes: 1, ia: true })
    render(<PanelOperativoCanal cliente={new ClienteCanalOperacion(s.rpc, vi.fn())} />); await abrir()
    expect(screen.getByTestId('ctl-apagar-ia')).toBeTruthy()
    fireEvent.click(screen.getByTestId('ctl-pausar'))
    const m = await screen.findByTestId('confirmar-pausar')
    fireEvent.change(within(m).getByTestId('confirmar-pausar-motivo'), { target: { value: 'Pausa en prueba' } })
    fireEvent.click(within(m).getByTestId('confirmar-pausar-confirmar'))
    await waitFor(() => expect(screen.getByTestId('ctl-reanudar')).toBeTruthy())
  })
})

describe('bandeja de Canales', () => {
  it('la píldora de WhatsApp dice "prueba" y el texto explica que solo responden los autorizados', async () => {
    const s = servidor({ vigentes: 1 })
    const chat = new ClienteChat(async () => ({ data: { ok: true }, error: null }), () => null)
    render(<AtencionComercial pestanas={['whatsapp']} cliente={new ClienteAtencion(s.rpc, vi.fn())} chat={chat} canalOp={new ClienteCanalOperacion(s.rpc, vi.fn())} />)
    expect((await screen.findByTestId('canal-modo-whatsapp')).textContent).toBe('WhatsApp: prueba')
    expect(screen.getByTestId('wa-bandeja').textContent).toMatch(/modo prueba: solo los contactos autorizados/)
  })
})

describe('contrato de la base', () => {
  it('la migración no activa nada y mantiene la compuerta y el último chequeo por contacto', () => {
    expect(mig).toMatch(/if \(select modo from public\.cc_wa_config where id\) <> 'espejo' or \(select ia_habilitada from public\.cc_wa_config where id\) then raise exception 'R4-C5: instalar no debe cambiar el estado operativo'/)
    expect(mig).toMatch(/ACTIVACION_BLOQUEADA: la compuerta de activación sigue cerrada/)
    expect(mig).toMatch(/return public\._cc_wa_modo_efectivo\(v_wa, true\) = 'activo';/)
    expect(mig).toMatch(/check \(canal = 'whatsapp'\)/)
  })
})
