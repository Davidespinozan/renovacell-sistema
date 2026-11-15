// Encabezado de pantalla en lenguaje claro: una línea corta que explica para qué sirve
// la pantalla / cómo leerla. El TÍTULO lo pone la cabecera (TopBar) con el nombre de la
// pantalla: aquí solo se repite cuando el título es distinto (sub-vistas, pantallas de
// capacidad). Así no aparece "Ventas" dos veces en la misma columna.
import React, { useState } from 'react'
import { Info } from 'lucide-react'
import { useRoleOpcional } from '../auth/RoleContext'
import { getRole, getScreenDef } from './roles'

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  const ctx = useRoleOpcional()
  let labelPantalla: string | undefined
  if (ctx) {
    try { labelPantalla = getScreenDef(getRole(ctx.role), ctx.screen, undefined, ctx.capabilities).label } catch { /* sin def */ }
  }
  const repiteTitulo = labelPantalla != null && labelPantalla.trim().toLowerCase() === title.trim().toLowerCase()
  // UX MODERNO (15 nov 2026, auditoría: "la app se explica a sí misma"): la explicación ya no es un párrafo encima de la
  // pantalla; queda detrás de un enlace discreto «Cómo funciona» que se abre al tocarlo.
  const [abierto, setAbierto] = useState(false)
  if (repiteTitulo && !children) return null
  return (
    <div className={'page-h' + (repiteTitulo ? ' page-h--lead' : '')}>
      {!repiteTitulo && <h1>{title}</h1>}
      {children && (
        <button type="button" className="page-h-ayuda" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)} data-testid="page-h-ayuda">
          <Info aria-hidden /> {abierto ? 'Ocultar' : 'Cómo funciona'}
        </button>
      )}
      {children && abierto && <p className="page-h-p page-h-p--abierta">{children}</p>}
    </div>
  )
}
