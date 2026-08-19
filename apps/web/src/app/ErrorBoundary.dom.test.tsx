// @vitest-environment jsdom
// La red de seguridad: sin DSN, captureError es no-op silencioso y el ErrorBoundary
// muestra el aviso (no pantalla blanca) cuando un hijo revienta en render.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'
import { captureError } from '../lib/sentry'

beforeEach(cleanup)

function Boom(): React.ReactNode { throw new Error('kaboom') }

describe('ErrorBoundary + observabilidad', () => {
  it('captureError no lanza cuando Sentry está apagado (sin DSN)', () => {
    expect(() => captureError(new Error('x'), { foo: 1 })).not.toThrow()
  })

  it('muestra el aviso en vez de propagar el error del hijo', () => {
    // Silencia el error esperado que React imprime al capturarlo.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByText('Algo salió mal en esta pantalla')).toBeInTheDocument()
    expect(screen.getByText('Recargar')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('renderiza a los hijos cuando no hay error', () => {
    render(<ErrorBoundary><div>contenido ok</div></ErrorBoundary>)
    expect(screen.getByText('contenido ok')).toBeInTheDocument()
  })
})

afterEach(cleanup)
