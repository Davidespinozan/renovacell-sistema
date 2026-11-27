// Código QR dibujado aquí mismo (sin pedirle la imagen a ningún servicio). Negro sobre blanco siempre: es para imprimir
// y para leerse con la cámara, así que no sigue el tema de la pantalla.
import React, { useMemo } from 'react'
import { trazoQR } from '../data/ops/autofactura'

export function CodigoQR({ texto, lado = 120, etiqueta = 'Código QR' }: { texto: string; lado?: number; etiqueta?: string }) {
  const { d, lado: n } = useMemo(() => trazoQR(texto), [texto])
  const margen = 4   // zona quieta que pide el estándar
  return (
    <svg className="codigo-qr" width={lado} height={lado} viewBox={`${-margen} ${-margen} ${n + margen * 2} ${n + margen * 2}`} shapeRendering="crispEdges" role="img" aria-label={etiqueta} data-testid="codigo-qr" data-texto={texto}>
      <rect x={-margen} y={-margen} width={n + margen * 2} height={n + margen * 2} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}
