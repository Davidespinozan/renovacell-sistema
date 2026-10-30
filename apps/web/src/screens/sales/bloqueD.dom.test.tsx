// @vitest-environment jsdom
// HERRAMIENTAS DEL VENDEDOR · bloque D: listas y difusiones (correo con baja + tarjeta en el chat del portal) y la página
// pública de baja.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Difusiones } from './Difusiones'
import { TarjetaDifusion } from '../chat/TarjetaDifusion'
import { BajaCorreo } from '../BajaCorreo'
import { leerDifusion, type ClienteDifusiones } from '../../data/ops/difusiones'
import { renderizar } from '../../../../../supabase/functions/_shared/plantillas'
import { olvidarEspecialidades } from '../../app/PerfilComercialEditor'

vi.mock('../../data/ops/perfilComercial', async (orig) => ({ ...(await orig<typeof import('../../data/ops/perfilComercial')>()), perfilComercial: { especialidades: async () => [{ clave: 'dermatologia', nombre: 'Dermatología', orden: 1, activa: true }] } }))
afterEach(() => { cleanup(); olvidarEspecialidades() })
const ID = '11111111-2222-4333-8444-555555555555'

describe('correo y tarjeta de la difusión', () => {
  it('el correo trae imagen, botón al enlace y "dejar de recibir"; la prueba no trae baja', () => {
    const r = renderizar('difusion', { titulo: 'Nuevo Dysport', texto: 'Ya llegó.\nPídelo.', enlace: 'https://youtu.be/x', imagen_url: 'https://cdn/x.jpg', vendedor: 'roberto ibarra', baja_url: 'https://renovacell.mx/baja?t=abc' }, 'ANA PEREZ')
    expect(r.asunto).toBe('Nuevo Dysport')
    expect(r.html).toContain('src="https://cdn/x.jpg"'); expect(r.html).toContain('Ver el video'); expect(r.html).toContain('Dejar de recibirlos'); expect(r.html).toContain('Te escribe Roberto Ibarra')
    expect(r.texto).toMatch(/Dejar de recibir estos mensajes: https:\/\/renovacell\.mx\/baja\?t=abc$/)
    const p = renderizar('difusion', { titulo: 'X', texto: 'y', prueba: true }, null)
    expect(p.asunto).toBe('[Prueba] X'); expect(p.html).not.toContain('Dejar de recibirlos')
  })
  it('en el chat del portal se ve como tarjeta: texto con enlaces, imagen y botón', () => {
    const content = `[difusion:${ID}]\nNuevo Dysport\nYa llegó, más info en https://renovacell.mx\n[enlace] https://youtu.be/x\n[imagen] https://cdn/x.jpg`
    expect(leerDifusion(content)).toEqual({ titulo: 'Nuevo Dysport', texto: 'Ya llegó, más info en https://renovacell.mx', enlace: 'https://youtu.be/x', imagen: 'https://cdn/x.jpg' })
    render(<TarjetaDifusion content={content} />)
    const t = screen.getByTestId('tarjeta-difusion')
    expect(t.querySelector('img')!.getAttribute('src')).toBe('https://cdn/x.jpg')
    expect(t.querySelector('a.rc-enlace')!.getAttribute('href')).toBe('https://renovacell.mx')
    expect(screen.getByText('Ver el video').closest('a')!.getAttribute('href')).toBe('https://youtu.be/x')
  })
})

describe('Difusiones', () => {
  function falso() {
    return {
      listas: vi.fn(async () => ({ ok: true as const, data: [{ id: 'L1', nombre: 'Dermatólogos VIP', es_mia: true, vendedor: null, clientes: 12 }] })),
      previa: vi.fn(async () => ({ ok: true as const, data: { total: 12, con_correo: 10, dados_de_baja: 1, sin_correo: 1, con_cuenta: 3 } })),
      enviar: vi.fn(async () => ({ ok: true as const, data: { id: 'D1', destinatarios: 12, correo: 10, chat: 3, sin_correo: 1, dados_de_baja: 1 } })),
      prueba: vi.fn(async () => ({ ok: true as const, data: { para: 'r•••@renovacell.mx' } })),
      enviadas: vi.fn(async () => ({ ok: true as const, data: [] })),
      buscarClientes: vi.fn(async () => ({ ok: true as const, data: [] })),
    }
  }
  it('a una lista: dice a cuántos llega, manda prueba y luego la difusión', async () => {
    const c = falso(); vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<Difusiones cliente={c as unknown as ClienteDifusiones} />)
    fireEvent.click(await screen.findByTestId('dif-aud-lista'))
    await waitFor(() => expect(screen.getByTestId('dif-lista').querySelectorAll('option')).toHaveLength(2))
    fireEvent.change(screen.getByTestId('dif-lista'), { target: { value: 'L1' } })
    await waitFor(() => expect(c.previa).toHaveBeenLastCalledWith({ tipo: 'lista', etiqueta_id: 'L1' }))
    expect(await screen.findByTestId('dif-previa')).toHaveTextContent('12 clientes · 10 por correo · 3 por chat del portal · 1 sin correo · 1 se dieron de baja')
    fireEvent.change(screen.getByTestId('dif-titulo'), { target: { value: 'Nuevo Dysport' } })
    fireEvent.change(screen.getByTestId('dif-texto'), { target: { value: 'Ya llegó' } })
    fireEvent.change(screen.getByTestId('dif-enlace'), { target: { value: 'http://inseguro' } })
    expect(screen.getByTestId('dif-enviar')).toBeDisabled()   // solo enlaces https
    fireEvent.change(screen.getByTestId('dif-enlace'), { target: { value: 'https://renovacell.mx/x' } })
    fireEvent.click(screen.getByTestId('dif-prueba'))
    expect(await screen.findByTestId('dif-msg')).toHaveTextContent('Te mandamos una prueba a r•••@renovacell.mx')
    expect(screen.getByTestId('dif-enviar')).toHaveTextContent('Mandar (13)')
    fireEvent.click(screen.getByTestId('dif-enviar'))
    await waitFor(() => expect(c.enviar).toHaveBeenCalledWith({ titulo: 'Nuevo Dysport', texto: 'Ya llegó', enlace: 'https://renovacell.mx/x', imagen: '' }, { tipo: 'lista', etiqueta_id: 'L1' }, ['correo', 'chat']))
  })
  it('por especialidad: si nadie la tiene todavía, sugiere clasificar la cartera', async () => {
    const c = { ...falso(), previa: vi.fn(async () => ({ ok: true as const, data: { total: 0, con_correo: 0, dados_de_baja: 0, sin_correo: 0, con_cuenta: 0 } })) }
    render(<Difusiones cliente={c as unknown as ClienteDifusiones} />)
    fireEvent.click(await screen.findByTestId('dif-aud-filtro'))
    expect(await screen.findByText(/clasifica tu cartera en Clientes/)).toBeTruthy()
  })
})

describe('baja', () => {
  it('con el token del correo deja de recibir; sin token o con uno inválido lo dice', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }))
    render(<BajaCorreo token={ID} rpc={rpc} />)
    expect(await screen.findByText('Listo')).toBeTruthy()
    expect(rpc).toHaveBeenCalledWith('correo_baja', { p_token: ID })
    cleanup()
    render(<BajaCorreo token="nada" rpc={rpc} />)
    expect(await screen.findByText('Enlace no válido')).toBeTruthy()
  })
})
