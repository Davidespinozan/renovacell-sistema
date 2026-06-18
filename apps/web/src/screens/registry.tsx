// Registro de pantallas: mapea pantalla -> componente.
// La vista común ('comun') pertenece al add-on Comunicación interna; solo se
// renderiza si el flag está activo. El resto son módulos por rol (hoy Placeholder).
import React from 'react'
import { Placeholder } from './Placeholder'
import { CommonView } from './CommonView'
import { Catalogo } from './doctor/Catalogo'
import { MisPedidos } from './doctor/MisPedidos'
import { Historial } from './doctor/Historial'
import { Existencias } from './warehouse/Existencias'
import { Surtido } from './warehouse/Surtido'
import { Caducidades } from './warehouse/Caducidades'
import { Entradas } from './warehouse/Entradas'
import { Cola } from './packing/Cola'
import { Guias } from './packing/Guias'
import { Recibo } from './packing/Recibo'
import { COMMON_SCREEN, type RoleKey } from '../app/roles'
import { FEATURES } from '../app/config'
import { Icon } from '../app/icons'

// Pantallas reales ya construidas (por key de pantalla).
const SCREENS: Record<string, () => React.ReactNode> = {
  catalogo: () => <Catalogo />,
  pedidosdr: () => <MisPedidos />,
  hist: () => <Historial />,
  // 'asist' (Asistente IA) sigue en Placeholder por ahora.
  stock: () => <Existencias />,
  surtido: () => <Surtido />,
  caduc: () => <Caducidades />,
  entradas: () => <Entradas />,
  cola: () => <Cola />,
  guia: () => <Guias />,
  recibo: () => <Recibo />,
}

export function renderScreen(role: RoleKey, screen: string): React.ReactNode {
  if (screen === COMMON_SCREEN.key) {
    if (FEATURES.comunicacionInterna) return <CommonView />
    return <AddOnInactive title="Vista común" addon="Comunicación interna" />
  }
  const real = SCREENS[screen]
  if (real) return real()
  return <Placeholder role={role} screen={screen} />
}

function AddOnInactive({ title, addon }: { title: string; addon: string }) {
  return (
    <div className="grid">
      <div className="eyebrow">Add-on no activo</div>
      <div className="card">
        <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
          <Icon name="shield" />
          <span>
            <b>{title}</b> es parte del módulo <b>{addon}</b>, que no está contratado en este
            entorno. Actívalo en <code>config.ts</code> (FEATURES) para verlo.
          </span>
        </div>
      </div>
    </div>
  )
}
