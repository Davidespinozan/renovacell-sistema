// CHV2-B · Primitivas de Inicio (RoleHome). Todas las variantes por rol se arman con estas piezas:
// bienvenida → requiere atención → continuar/hoy → accesos. Máximo tres niveles visuales:
//   1. 'atencion'  — requiere tu atención (tarjetas con acción principal)
//   2. 'continuar' — hoy / continúa donde te quedaste
//   3. 'info'      — información y accesos
// Cada tarjeta responde: por qué la veo (título + estado), qué hago (CTA) y a dónde me lleva.
import React from 'react'
import { Icon, type IconName } from '../../app/icons'
import { initials } from '../../lib/format'

export type Tono = 'dang' | 'warn' | 'neu' | 'ok'
const PILL: Record<Tono, string> = { dang: 'p-dang', warn: 'p-warn', neu: 'p-neu', ok: 'p-ok' }

export function Bienvenida({ nombre, avatarUrl, titulo, detalle, etiqueta }: { nombre: string; avatarUrl?: string; titulo: string; detalle: string; etiqueta?: string }) {
  return (
    <header className="rh-hello" data-testid="rh-bienvenida">
      {avatarUrl ? <img className="rh-av" src={avatarUrl} alt="" /> : <span className="rh-av" aria-hidden>{initials(nombre.split('·')[0].trim() || 'R')}</span>}
      <div className="rh-hello-t">
        <h2 className="rh-hello-h">{titulo}</h2>
        <p className="rh-hello-p">{detalle}</p>
      </div>
      {etiqueta && <span className="rh-role">{etiqueta}</span>}
    </header>
  )
}

export function Seccion({ titulo, nivel, conteo, accion, children, id }: { titulo: string; nivel: 'atencion' | 'continuar' | 'info'; conteo?: number; accion?: { label: string; onClick: () => void }; children: React.ReactNode; id?: string }) {
  const hid = `rh-${id ?? titulo.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`
  return (
    <section className={`rh-sec rh-sec--${nivel}`} aria-labelledby={hid} data-testid={id ? `rh-sec-${id}` : undefined}>
      <div className="rh-sec-h">
        <h3 id={hid}>{titulo}{conteo != null && conteo > 0 && <span className="rh-count" aria-label={`${conteo} pendiente(s)`}>{conteo}</span>}</h3>
        {accion && <button type="button" className="rh-link" onClick={accion.onClick}>{accion.label} <span aria-hidden>›</span></button>}
      </div>
      {children}
    </section>
  )
}

export interface Cta { label: string; onClick: () => void; testid?: string; primaria?: boolean; disabled?: boolean }
export function TarjetaAtencion({ tono, titulo, estado, lineas, ctas, testid, destacada }: { tono: Tono; titulo: string; estado?: string; lineas: Array<string | null | undefined | false>; ctas: Cta[]; testid?: string; destacada?: boolean }) {
  const ls = lineas.filter((l): l is string => !!l)
  return (
    <article className={`rh-card rh-card--${tono}${destacada ? ' rh-card--destacada' : ''}`} data-testid={testid}>
      <div className="rh-card-top">
        <div className="rh-card-title">{titulo}</div>
        {estado && <span className={`pill ${PILL[tono]}`}>{estado}</span>}
      </div>
      {ls.length > 0 && <ul className="rh-lines">{ls.map((l) => <li key={l}>{l}</li>)}</ul>}
      {ctas.length > 0 && (
        <div className="rh-ctas">
          {ctas.map((c) => (
            <button key={c.label} type="button" className={`btn rh-btn${c.primaria ? ' btn-primary' : ' ghost'}`} onClick={c.onClick} data-testid={c.testid} disabled={c.disabled}>{c.label}</button>
          ))}
        </div>
      )}
    </article>
  )
}

export function Tarjetas({ children }: { children: React.ReactNode }) { return <div className="rh-cards">{children}</div> }

export function Vacio({ icon = 'check', titulo, detalle, testid }: { icon?: IconName; titulo: string; detalle?: string; testid?: string }) {
  return (
    <div className="rh-empty" data-testid={testid}>
      <span className="rh-empty-ic" aria-hidden><Icon name={icon} /></span>
      <div><div className="rh-empty-t">{titulo}</div>{detalle && <div className="rh-empty-d">{detalle}</div>}</div>
    </div>
  )
}

export function Cargando({ filas = 2 }: { filas?: number }) {
  return (
    <div className="rh-cards" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => <div key={i} className="rh-skel" />)}
    </div>
  )
}

export function ErrorLectura({ texto, onReintentar }: { texto: string; onReintentar?: () => void }) {
  return (
    <div className="rh-error" role="alert">
      <span>{texto}</span>
      {onReintentar && <button type="button" className="btn rh-btn" onClick={onReintentar}>Reintentar</button>}
    </div>
  )
}

export interface Acceso { key: string; label: string; icon: IconName; onClick: () => void; detalle?: string }
export function Accesos({ items }: { items: Acceso[] }) {
  if (items.length === 0) return null
  return (
    <nav className="rh-quick" aria-label="Accesos rápidos">
      {items.map((a) => (
        <button key={a.key} type="button" className="rh-tile" onClick={a.onClick} data-testid={`acceso-${a.key}`}>
          <span className="rh-tile-ic" aria-hidden><Icon name={a.icon} /></span>
          <span className="rh-tile-t">{a.label}{a.detalle && <small>{a.detalle}</small>}</span>
        </button>
      ))}
    </nav>
  )
}

export function Nota({ children, tono = 'neu' }: { children: React.ReactNode; tono?: Tono }) {
  return <div className={`rh-note rh-note--${tono}`} role="note">{children}</div>
}

/** "Dra. Ana Ruiz · Ventas" → "Ana". */
export function nombreCorto(nombre: string | undefined | null): string {
  const limpio = (nombre ?? '').split('·')[0].trim().replace(/^(dra?\.?|doctora?|lic\.?|ing\.?)\s+/i, '')
  return limpio.split(/\s+/)[0] || ''
}
