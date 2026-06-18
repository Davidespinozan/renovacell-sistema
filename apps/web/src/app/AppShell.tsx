// Shell: arma el layout (sidebar + main) y monta la pantalla activa.
import React, { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { BottomNav } from './BottomNav'
import { useRole } from '../auth/RoleContext'
import { renderScreen } from '../screens/registry'

export function AppShell() {
  const { role, screen } = useRole()
  const [drawer, setDrawer] = useState(false)

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
      <div className="main">
        <TopBar onMenu={() => setDrawer(true)} />
        <div className="canvas">
          <div id="content" key={`${role}:${screen}`}>
            {renderScreen(role, screen)}
          </div>
        </div>
      </div>
      <div id="drawerOverlay" onClick={() => setDrawer(false)} />
      <BottomNav />
    </div>
  )
}
