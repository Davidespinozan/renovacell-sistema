// Shell: arma el layout (sidebar + main) y monta la pantalla activa.
import React, { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { BottomNav } from './BottomNav'
import { useRole } from '../auth/RoleContext'
import { renderScreen } from '../screens/registry'
import { FallosEscritura } from './FallosEscritura'
import { ChatFlotante } from './ChatFlotante'
import { AlertaComercial } from './AlertaComercial'
import { AvisoVerificacion } from '../screens/doctor/AvisoVerificacion'
import { VersionNueva } from './VersionNueva'

export const tituloPestana = (role: string | null | undefined): string =>
  role && role !== 'doctor' ? 'Renovacell · Sistema operativo' : 'Renovacell · Tecnologías Antiedad'

export function AppShell() {
  const { role, screen, verified } = useRole()
  const [drawer, setDrawer] = useState(false)

  // La pestaña: "Sistema operativo" es solo del equipo (ERP); el doctor ve la marca del negocio (decisión del dueño).
  useEffect(() => { document.title = tituloPestana(role) }, [role])

  // Drawer móvil: el CSS del demo usa body.drawer-open.
  useEffect(() => {
    document.body.classList.toggle('drawer-open', drawer)
    return () => document.body.classList.remove('drawer-open')
  }, [drawer])

  // Cerrar el drawer al cambiar de rol o pantalla.
  useEffect(() => setDrawer(false), [role, screen])

  return (
    <div className="app">
      <Sidebar onNavigate={() => setDrawer(false)} />
      <div className="main" data-area={role}>
        <TopBar onMenu={() => setDrawer(true)} />
        <main className="canvas">
          {/* Fuera de #content: no se desmonta al cambiar de pantalla. */}
          <FallosEscritura />
          {/* Versión publicada nueva: aviso discreto para actualizar (nunca recarga sola). */}
          {!import.meta.env.DEV && <VersionNueva />}
          <div id="content" key={`${role}:${screen}`}>
            {role === 'doctor' && !verified && <AvisoVerificacion />}
            {renderScreen(role, screen)}
          </div>
        </main>
      </div>
      {/* UX-1 · un solo lanzador de conversación para el doctor; fuera de #content para que sobreviva al cambio de pantalla. */}
      <ChatFlotante />
      {/* CHV2-B · alerta comercial en vivo del staff (vendedor con conversaciones / Dirección); fuera de #content. */}
      <AlertaComercial />
      <div id="drawerOverlay" onClick={() => setDrawer(false)} />
      <BottomNav onMenu={() => setDrawer(true)} />
    </div>
  )
}
