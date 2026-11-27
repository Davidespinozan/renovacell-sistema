// LISTA + DETALLE (27 nov 2026, «sistema sencillo por rol»): el patrón del Inicio de Almacén, para las demás pantallas
// que tenían una tarjeta grande por pedido. Los pedidos van en renglones cortos; en computadora el elegido se abre al
// lado y en el celular debajo de su renglón (uno a la vez). El primero —el que sale antes— ya viene abierto: es el
// siguiente por hacer. El contenido del detalle lo pone cada pantalla: aquí no hay lógica de negocio.
import React, { useState } from 'react'
import { useAnchoMinimo } from './useAnchoMinimo'

export interface Renglon {
  titulo: React.ReactNode
  sub?: React.ReactNode
  /** Tercera línea, corta (p. ej. cuándo sale). `aviso` la pinta en tono de atención. */
  nota?: React.ReactNode
  aviso?: boolean
  pill?: { texto: string; clase: string }
  /** Control a la izquierda del renglón (p. ej. la casilla para elegir varios). */
  antes?: React.ReactNode
}

export function ListaDetalle<T>({ items, clave, renglon, detalle, testid = 'md', etiqueta = 'Pedido elegido' }: {
  items: T[]
  clave: (x: T) => string
  renglon: (x: T) => Renglon
  detalle: (x: T) => React.ReactNode
  testid?: string
  etiqueta?: string
}) {
  const ancho = useAnchoMinimo(1000)
  // undefined = todavía no elige (se abre el primero); null = lo cerró a propósito (solo en el celular).
  const [sel, setSel] = useState<string | null | undefined>(undefined)
  const claves = items.map(clave)
  const elegida = sel === null && !ancho ? null : sel && claves.includes(sel) ? sel : claves[0] ?? null
  const item = items.find((x) => clave(x) === elegida) ?? null
  const tocar = (k: string) => setSel(!ancho && elegida === k ? null : k)   // en el celular, tocar el abierto lo cierra

  return (
    <div className={'hoy-md' + (ancho ? '' : ' hoy-md--solo')} data-testid={testid}>
      <div className="tasklist hoy-lista" data-testid={`${testid}-lista`}>
        {items.map((x) => {
          const k = clave(x); const r = renglon(x); const abierta = elegida === k
          const cuerpo = (
            <>
              <span className="taskrow-tx">
                <span className="taskrow-t">{r.titulo}</span>
                {r.sub && <span className="taskrow-d">{r.sub}</span>}
                {r.nota && <span className={'taskrow-d' + (r.aviso ? ' hoy-renglon-atraso' : '')}>{r.nota}</span>}
              </span>
              {r.pill && <span className={'pill ' + r.pill.clase}>{r.pill.texto}</span>}
            </>
          )
          const clases = 'taskrow hoy-renglon md-renglon' + (abierta ? ' hoy-renglon--sel' : '')
          return (
            <React.Fragment key={k}>
              {r.antes
                ? <div className={clases + ' md-renglon--con'} data-testid={`${testid}-fila-${k}`}>{r.antes}<button type="button" className="md-abrir" aria-pressed={abierta} onClick={() => tocar(k)} data-testid={`${testid}-abrir-${k}`}>{cuerpo}</button></div>
                : <button type="button" className={clases} aria-pressed={abierta} onClick={() => tocar(k)} data-testid={`${testid}-abrir-${k}`}>{cuerpo}</button>}
              {!ancho && abierta && <div className="md-abierto" data-testid={`${testid}-detalle`}>{detalle(x)}</div>}
            </React.Fragment>
          )
        })}
      </div>
      {ancho && (
        <aside className="card hoy-detalle md-detalle" aria-label={etiqueta} data-testid={`${testid}-detalle`}>
          {item ? detalle(item) : null}
        </aside>
      )}
    </div>
  )
}
