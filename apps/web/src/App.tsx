import React from 'react'
import { RoleProvider } from './auth/RoleContext'
import { AppShell } from './app/AppShell'

export default function App() {
  return (
    <RoleProvider>
      <AppShell />
    </RoleProvider>
  )
}
