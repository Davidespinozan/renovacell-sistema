import React from 'react'
import { RoleProvider, useRole } from './auth/RoleContext'
import { AppShell } from './app/AppShell'
import { LandingPreview } from './screens/LandingPreview'
import { Login } from './screens/Login'
import { ResetPassword } from './screens/ResetPassword'
import { ReviewPending } from './screens/ReviewPending'

function Root() {
  const { mode, role, verified } = useRole()

  let view
  if (mode === 'landing') view = <LandingPreview />
  else if (mode === 'reset') view = <ResetPassword />
  else if (mode === 'login') view = <Login />
  // Gate: doctor no verificado no entra al portal.
  else if (role === 'doctor' && !verified) view = <ReviewPending />
  else view = <AppShell />

  return (
    <div className="dev-root">
      <div className="dev-view">{view}</div>
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
