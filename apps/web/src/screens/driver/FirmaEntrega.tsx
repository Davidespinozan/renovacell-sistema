// FIRMA DE ENTREGA (23 nov 2026, dueño: «que no sea foto, que sea firma de entregado»). Quien recibe firma con el dedo
// en el celular del chofer. La firma se exporta como imagen (fondo blanco, tinta oscura: es un documento, no tema) y se
// sube al mismo lugar privado que antes la foto; «Ver prueba» la muestra igual.
import React, { useCallback, useEffect, useRef, useState } from 'react'

const TINTA = '#111827'
const FONDO = '#ffffff'
/** Mínimo de trazo para contar como firma (evita que un toque accidental «firme»). */
export const MIN_PUNTOS = 12

/** `onCambio(archivo)`: la firma como PNG cada vez que se termina un trazo válido; null al borrar. */
export function FirmaEntrega({ onCambio, deshabilitada = false }: { onCambio: (firma: File | null) => void; deshabilitada?: boolean }) {
  const lienzo = useRef<HTMLCanvasElement | null>(null)
  const trazando = useRef(false)
  const puntos = useRef(0)
  const [firmada, setFirmada] = useState(false)

  const preparar = useCallback(() => {
    const c = lienzo.current; if (!c) return
    const r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1
    c.width = Math.max(1, Math.round(r.width * k)); c.height = Math.max(1, Math.round(r.height * k))
    const g = c.getContext('2d'); if (!g) return
    g.setTransform(k, 0, 0, k, 0, 0)
    g.fillStyle = FONDO; g.fillRect(0, 0, r.width, r.height)
    g.strokeStyle = TINTA; g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'
  }, [])
  useEffect(() => { preparar() }, [preparar])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const inicio = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (deshabilitada) return
    const g = e.currentTarget.getContext('2d'); if (!g) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    trazando.current = true
    const p = pos(e); g.beginPath(); g.moveTo(p.x, p.y)
  }
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!trazando.current) return
    const g = e.currentTarget.getContext('2d'); if (!g) return
    const p = pos(e); g.lineTo(p.x, p.y); g.stroke()
    puntos.current += 1
  }
  const fin = () => {
    if (!trazando.current) return
    trazando.current = false
    if (puntos.current < MIN_PUNTOS) return
    setFirmada(true)
    void firmaComoArchivo(lienzo.current).then((f) => onCambio(f))
  }
  const borrar = () => { puntos.current = 0; preparar(); setFirmada(false); onCambio(null) }

  return (
    <div className="firma-entrega" data-testid="firma-entrega">
      <canvas ref={lienzo} className="firma-lienzo" aria-label="Firma de quien recibe"
        onPointerDown={inicio} onPointerMove={mover} onPointerUp={fin} onPointerCancel={fin} onPointerLeave={fin} data-testid="firma-lienzo" />
      <div className="firma-pie">
        <span>{firmada ? 'Firma lista' : 'Firma de quien recibe (con el dedo)'}</span>
        <button type="button" className="btn ghost sm" onClick={borrar} disabled={deshabilitada} data-testid="firma-borrar">Borrar</button>
      </div>
    </div>
  )
}

/** La firma del lienzo como archivo PNG listo para subir. null si no se puede leer. */
export function firmaComoArchivo(c: HTMLCanvasElement | null): Promise<File | null> {
  return new Promise((res) => {
    if (!c) { res(null); return }
    try { c.toBlob((b) => res(b ? new File([b], 'firma.png', { type: 'image/png' }) : null), 'image/png') } catch { res(null) }
  })
}
