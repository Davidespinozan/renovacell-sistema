// @vitest-environment jsdom
// ENLACE-VENDEDOR · enlace por vendedor y recomendación desde el portal: quien lo recibe ve con quién habla y quién lo
// recomendó (confianza en un chat que no es WhatsApp); el cliente lo comparte desde su Inicio; quien atiende ve el origen.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Contacto } from './Contacto'
import { Recomendar } from '../home/Recomendar'
import { OrigenChip, textoOrigen } from './OrigenConversacion'
import { codigoDeRuta, textoCompartir, urlDeEnlace, type EnlacePublico } from '../../data/ops/enlaces'
import { textosVista } from '../../../../../netlify/edge-functions/contacto-vista'
import { ClienteChat } from '../../data/ops/chat'

afterEach(cleanup)
const ROBERTO: EnlacePublico = { valido: true, tipo: 'referido', asesor: { nombre: 'Roberto Ibarra', primer_nombre: 'Roberto', foto: null }, recomienda: 'Lourdes' }
const cliente = () => new ClienteChat(async () => ({ data: { ok: true }, error: null }), () => null)

describe('enlace del chat', () => {
  it('ruta → código; solo códigos con forma válida', () => {
    expect(codigoDeRuta('/contacto/roberto-ibarra')).toBe('roberto-ibarra')
    expect(codigoDeRuta('/contacto/Lourdes-K7M2/')).toBe('lourdes-k7m2')
    expect(codigoDeRuta('/contacto')).toBeNull()
    expect(codigoDeRuta('/contacto/<script>')).toBeNull()
    expect(codigoDeRuta('/contacto/a/b')).toBeNull()
    expect(urlDeEnlace('roberto-ibarra', 'https://renovacell.mx/contacto')).toBe('https://renovacell.mx/contacto/roberto-ibarra')
  })

  it('quien recibe una recomendación ve, antes de escribir, quién la recomendó, con qué asesor habla y que es Renovacell', async () => {
    const aplicar = vi.fn(async () => ROBERTO)
    render(<Contacto codigo="lourdes-k7m2" ver={async () => ROBERTO} aplicar={aplicar} abrir={vi.fn(async () => 'nuevo' as const)} conSesion={async () => 'ninguna' as const}
      cliente={cliente()} />)
    expect(await screen.findByTestId('te-atiende')).toHaveTextContent('Te atiende Roberto')
    const conf = await screen.findByTestId('contacto-confianza')
    expect(conf).toHaveTextContent('Lourdes te recomendó con nosotros')
    expect(conf).toHaveTextContent('Renovacell · Tecnologías Antiedad')
    expect(conf).toHaveTextContent('Hablas directo con Roberto')
    expect(conf).toHaveTextContent('Sin descargar nada ni crear cuenta')
    expect(screen.queryByTestId('prerregistro')).toBeNull()   // sin formulario: el asistente pide los datos platicando
    expect(aplicar).toHaveBeenCalledWith('lourdes-k7m2')   // queda registrado por qué enlace llegó
  })

  it('sin código (enlace general) se ve como siempre', async () => {
    const ver = vi.fn(async () => ROBERTO)
    render(<Contacto codigo={null} ver={ver} abrir={vi.fn(async () => 'nuevo' as const)} conSesion={async () => 'ninguna' as const}
      cliente={cliente()} />)
    await screen.findByTestId('chat-canonico')
    expect(screen.queryByTestId('te-atiende')).toBeNull(); expect(screen.queryByText(/te recomendó/)).toBeNull()
    expect(ver).not.toHaveBeenCalled()
  })

  it('el cliente recomienda desde su Inicio: mensaje en primera persona con su asesor y su enlace', async () => {
    const writeText = vi.fn(async () => {}); Object.assign(navigator, { clipboard: { writeText } })
    render(<Recomendar cargar={async () => ({ tipo: 'referido', codigo: 'lourdes-k7m2', cifras: { visitas: 3, contactos: 2, cuentas: 0 }, asesor: { nombre: 'Roberto Ibarra', primer_nombre: 'Roberto' } })} />)
    expect(await screen.findByTestId('doctor-recomendar')).toHaveTextContent('Quien abra tu enlace habla directo con Roberto, tu asesor')
    expect(screen.getByTestId('doctor-recomendar-texto').textContent).toMatch(/^Te recomiendo Renovacell, es con quien compro\. Escríbele a Roberto, mi asesor, .*\/contacto\/lourdes-k7m2$/)
    expect(screen.getByTestId('doctor-recomendar')).toHaveTextContent('2 personas ya escribieron de tu parte')
    fireEvent.click(screen.getByTestId('doctor-recomendar-compartir'))   // sin hoja nativa (jsdom): se copia el mensaje completo
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Te recomiendo Renovacell/)))
  })

  it('sin ficha de cliente (o personal) la tarjeta no aparece', async () => {
    const { container } = render(<Recomendar cargar={async () => null} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.innerHTML).toBe('')
  })

  it('el vendedor comparte su enlace presentándose', () => {
    expect(textoCompartir({ tipo: 'vendedor' }, 'https://renovacell.mx/contacto/roberto-ibarra', 'Roberto Ibarra'))
      .toBe('Hola, soy Roberto Ibarra, asesor de Renovacell · Tecnologías Antiedad. Te atiendo directo por aquí, sin descargar nada: https://renovacell.mx/contacto/roberto-ibarra')
  })

  it('quien atiende ve de dónde llegó la conversación', async () => {
    expect(textoOrigen({ tipo: 'vendedor', codigo: 'x', vendedor: 'Roberto Ibarra', es_tuyo: true, recomienda: null })).toBe('Llegó por tu enlace')
    expect(textoOrigen({ tipo: 'vendedor', codigo: 'x', vendedor: 'Roberto Ibarra', es_tuyo: false, recomienda: null })).toBe('Llegó por el enlace de Roberto Ibarra')
    render(<OrigenChip conversationId="C1" leer={async () => ({ tipo: 'referido', codigo: 'l', vendedor: 'Roberto Ibarra', es_tuyo: true, recomienda: 'DRA. LOURDES VELAZQUEZ' })} />)
    expect(await screen.findByTestId('origen-conversacion')).toHaveTextContent('Recomendada por Dra. Lourdes Velazquez (tu cliente)')
  })

  it('vista previa al pegar el enlace: quién recomienda y con quién habla (no un genérico)', () => {
    expect(textosVista(ROBERTO)).toEqual({ titulo: 'Lourdes te recomienda Renovacell', descripcion: 'Roberto, asesor de Renovacell · Tecnologías Antiedad, te atiende directo por aquí. Sin descargar nada.' })
    expect(textosVista({ valido: true, asesor: { nombre: 'Roberto Ibarra', primer_nombre: 'Roberto' }, recomienda: null })!.titulo).toBe('Chatea con Roberto Ibarra · Renovacell')
    expect(textosVista({ valido: false })).toBeNull()
  })
})
