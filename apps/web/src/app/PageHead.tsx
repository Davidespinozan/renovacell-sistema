// Encabezado de pantalla en lenguaje claro: una línea corta que explica para qué sirve
// la pantalla / cómo leerla. El TÍTULO lo pone la cabecera (TopBar) con el nombre de la
// pantalla: aquí solo se repite cuando el título es distinto (sub-vistas, pantallas de
// capacidad). Así no aparece "Ventas" dos veces en la misma columna.
import React from 'react'
import { useRoleOpcional } from '../auth/RoleContext'
import { getRole, getScreenDef } from './roles'

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  const ctx = useRoleOpcional()
  let labelPantalla: string | undefined
  if (ctx) {
    try { labelPantalla = getScreenDef(getRole(ctx.role), ctx.screen, undefined, ctx.capabilities).label } catch { /* sin def */ }
  }
  const repiteTitulo = labelPantalla != null && labelPantalla.trim().toLowerCase() === title.trim().toLowerCase()
  if (repiteTitulo && !children) return null
  return (
    <div className={'page-h' + (repiteTitulo ? ' page-h--lead' : '')}>
      {!repiteTitulo && <h1>{title}</h1>}
      {children && <p>{children}</p>}
    </div>
  )
}
