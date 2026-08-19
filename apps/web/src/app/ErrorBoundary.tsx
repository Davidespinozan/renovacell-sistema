// Red de seguridad de la app: si un error de render escapa, en vez de una PANTALLA BLANCA
// el usuario ve un aviso claro con "Recargar", y el error se reporta a la observabilidad
// (Sentry si está activo). Antes no existía ErrorBoundary — cualquier throw en render
// tumbaba toda la interfaz sin rastro. Estilos inline con fallback por si el CSS no cargó.
import React from 'react'
import { captureError } from '../lib/sentry'

interface Props { children: React.ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    captureError(error, { componentStack: info.componentStack })
  }

  private reset = () => { window.location.reload() }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={badge}>!</div>
          <h1 style={title}>Algo salió mal en esta pantalla</h1>
          <p style={text}>
            El sistema tuvo un problema al mostrar esta sección. Tu información está a salvo.
            Recarga para volver a intentarlo; si sigue pasando, avísale a soporte.
          </p>
          <button type="button" onClick={this.reset} style={btn}>Recargar</button>
        </div>
      </div>
    )
  }
}

const wrap: React.CSSProperties = {
  minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
  background: 'var(--paper, #f5f8f6)', color: 'var(--ink, #16211c)',
  fontFamily: 'inherit',
}
const card: React.CSSProperties = {
  maxWidth: 420, textAlign: 'center', background: 'var(--card, #fff)',
  border: '1px solid var(--line, #dbe3de)', borderRadius: 16, padding: '32px 28px',
  boxShadow: '0 8px 30px rgba(20,40,30,.08)',
}
const badge: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 12, margin: '0 auto 16px',
  display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700,
  background: 'var(--danger-bg, #fbe9e7)', color: 'var(--danger, #be4a3f)',
}
const title: React.CSSProperties = { margin: '0 0 10px', fontSize: 19, fontWeight: 600 }
const text: React.CSSProperties = { margin: '0 0 22px', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-3, #6e7a73)' }
const btn: React.CSSProperties = {
  fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  padding: '10px 22px', borderRadius: 10, border: 'none',
  background: 'var(--green-deep, #1e7a4b)', color: '#fff',
}
