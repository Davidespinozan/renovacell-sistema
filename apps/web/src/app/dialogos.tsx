// CALIDAD VISUAL (7 nov 2026) · diálogos del sistema con el estilo de la app en lugar de las ventanas nativas del navegador
// (window.confirm / alert / prompt: grises, fuera de marca y bloqueantes). Misma forma de uso, pero con promesa:
//   if (!(await confirmar('¿Borrar…?', { peligro: true }))) return
//   void avisar('Listo')
//   const motivo = await pedirTexto('Motivo:', 'opcional')
// Sin <DialogosHost/> montado (pruebas, pantallas sueltas) se usa el nativo: el comportamiento no cambia.
import React, { useEffect, useRef, useState } from 'react'

type Pedido =
  | { tipo: 'confirmar'; mensaje: string; peligro?: boolean; aceptar?: string; resolver: (v: boolean) => void }
  | { tipo: 'avisar'; mensaje: string; resolver: () => void }
  | { tipo: 'texto'; mensaje: string; defecto?: string; resolver: (v: string | null) => void }

let mostrar: ((p: Pedido) => void) | null = null

export function confirmar(mensaje: string, o: { peligro?: boolean; aceptar?: string } = {}): Promise<boolean> {
  if (!mostrar) return Promise.resolve(window.confirm(mensaje))
  return new Promise((resolver) => mostrar!({ tipo: 'confirmar', mensaje, ...o, resolver }))
}
export function avisar(mensaje: string): Promise<void> {
  if (!mostrar) { window.alert(mensaje); return Promise.resolve() }
  return new Promise((resolver) => mostrar!({ tipo: 'avisar', mensaje, resolver }))
}
export function pedirTexto(mensaje: string, defecto?: string): Promise<string | null> {
  if (!mostrar) return Promise.resolve(window.prompt(mensaje, defecto))
  return new Promise((resolver) => mostrar!({ tipo: 'texto', mensaje, defecto, resolver }))
}

const PELIGRO = /eliminar|borrar|dar de baja|revocar|anular|cancelar|rechaz|suspender|quitar|reversar|cerrar sin cargo/i

export function DialogosHost() {
  const [cola, setCola] = useState<Pedido[]>([])
  const [texto, setTexto] = useState('')
  const campo = useRef<HTMLInputElement | null>(null)
  const ok = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { mostrar = (p) => setCola((c) => [...c, p]); return () => { mostrar = null } }, [])
  const actual = cola[0]
  useEffect(() => {
    if (!actual) return
    if (actual.tipo === 'texto') { setTexto(actual.defecto ?? ''); setTimeout(() => campo.current?.select(), 0) } else setTimeout(() => ok.current?.focus(), 0)
  }, [actual])
  if (!actual) return null
  const cerrar = (aceptado: boolean) => {
    if (actual.tipo === 'confirmar') actual.resolver(aceptado)
    else if (actual.tipo === 'avisar') actual.resolver()
    else actual.resolver(aceptado ? texto : null)
    setCola((c) => c.slice(1))
  }
  const peligro = actual.tipo === 'confirmar' && (actual.peligro ?? PELIGRO.test(actual.mensaje))
  return (
    <div className="dlg-fondo" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget && actual.tipo !== 'avisar') cerrar(false) }}>
      <form className="dlg" role={actual.tipo === 'avisar' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label="Confirmación"
        onSubmit={(e) => { e.preventDefault(); cerrar(true) }} onKeyDown={(e) => { if (e.key === 'Escape') cerrar(false) }} data-testid="dialogo">
        <p className="dlg-msg">{actual.mensaje}</p>
        {actual.tipo === 'texto' && <input ref={campo} className="dlg-campo" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label={actual.mensaje} />}
        <div className="dlg-acc">
          {actual.tipo !== 'avisar' && <button type="button" className="btn ghost" onClick={() => cerrar(false)} data-testid="dialogo-cancelar">Cancelar</button>}
          <button ref={ok} type="submit" className={'btn' + (peligro ? ' dlg-peligro' : '')} data-testid="dialogo-aceptar">
            {actual.tipo === 'avisar' ? 'Entendido' : actual.tipo === 'texto' ? 'Aceptar' : (actual.aceptar ?? (peligro ? 'Sí, continuar' : 'Aceptar'))}
          </button>
        </div>
      </form>
    </div>
  )
}
