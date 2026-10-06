import React from 'react'
import { RoleProvider, useRole } from './auth/RoleContext'
import { AppShell } from './app/AppShell'
import { LandingPreview } from './screens/LandingPreview'
import { Login } from './screens/Login'
import { ResetPassword } from './screens/ResetPassword'
import { ReviewPending } from './screens/ReviewPending'
import { ChatCanonico } from './screens/chat/ChatCanonico'

// CC-2 · `/chat` es la única ruta pública de la app (netlify.toml la sirve con index.html):
// funciona sin sesión (visitante) y con sesión (la cuenta adopta y continúa su hilo).
const esRutaChat = typeof window !== 'undefined' && /^\/chat(\/|$)/.test(window.location.pathname)

function Root() {
  const { mode, role, verified } = useRole()

  let view
  if (esRutaChat) view = <ChatCanonico />
  else if (mode === 'landing') view = <LandingPreview />
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
