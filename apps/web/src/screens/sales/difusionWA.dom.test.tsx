// @vitest-environment jsdom
// DIFUSIONES POR WHATSAPP (15 nov 2026)
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Difusiones } from './Difusiones'
import type { ClienteDifusiones } from '../../data/ops/difusiones'
import { olvidarEspecialidades } from '../../app/PerfilComercialEditor'
import { CUERPO_DIFUSION_WA, cuerpoDifusionWA, mensajeDifusionWA, vistaPreviaWA } from '../../../../../supabase/functions/_shared/difusionWA'
import sql from '../../../../../supabase/migrations/20270407200000_difusion_whatsapp.sql?raw'

vi.mock('../../data/ops/perfilComercial', async (orig) => ({ ...(await orig<typeof import('../../data/ops/perfilComercial')>()), perfilComercial: { especialidades: async () => [] } }))
afterEach(() => { cleanup(); olvidarEspecialidades() })

const base = { total: 603, con_correo: 347, dados_de_baja: 0, sin_correo: 256, con_cuenta: 3, con_whatsapp: 499, sin_whatsapp: 74, whatsapp_baja: 2, whatsapp_limite: 250 }
function falso(lista: boolean) {
  return {
    listas: vi.fn(async () => ({ ok: true as const, data: [] })),
    previa: vi.fn(async () => ({ ok: true as const, data: { ...base, whatsapp_lista: lista } })),
    enviar: vi.fn(async () => ({ ok: true as const, data: { id: 'D1', destinatarios: 603, correo: 0, chat: 0, sin_correo: 0, dados_de_baja: 0, whatsapp: 499, sin_whatsapp: 74 } })),
    prueba: vi.fn(), enviadas: vi.fn(async () => ({ ok: true as const, data: [] })), buscarClientes: vi.fn(async () => ({ ok: true as const, data: [] })),
  }
}

describe('Difusiones por WhatsApp', () => {
  it('sin plantilla aprobada: WhatsApp aparece apagado y explica qué falta', async () => {
    render(<Difusiones cliente={falso(false) as unknown as ClienteDifusiones} />)
    expect(await screen.findByTestId('dif-wa-pendiente')).toHaveTextContent('cuando Meta apruebe la plantilla')
    expect(screen.getByTestId('dif-canal-whatsapp')).toBeDisabled()
    expect(screen.getByTestId('dif-previa')).not.toHaveTextContent('por WhatsApp')
  })
  it('con plantilla: cuenta celulares, muestra cómo llega y manda por WhatsApp', async () => {
    const c = falso(true); vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<Difusiones cliente={c as unknown as ClienteDifusiones} />)
    expect(await screen.findByTestId('dif-previa')).toHaveTextContent('603 clientes · 499 por WhatsApp · 347 por correo')
    fireEvent.click(screen.getByTestId('dif-canal-correo')); fireEvent.click(screen.getByTestId('dif-canal-chat'))
    fireEvent.change(screen.getByTestId('dif-titulo'), { target: { value: 'Golden Placenta' } })
    fireEvent.change(screen.getByTestId('dif-texto'), { target: { value: 'Ya llegó.\n\nPídala.' } })
    const previa = screen.getByTestId('dif-wa-previa')
    expect(previa).toHaveTextContent('le comparte')
    expect(previa).toHaveTextContent('*Golden Placenta* — Ya llegó. Pídala.')
    expect(previa).toHaveTextContent('2 pidieron no recibir promociones')
    expect(screen.getByTestId('dif-enviar')).toHaveTextContent('Mandar (499)')
    fireEvent.click(screen.getByTestId('dif-enviar'))
    await waitFor(() => expect(c.enviar).toHaveBeenCalledWith({ titulo: 'Golden Placenta', texto: 'Ya llegó.\n\nPídala.', enlace: '', imagen: '' }, { tipo: 'cartera' }, ['whatsapp']))
  })
})

describe('regla del mensaje de WhatsApp', () => {
  it('un solo renglón, sin espacios de más, con enlace e imagen', () => {
    expect(mensajeDifusionWA({ titulo: ' Nuevo ', texto: 'Uno\n\n  dos\tTres', enlace: 'https://x.mx', imagen: 'https://i/x.jpg' })).toBe('*Nuevo* — Uno dos Tres https://x.mx Imagen: https://i/x.jpg')
    expect(mensajeDifusionWA({ titulo: 'T', texto: 'x'.repeat(2000) })).toHaveLength(800)
    expect(vistaPreviaWA('Ana', 'Roberto', 'Hola')).toBe('Hola Ana, le comparte Roberto de Renovacell: Hola Si le interesa, responda a este mensaje y con gusto le atendemos.')
  })
  it('cuerpo para Meta: plantilla con 3 datos limpios al 52 + 10 dígitos', () => {
    const b = cuerpoDifusionWA('6671234567', 'difusion_vendedor', 'es_MX', ['Ana', 'Roberto', 'a\nb'])
    expect(b.to).toBe('526671234567')
    expect(JSON.stringify(b)).toContain('"text":"a b"')
  })
  it('la base: misma plantilla, misma regla, cola con horario/baja/pausa y respuesta a la cartera', () => {
    expect(sql).toContain(CUERPO_DIFUSION_WA.replace(/'/g, "''"))
    expect(sql).toMatch(/'\\s\+', ' ', 'g'\), 800\)/)
    expect(sql).toMatch(/cc_wa_bajas_promo b where right\(b\.wa_id, 10\) = e\.destino/)
    expect(sql).toMatch(/pausada_hasta = now\(\) \+ interval '30 minutes'/)
    expect(sql).toMatch(/update public\.cc_conversations set customer_id = e\.customer_id/)
    expect(sql).toMatch(/grant execute on function public\._difwa_reclamar\(integer\), public\._difwa_resolver\(bigint, text, text, text\) to service_role/)
  })
})
