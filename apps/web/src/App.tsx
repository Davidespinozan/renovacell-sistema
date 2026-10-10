import React, { useEffect } from 'react'
import { RoleProvider, useRole } from './auth/RoleContext'
import { AppShell } from './app/AppShell'
import { LandingPreview } from './screens/LandingPreview'
import { Login } from './screens/Login'
import { ResetPassword } from './screens/ResetPassword'
import { ReviewPending } from './screens/ReviewPending'

// `/chat` YA NO es una ruta pública (decisión del dueño, 10 oct 2026): la conversación con Renovacell
// —y con un asesor humano— existe DENTRO del sistema, una vez que el doctor envió su verificación y tiene
// acceso. La URL se conserva (netlify.toml la sirve con index.html) para no romper enlaces viejos, pero pasa
// por las mismas puertas que el resto: sin sesión → login; doctor sin verificar → verificación; con acceso →
// el portal, que abre al doctor en su conversación.
const esRutaChat = typeof window !== 'undefined' && /^\/chat(\/|$)/.test(window.location.pathname)
// Vista previa visual del chat, SOLO en desarrollo (no existe en producción).
const esPreviewChat = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'chat'
const ChatPreview = import.meta.env.DEV ? React.lazy(() => import('./dev/ChatPreview').then((m) => ({ default: m.ChatPreview }))) : null
// CHV2-B · Vista previa visual de Inicio / alerta / Conversaciones / Atención comercial, SOLO en desarrollo.
const esPreviewHome = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'home'
const HomePreview = import.meta.env.DEV ? React.lazy(() => import('./dev/HomePreview').then((m) => ({ default: m.HomePreview }))) : null

function Root() {
  const { mode, role, verified, setScreen } = useRole()
  const conAcceso = mode === 'app' && !(role === 'doctor' && !verified)
  // Quien llega por un enlace viejo a /chat y sí tiene acceso cae directo en su conversación del portal.
  useEffect(() => {
    if (esRutaChat && conAcceso && role === 'doctor') setScreen('chat_cc')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conAcceso, role])

  let view
  if (esPreviewChat && ChatPreview) view = <React.Suspense fallback={null}><ChatPreview /></React.Suspense>
  else if (esPreviewHome && HomePreview) view = <React.Suspense fallback={null}><HomePreview /></React.Suspense>
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
