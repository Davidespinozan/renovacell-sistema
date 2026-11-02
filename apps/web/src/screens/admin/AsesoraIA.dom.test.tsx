// @vitest-environment jsdom
// IA mejor que el humano · pantalla Asesora IA: comparación con el equipo, corridas del examen (correr caso por caso) y
// el modelo del portal, con un cliente falso (sin red).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AsesoraIA } from './AsesoraIA'
import type { ClienteAsesoraIa, Corrida } from '../../data/ops/asesoraIa'

beforeEach(cleanup)

const corrida: Corrida = { id: 'k1', modelo: 'claude-opus-5-5', esfuerzo: 'low', estado: 'terminada', pendientes: 0, nota: null, created_at: '2026-11-02T18:00:00Z', perfil: 'Dra. Prueba', casos: 60, corridos: 60, puntaje: 8.4, aprobados: 52,
  rechazos_validacion: 2, errores: 0, latencia_p50: 6200, latencia_p90: 11000, costo_promedio_usd: 0.031, por_categoria: { precio: 8.9, clinico: 7.1 } }

function falso(over: Partial<ClienteAsesoraIa> = {}): ClienteAsesoraIa {
  return {
    config: async () => ({ ok: true, data: { modelo_portal: null, esfuerzo_portal: 'low', updated_at: null, modelos: [] } }),
    guardarConfig: vi.fn(async (m) => ({ ok: true as const, data: { modelo_portal: m, esfuerzo_portal: 'low' as const, updated_at: null, modelos: [] } })),
    corridas: async () => ({ ok: true, data: [corrida] }),
    resultados: async () => ({ ok: true, data: [{ caso_id: 'P01', categoria: 'precio', pregunta: 'cuanto el botox', historial: [], ideal: null, respuesta: 'Está en $3,900.', estado: 'respondio', motivo_validacion: null, herramientas: [], latencia_ms: 5000, costo_usd: 0.02, puntaje: 9, aprobado: true, juicio: { puntaje: 9, aprobado: true, cumple: [], falla: [], comentario: 'Preciso.' }, error: null }] }),
    crearCorrida: vi.fn(async () => ({ ok: true as const, data: 'k2' })),
    vsHumano: async () => ({ ok: true, data: { dias: 30, respuestas: { ia: { n: 40, mediana_seg: 6, p90_seg: 12, en_5_min: 100 }, equipo: { n: 10, mediana_seg: 1800, p90_seg: 7200, en_5_min: 20 } }, conversaciones: { ia: { n: 20, con_pedido: 4, conversion: 20, ticket_promedio: 8000, pidieron_asesor: 3 } }, muestra_suficiente: true } }),
    continuar: vi.fn(async () => ({ ok: true as const, data: 5 })),
    detener: vi.fn(async () => ({ ok: true as const, data: null })),
    seguimiento: async () => ({ ok: true, data: { carrito: true, recompra: true, promo: true, horas_entre: 24, por_semana: 2, hora_desde: 10, hora_hasta: 19, updated_at: null } }),
    guardarSeguimiento: vi.fn(async (c) => ({ ok: true as const, data: { carrito: true, recompra: true, promo: true, horas_entre: 24, por_semana: 2, hora_desde: 10, hora_hasta: 19, updated_at: null, ...c } })),
    resumenSeguimiento: async () => ({ ok: true, data: { carrito: { enviados: 12, respondieron: 5, con_pedido: 3, vendido: 24500 } } }),
    doctores: async () => ({ ok: true, data: [{ id: 'd1', full_name: 'Dra. Prueba', email: null }] }),
    ...over,
  }
}

describe('<AsesoraIA>', () => {
  it('compara IA vs equipo y lista las corridas con calificación, costo y su categoría más baja', async () => {
    render(<AsesoraIA cliente={falso()} />)
    const vs = await screen.findByTestId('ia-vs-equipo')
    expect(vs).toHaveTextContent('Responde la IA en6 s')
    expect(vs).toHaveTextContent('Responde el equipo en30 min')
    expect(screen.getByText('8.4')).toBeInTheDocument()
    expect(screen.getByText('52/60')).toBeInTheDocument()
    expect(screen.getByText('$0.031')).toBeInTheDocument()
    expect(screen.getByText('Clínico (7.1)')).toBeInTheDocument()
  })
  it('iniciar el examen lo deja al servidor (se puede cerrar la página) y muestra las respuestas con el juicio', async () => {
    const c = falso(); render(<AsesoraIA cliente={c} />)
    await screen.findByText('Dra. Prueba', { selector: 'option' })
    fireEvent.click(screen.getByTestId('examen-correr'))
    await waitFor(() => expect(c.crearCorrida).toHaveBeenCalledWith('claude-opus-5-5', 'd1', 'low', null, null))
    expect(await screen.findByText(/lo corre el servidor, puedes cerrar esta página/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Ver respuestas'))
    expect(await screen.findByText(/Juez: Preciso\./)).toBeInTheDocument()
  })
  it('Dirección cambia el modelo del portal y se le confirma', async () => {
    const c = falso(); render(<AsesoraIA cliente={c} />)
    await screen.findByText(/Mejor calificado en el examen: Claude Opus 5\.5/)
    fireEvent.change(screen.getByTestId('portal-modelo'), { target: { value: 'claude-opus-5-5' } })
    fireEvent.click(screen.getByTestId('portal-guardar'))
    await waitFor(() => expect(c.guardarConfig).toHaveBeenCalledWith('claude-opus-5-5', 'low'))
    expect(await screen.findByText('La IA del portal ahora usa Claude Opus 5.5.')).toBeInTheDocument()
  })
  it('seguimiento: qué pasó después de cada tipo y Dirección lo apaga', async () => {
    const c = falso(); render(<AsesoraIA cliente={c} />)
    expect(await screen.findByTestId('seg-res-carrito')).toHaveTextContent('12 enviados · 5 respondieron3 compraron · $24,500')
    fireEvent.click(screen.getByTestId('seg-promo'))
    await waitFor(() => expect(c.guardarSeguimiento).toHaveBeenCalledWith({ promo: false }))
  })
  it('una corrida a medias se continúa y una en curso se detiene', async () => {
    const aMedias = { ...corrida, id: 'k3', estado: 'detenida' as const, corridos: 20 }
    const enCurso = { ...corrida, id: 'k4', estado: 'en_curso' as const, corridos: 7, pendientes: 53 }
    const c = falso({ corridas: async () => ({ ok: true, data: [enCurso, aMedias] }) }); render(<AsesoraIA cliente={c} />)
    expect(await screen.findByText('corriendo 7/60…')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('examen-continuar')); await waitFor(() => expect(c.continuar).toHaveBeenCalledWith('k3'))
    fireEvent.click(screen.getByTestId('examen-detener')); await waitFor(() => expect(c.detener).toHaveBeenCalledWith('k4'))
  })
})
