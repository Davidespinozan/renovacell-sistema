// PERF · pantallas bajo demanda: cada una se descarga al abrirla, no todas al iniciar sesión.
// Si se publicó una versión nueva con la app abierta, los archivos viejos ya no existen y la descarga falla: en vez de
// recargar sola (alguien puede estar a media venta, ver VersionNueva) se muestra el aviso para actualizar.
import React from 'react'

export function PantallaDesactualizada({ recargar = () => window.location.reload() }: { recargar?: () => void }) {
  return (
    <div className="card" role="alert" data-testid="pantalla-desactualizada">
      <p style={{ margin: '0 0 10px' }}>Hay una versión nueva de Renovacell. Actualiza para abrir esta pantalla.</p>
      <button type="button" className="btn sm" onClick={recargar}>Actualizar</button>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPantalla<C extends React.ComponentType<any>>(cargar: () => Promise<C>): React.LazyExoticComponent<C> {
  return React.lazy(async () => {
    try { return { default: await cargar() } }
    catch (e) {
      console.error('[pantalla] no se pudo cargar', e)
      return { default: PantallaDesactualizada as unknown as C }
    }
  })
}
