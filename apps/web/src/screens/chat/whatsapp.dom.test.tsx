// @vitest-environment jsdom
// WA-2 · el personal ve que el cliente escribe por WhatsApp y si su mensaje le llegará (ventana de 24 h, modo espejo).
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'
import { cuerpoTexto, leerRespuestaEnvio, extraerEstados, configWA } from '../../../../../supabase/functions/_shared/whatsapp'
import mig from '../../../../../supabase/migrations/20261221120000_whatsapp_salida.sql?raw'

afterEach(cleanup)
const conv = (whatsapp: Conversacion['whatsapp']): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'human_active', rol: 'asesor', ultimo_seq: 0, mensajes: [], whatsapp })
const cliente = (c: Conversacion) => new ClienteChat(async (_f, { body }) => ({ data: body.action === 'leer' ? c : { ok: true }, error: null }), () => null)
const montar = (c: Conversacion) => render(<ChatCanonico cliente={cliente(c)} asesor conversationId="C1" respuestas={null} conCarrito={false} intervaloMs={600_000} suscribir={null} />)

describe('WhatsApp en Conversaciones', () => {
  it('modo espejo: avisa que aún se contesta en Leadsales', async () => {
    montar(conv({ wa_id: '5216671112233', modo: 'espejo', ventana_abierta: true, ventana_hasta: null, fallidos: 0 }))
    expect((await screen.findByTestId('wa-espejo')).textContent).toMatch(/Leadsales/)
    expect(screen.getByTestId('chat-modo').textContent).toMatch(/^WhatsApp · /)
    // 169 · en espejo nadie escribe desde el sistema: lo que se escribiera no saldría por WhatsApp
    expect((screen.getByTestId('btn-enviar') as HTMLButtonElement).disabled).toBe(true)
  })
  it('Instagram (canal): el aviso nombra el canal; espejo apaga el redactor', async () => {
    montar({ ...conv(null), canal: { canal: 'instagram', id: '17841400000000001', modo: 'espejo', ventana_abierta: true, ventana_hasta: null, fallidos: 0 } })
    expect((await screen.findByTestId('wa-espejo')).textContent).toMatch(/^Instagram en modo espejo/)
    expect(screen.getByTestId('chat-modo').textContent).toMatch(/^Instagram · /)
    expect((screen.getByTestId('btn-enviar') as HTMLButtonElement).disabled).toBe(true)
    cleanup(); montar({ ...conv(null), canal: { canal: 'messenger', id: '1234567', modo: 'activo', ventana_abierta: false, ventana_hasta: null, fallidos: 1 } })
    expect((await screen.findByTestId('wa-ventana')).textContent).toMatch(/por Facebook hace más de 24 horas/)
  })
  it('activo y ventana de 24 h cerrada: avisa que no le llegará; abierta: sin aviso', async () => {
    montar(conv({ wa_id: '5216671112233', modo: 'activo', ventana_abierta: false, ventana_hasta: null, fallidos: 1 }))
    expect((await screen.findByTestId('wa-ventana')).textContent).toMatch(/más de 24 horas/)
    cleanup(); montar(conv({ wa_id: '5216671112233', modo: 'activo', ventana_abierta: true, ventana_hasta: null, fallidos: 0 }))
    await screen.findByTestId('chat-modo'); expect(screen.queryByTestId('wa-ventana')).toBeNull(); expect(screen.queryByTestId('wa-espejo')).toBeNull()
    expect(screen.getByTestId('btn-enviar').hasAttribute('disabled') && (screen.getByTestId('btn-enviar') as HTMLButtonElement).disabled && document.querySelector('.rc-composer textarea, .rc-composer input')?.hasAttribute('disabled')).toBeFalsy()
  })
  it('servidor: mensaje de texto de la Cloud API, wamid de la respuesta, acuses y llaves', () => {
    expect(cuerpoTexto('5216671112233', 'Hola')).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '5216671112233', type: 'text', text: { preview_url: true, body: 'Hola' } })
    expect(leerRespuestaEnvio(200, { messages: [{ id: 'wamid.X1' }] })).toEqual({ ok: true, wamid: 'wamid.X1' })
    expect(leerRespuestaEnvio(400, { error: { code: 131047, message: 'Re-engagement message' } })).toEqual({ ok: false, error: 'Meta 400 (131047): Re-engagement message' })
    expect(extraerEstados({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.OUT1', status: 'read' }, { id: 'wamid.OUT2', status: 'failed', errors: [{ title: 'Undeliverable' }] }] } }] }] }))
      .toEqual([{ wamid: 'wamid.OUT1', estado: 'read', error: null }, { wamid: 'wamid.OUT2', estado: 'failed', error: 'Undeliverable' }])
    expect(configWA(() => undefined)).toBeNull(); expect(configWA((k) => ({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123456789' } as Record<string, string>)[k])?.phoneId).toBe('123456789')
  })
  it('base: nace en espejo, solo el personal y la IA salen por WhatsApp y nunca tumba el mensaje del chat', () => {
    expect(mig).toMatch(/insert into public\.cc_wa_config \(id, modo\) values \(true, 'espejo'\)/)
    expect(mig).toMatch(/if new\.actor_type not in \('seller', 'admin', 'ai'\) then return new; end if;/)
    expect(mig).toMatch(/raise warning 'WA_ENCOLAR_FALLO/)
  })
})
