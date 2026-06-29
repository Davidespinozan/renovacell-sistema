// Encabezado de pantalla en lenguaje claro: un título que dice qué es y una
// línea corta que explica para qué sirve / cómo leerla. Sustituye al eyebrow
// técnico en las pantallas operativas para que cualquiera las entienda.
import React from 'react'

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-h">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  )
}
