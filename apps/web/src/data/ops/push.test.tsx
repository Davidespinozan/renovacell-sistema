// @vitest-environment jsdom
// AVISOS PUSH · a quién se avisa (solo mensajes humanos, al otro lado), qué dice el aviso, apagado de direcciones
// muertas, el botón y el service worker (solo avisos; sin caché ni intercepción).
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { configPush, destinosDe, armarAviso, enviarAvisos } from '../../../../../supabase/functions/_shared/push'
import { BotonAvisos } from '../../app/BotonAvisos'
import chatEdge from '../../../../../supabase/functions/chat/index.ts?raw'
import sw from '../../../public/sw.js?raw'
import mig from '../../../../../supabase/migrations/20261213120000_avisos_push.sql?raw'

afterEach(cleanup)
const c = { profile_id: null as string | null, visitor_id: 'V1' as string | null, seller_profile_id: 'S1' as string | null }

describe('Avisos push · servidor', () => {
  it('sin llaves completas no se manda nada', () => {
    expect(configPush(() => undefined)).toBeNull()
    expect(configPush((k) => ({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q', VAPID_SUBJECT: 'nadie' } as Record<string, string>)[k])).toBeNull()
    expect(configPush((k) => ({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q', VAPID_SUBJECT: 'mailto:hola@renovacell.mx' } as Record<string, string>)[k])).toEqual({ publica: 'p', privada: 'q', sujeto: 'mailto:hola@renovacell.mx' })
  })
  it('a quién: el cliente escribe → su asesor; el asesor escribe → el cliente (cuenta o visitante); el asistente no avisa', () => {
    expect(destinosDe('visitor', c)).toEqual({ perfiles: ['S1'], visitantes: [], para: 'personal' })
    expect(destinosDe('doctor', { ...c, seller_profile_id: null })).toBeNull()                  // sin asesor: Dirección ya tiene sus avisos internos
    expect(destinosDe('seller', c)).toEqual({ perfiles: [], visitantes: ['V1'], para: 'cliente' })
    expect(destinosDe('seller', { ...c, profile_id: 'D1' })).toEqual({ perfiles: ['D1'], visitantes: [], para: 'cliente' })
    expect(destinosDe('ai', c)).toBeNull(); expect(destinosDe('system', c)).toBeNull()
  })
  it('el aviso: quién escribió, el inicio del texto y adónde lleva al tocarlo', () => {
    const a = armarAviso({ para: 'cliente', remitente: 'Lucía', texto: 'x'.repeat(200), conv: 'C1', visitante: true })
    expect(a.title).toBe('Renovacell'); expect(a.body.startsWith('Lucía: xxx')).toBe(true); expect(a.body.length).toBeLessThanOrEqual(120)
    expect(a.url).toBe('https://renovacell.mx/contacto'); expect(a.tag).toBe('rc-chat-C1')
    expect(armarAviso({ para: 'personal', remitente: 'Magaly', texto: 'Hola', conv: 'C1', visitante: false })).toMatchObject({ title: 'Mensaje de un cliente', body: 'Magaly: Hola', url: 'https://sistema.renovacell.mx/sistema' })
  })
  it('manda a cada dispositivo; una dirección que ya no existe (410) se apaga; nunca lanza', async () => {
    const rpc = vi.fn().mockResolvedValue({}); const admin = { rpc }
    const enviar = vi.fn(async (s: { endpoint: string }) => { if (s.endpoint.endsWith('muerta')) throw Object.assign(new Error('gone'), { statusCode: 410 }); return { statusCode: 201 } })
    const ok = await enviarAvisos(admin, enviar, [{ id: 'a', endpoint: 'https://p/viva', p256dh: 'k', auth: 's' }, { id: 'b', endpoint: 'https://p/muerta', p256dh: 'k', auth: 's' }], armarAviso({ para: 'cliente', remitente: 'L', texto: 'h', conv: 'C', visitante: true }))
    expect(ok).toBe(1)
    expect(rpc).toHaveBeenCalledWith('push_resultado', { p_id: 'a', p_ok: true, p_baja: false })
    expect(rpc).toHaveBeenCalledWith('push_resultado', { p_id: 'b', p_ok: false, p_baja: true })
  })
  it('el chat avisa en segundo plano tras mensajes e imágenes, sin bloquear el envío', () => {
    expect(chatEdge).toMatch(/if \(!r\.idempotente\) enSegundoPlano\(avisarPush\(admin, conv, actor\.actor, c\.texto\)\)/)
    expect(chatEdge).toMatch(/enSegundoPlano\(avisarPush\(admin, conv, actor\.actor, TEXTO_IMAGEN\)\)/)
    expect(mig).not.toMatch(/create policy/i); expect(mig).toMatch(/revoke all on table public\.push_suscripciones from public, anon, authenticated/)
  })
  it('el service worker solo muestra avisos y abre la conversación; no guarda caché ni intercepta páginas', () => {
    expect(sw).toMatch(/addEventListener\('push'/); expect(sw).toMatch(/addEventListener\('notificationclick'/)
    expect(sw).not.toMatch(/addEventListener\('fetch'|caches\./)
  })
})

describe('Botón "Activar avisos"', () => {
  it('se muestra si están inactivos; al activarlos desaparece', async () => {
    const activar = vi.fn().mockResolvedValue({ ok: true })
    render(<BotonAvisos estado={async () => 'inactivo'} activar={activar} />)
    fireEvent.click(await screen.findByTestId('activar-avisos'))
    await waitFor(() => expect(screen.queryByTestId('activar-avisos')).toBeNull()); expect(activar).toHaveBeenCalled()
  })
  it('en iPhone sin instalar explica cómo; si fallan, dice por qué', async () => {
    render(<BotonAvisos estado={async () => 'requiere_instalar'} activar={async () => ({ ok: false, mensaje: 'En iPhone, primero agrega Renovacell a tu pantalla de inicio' })} />)
    fireEvent.click(await screen.findByTestId('activar-avisos'))
    expect((await screen.findByTestId('avisos-msg')).textContent).toMatch(/pantalla de inicio/)
  })
  it('ya activos o sin soporte: no estorba', async () => {
    render(<div data-testid="z"><BotonAvisos estado={async () => 'activo'} /><BotonAvisos estado={async () => 'no_soportado'} /></div>)
    await new Promise((r) => setTimeout(r, 0)); expect(screen.queryByTestId('activar-avisos')).toBeNull()
  })
})
