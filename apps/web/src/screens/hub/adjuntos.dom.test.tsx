// @vitest-environment jsdom
// EQUIPO-ADJUNTOS (3 nov 2026) · el Chat del equipo manda imágenes, videos y documentos (modo mock: vista local), dice
// claro por qué rechaza un archivo y la ruta/etiquetas son las que exige la base.
import React from 'react'
import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Chat } from './Chat'
import { claseDe, etiquetaAdjunto, pesoLegible, problemaArchivo, rutaAdjunto, tipoDe } from '../../data/ops/adjuntosEquipo'

beforeAll(() => { if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:prueba' })
beforeEach(cleanup)

const archivo = (nombre: string, tipo: string, bytes = 2048) => new File([new Uint8Array(bytes)], nombre, { type: tipo })

describe('reglas de adjuntos', () => {
  it('reconoce imagen, video y documento (también sin tipo, por la extensión)', () => {
    expect(claseDe(tipoDe('foto.HEIC', ''))).toBe('imagen')
    expect(claseDe(tipoDe('clip.mov', ''))).toBe('video')
    expect(claseDe(tipoDe('Lista.xlsx', 'application/octet-stream'))).toBe('documento')
    expect(claseDe(tipoDe('virus.exe', 'application/x-msdownload'))).toBeNull()
  })
  it('explica por qué no se manda un archivo', () => {
    expect(problemaArchivo({ name: 'grande.mp4', type: 'video/mp4', size: 60 * 1024 * 1024 })).toMatch(/pesa 60 MB; el máximo es 50 MB/)
    expect(problemaArchivo({ name: 'app.exe', type: 'application/x-msdownload', size: 10 })).toMatch(/no es una imagen, un video ni un documento/)
    expect(problemaArchivo({ name: 'ok.pdf', type: 'application/pdf', size: 10 })).toBeNull()
  })
  it('ruta <conversación>/<quien sube>/<id>-<nombre limpio> y etiquetas', () => {
    expect(rutaAdjunto('C', 'U', 'M', 'Cotización Dra. Pérez (final).pdf')).toBe('C/U/M-Cotizacion_Dra._Perez_final_.pdf')
    expect(etiquetaAdjunto({ path: 'p', nombre: 'Lista.pdf', tipo: 'application/pdf', tamano: 1, clase: 'documento' })).toBe('📄 Lista.pdf')
    expect(etiquetaAdjunto({ path: 'p', nombre: 'a.jpg', tipo: 'image/jpeg', tamano: 1, clase: 'imagen' })).toBe('📷 Imagen')
    expect(pesoLegible(1536 * 1024)).toBe('1.5 MB'); expect(pesoLegible(3000)).toBe('3 KB')
  })
})

describe('<Chat> con adjuntos', () => {
  it('manda una imagen con su pie, un documento y un video; la lista adelanta qué fue', async () => {
    renderWithRole(<Chat />)
    fireEvent.click(screen.getByText('Todos'))
    fireEvent.change(screen.getByPlaceholderText(/Mensaje a Todos/i), { target: { value: 'Así quedó el anaquel' } })
    const input = screen.getByTestId('adjunto-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [archivo('anaquel.jpg', 'image/jpeg'), archivo('Lista precios.pdf', 'application/pdf', 300 * 1024), archivo('recorrido.mp4', 'video/mp4')] } })
    const hilo = document.querySelector('.rc-thread') as HTMLElement
    await waitFor(() => expect(within(hilo).getByTestId('adjunto-documento')).toBeInTheDocument())
    expect(within(hilo).getByText('Así quedó el anaquel')).toBeInTheDocument()   // el texto va como pie de la primera
    await waitFor(() => expect(within(hilo).getByTestId('adjunto-imagen').querySelector('img')).toBeTruthy())
    expect(within(hilo).getByTestId('adjunto-documento')).toHaveTextContent('Lista precios.pdf')
    expect(within(hilo).getByTestId('adjunto-documento')).toHaveTextContent('PDF · 300 KB')
    await waitFor(() => expect(within(hilo).getByTestId('adjunto-video').querySelector('video')).toBeTruthy())
    expect((screen.getByPlaceholderText(/Mensaje a Todos/i) as HTMLTextAreaElement).value).toBe('')
    expect(document.querySelector('.tc-row.on')).toHaveTextContent('🎥 Video')
  })
  it('un archivo no permitido no se manda y se dice por qué', async () => {
    renderWithRole(<Chat />)
    fireEvent.click(screen.getByText('Todos'))
    fireEvent.change(screen.getByTestId('adjunto-input'), { target: { files: [archivo('programa.exe', 'application/x-msdownload')] } })
    expect(await screen.findByTestId('adjunto-error')).toHaveTextContent('«programa.exe» no es una imagen, un video ni un documento')
    expect(within(document.querySelector('.rc-thread') as HTMLElement).queryByText(/programa\.exe/)).toBeNull()   // no entró al hilo
  })
})
