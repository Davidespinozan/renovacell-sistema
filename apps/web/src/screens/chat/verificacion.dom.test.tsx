// @vitest-environment jsdom
// VERIF-VENDEDOR · panel de verificación en Conversaciones y la regla de la evidencia (solo rutas de ESE doctor).
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { PanelVerificacion } from './PanelVerificacion'
import { rutasDeEvidencia } from '../../../../../supabase/functions/_shared/verificacion'
import mig from '../../../../../supabase/migrations/20261207120000_verificacion_vendedor.sql?raw'
import edge from '../../../../../supabase/functions/verificacion/index.ts?raw'
import type { DoctorPendiente } from '../../data/ops/verificacion'

afterEach(cleanup)
const P = '11111111-1111-4111-8111-111111111111'
const doc: DoctorPendiente = { profile_id: P, nombre: 'Dra. Pendiente', email: 'p@x.mx', telefono: '6691234567', organizacion: 'Clínica X', cedula: '1234567', verificado: false, estado: 'pending', sep: { decision: 'review' }, identidad: 'pending', evidencia: { 'ine-front': `identity/${P}/ine-front.jpg` } }

describe('Panel de verificación (vendedor o Dirección)', () => {
  it('muestra cédula, SEP y las fotos; aprobar llama al comando y explica el resultado', async () => {
    const verificar = vi.fn().mockResolvedValue({ ok: true })
    render(<PanelVerificacion conversationId="C1" leer={async () => doc} evidencia={async () => ({ 'ine-front': 'https://firmada/1' })} verificar={verificar} />)
    await screen.findByTestId('panel-verificacion')
    expect(screen.getByText('Cédula 1234567')).toBeTruthy(); expect(screen.getByText('SEP: por revisar')).toBeTruthy()
    await waitFor(() => expect((screen.getByTestId('evidencia-ine-front') as HTMLAnchorElement).href).toBe('https://firmada/1'))
    fireEvent.click(screen.getByTestId('btn-aprobar-verificacion'))
    await screen.findByTestId('verificacion-hecha')
    expect(verificar).toHaveBeenCalledWith(P, true, null)
    expect(screen.getByTestId('verificacion-hecha').textContent).toMatch(/ya ve precios/)
  })
  it('rechazar exige motivo', async () => {
    const verificar = vi.fn().mockResolvedValue({ ok: true })
    render(<PanelVerificacion conversationId="C1" leer={async () => doc} evidencia={async () => ({})} verificar={verificar} />)
    await screen.findByTestId('panel-verificacion')
    fireEvent.click(screen.getByTestId('btn-rechazar-verificacion'))
    expect((screen.getByTestId('btn-confirmar-rechazo') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), { target: { value: 'Cédula no coincide' } })
    fireEvent.click(screen.getByTestId('btn-confirmar-rechazo'))
    await waitFor(() => expect(verificar).toHaveBeenCalledWith(P, false, 'Cédula no coincide'))
  })
  it('si quien mira no puede verificar (o ya está verificado), no aparece nada', async () => {
    render(<PanelVerificacion conversationId="C1" leer={async () => null} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('panel-verificacion')).toBeNull()
  })
})

describe('Evidencia: solo lo de ESE doctor, sin abrir el almacenamiento', () => {
  it('filtra rutas ajenas, con ".." o claves raras', () => {
    expect(rutasDeEvidencia({ 'ine-front': `identity/${P}/ine-front.jpg`, 'ine-back': `identity/otro/ine-back.jpg`, selfie: `identity/${P}/../x.jpg`, 'Clave Rara': `identity/${P}/a.jpg`, n: 5 }, P))
      .toEqual([['ine-front', `identity/${P}/ine-front.jpg`]])
    expect(rutasDeEvidencia(null, P)).toEqual([]); expect(rutasDeEvidencia(['x'], P)).toEqual([])
  })
  it('la función autoriza con la sesión del que pide ANTES de firmar; la migración no toca las políticas de storage', () => {
    expect(edge.indexOf("caller.rpc('doctor_verificacion_ver'")).toBeLessThan(edge.indexOf('createSignedUrl'))
    expect(mig).not.toMatch(/create policy|storage\.objects/i)
    expect(mig).toMatch(/perform set_config\('app\.trusted', 'on', true\);\s*\n\s*update public\.profiles set verified = true/)
  })
})
