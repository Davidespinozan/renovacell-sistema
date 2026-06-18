import React from 'react'
import { RoleProvider, useRole } from './auth/RoleContext'
import { AppShell } from './app/AppShell'
import { DevBar } from './app/DevBar'
import { LandingPreview } from './screens/LandingPreview'

function Root() {
  const { mode } = useRole()
  return (
    <div className="dev-root">
      <DevBar />
      <div className="dev-view">
        {mode === 'landing' ? <LandingPreview /> : <AppShell />}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <RoleProvider>
      <Root />
    </RoleProvider>
  )
}
