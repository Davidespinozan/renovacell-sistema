// @vitest-environment jsdom
// R4-C10 · Pantalla «Manual de ventas»: temas de la base, alta de borrador, aprobación (bloqueada con "[COMPLETAR"),
// nueva versión desde lo aprobado y retiro con motivo. Servidor FALSO.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { ManualVentas } from './ManualVentas'
import { ClienteConocimiento, TEMAS_EMPRESA } from '../../data/ops/conocimiento'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: {} }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const fila = (o: Partial<Record<string, unknown>>) => ({ id: 'v1', tema: 'pagos', titulo: 'Transferencia', version: 1, rev: 1, estado: 'draft', audiencia: 'public', contenido: 'Aceptamos transferencia.', source_id: null, importado_de: null, created_at: '', approved_at: null, ...o })
function servidor(filas: unknown[]) {
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    llamadas.push({ fn, args })
    if (fn === 'cc_empresa_listar') return { data: filas, error: null }
    if (fn === 'cc_empresa_guardar') return { data: { id: 'n1', version: 1, rev: 1, estado: 'draft', claims: [] }, error: null }
    if (fn === 'cc_empresa_aprobar') return { data: { id: args!.p_id, estado: 'approved', retirada: null }, error: null }
    if (fn === 'cc_empresa_retirar') return { data: { id: args!.p_id, estado: 'retired' }, error: null }
    return { data: null, error: { message: 'desconocida' } }
  }
  return { cliente: new ClienteConocimiento(rpc), llamadas }
}

describe('<ManualVentas>', () => {
  it('muestra los 11 temas que acepta la base', async () => {
    const s = servidor([]); render(<ManualVentas cliente={s.cliente} />)
    await screen.findByTestId('tema-pagos')
    for (const t of TEMAS_EMPRESA) expect(screen.getByTestId(`tema-${t.key}`)).toBeTruthy()
    expect(TEMAS_EMPRESA.map((t) => t.key).sort()).toEqual(['atencion', 'certificaciones', 'como_comprar', 'devoluciones', 'empresa', 'envios', 'facturacion', 'pagos', 'politica_comercial', 'tecnologia', 'verificacion'])
  })
  it('agregar: guarda un borrador con tema, título, contenido y audiencia', async () => {
    const s = servidor([]); render(<ManualVentas cliente={s.cliente} />)
    fireEvent.click(await screen.findByTestId('nuevo-facturacion'))
    const ed = screen.getByTestId('editor')
    fireEvent.change(within(ed).getByTestId('editor-titulo'), { target: { value: 'Cómo pedir factura' } })
    fireEvent.change(within(ed).getByTestId('editor-contenido'), { target: { value: 'Pídela a tu asesor con tu constancia fiscal.' } })
    fireEvent.change(within(ed).getByTestId('editor-audiencia'), { target: { value: 'verified' } })
    fireEvent.click(within(ed).getByTestId('btn-guardar'))
    await waitFor(() => expect(s.llamadas.some((l) => l.fn === 'cc_empresa_guardar')).toBe(true))
    expect(s.llamadas.find((l) => l.fn === 'cc_empresa_guardar')!.args).toEqual({ p_tema: 'facturacion', p_titulo: 'Cómo pedir factura', p_contenido: 'Pídela a tu asesor con tu constancia fiscal.', p_source: null, p_audiencia: 'verified', p_id: null, p_rev: null })
  })
  it('un borrador con [COMPLETAR …] no se puede aprobar', async () => {
    const s = servidor([fila({ contenido: 'Aceptamos [COMPLETAR: formas de pago].' })]); render(<ManualVentas cliente={s.cliente} />)
    expect(await screen.findByTestId('marca-pendiente')).toBeTruthy()
    expect((screen.getByTestId('btn-aprobar') as HTMLButtonElement).disabled).toBe(true)
  })
  it('aprobar un borrador completo llama a la base tras confirmar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const s = servidor([fila({})]); render(<ManualVentas cliente={s.cliente} />)
    fireEvent.click(await screen.findByTestId('btn-aprobar'))
    await waitFor(() => expect(s.llamadas.some((l) => l.fn === 'cc_empresa_aprobar' && l.args!.p_id === 'v1')).toBe(true))
  })
  it('lo aprobado: nueva versión (borrador con el mismo título) y retiro con motivo', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Cambió la política')
    const s = servidor([fila({ estado: 'approved', approved_at: 'x' })]); render(<ManualVentas cliente={s.cliente} />)
    fireEvent.click(await screen.findByTestId('btn-nueva-version'))
    expect((within(screen.getByTestId('editor')).getByTestId('editor-titulo') as HTMLInputElement).value).toBe('Transferencia')
    fireEvent.click(screen.getByText('Retirar'))
    await waitFor(() => expect(s.llamadas.find((l) => l.fn === 'cc_empresa_retirar')?.args).toEqual({ p_id: 'v1', p_motivo: 'Cambió la política' }))
  })
})
