// Helper de render para tests de componentes que necesitan el contexto de sesión.
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { RoleProvider } from '../auth/RoleContext'

export const renderWithRole = (ui: ReactElement) => render(<RoleProvider>{ui}</RoleProvider>)
