// @vitest-environment jsdom
// UX-2 · "Compras a proveedores": Dirección compra y marca pagado; Almacén solo ve las compras y recibe.
import React, { useEffect } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { RoleProvider, useRole } from '../../auth/RoleContext'
import type { RoleKey } from '../../app/roles'
import { Reabastecimiento } from './Reabastecimiento'
import { createReplenishment } from '../../data/store/comprasStore'

afterEach(cleanup)

function Como({ rol, children }: { rol: RoleKey; children: React.ReactNode }) {
  const { setRole, role } = useRole()
  useEffect(() => { setRole(rol) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  return role === rol ? <>{children}</> : null
}

describe('<Reabastecimiento> · Compras a proveedores', () => {
  it('Dirección: título, columnas Recibido/Pendiente y acciones de compra y pago', async () => {
    const r = await createReplenishment({ product_id: 'dom-1', product_name: 'Prod DOM', qty: 12, unit_cost: 4, kind: 'compra', supplier: 'Prov DOM' }, 'op-dom-1')
    if (!r.ok) throw new Error('alta falló')
    render(<RoleProvider><Como rol="admin"><Reabastecimiento /></Como></RoleProvider>)
    expect(await screen.findByText('Compras a proveedores')).toBeTruthy()
    expect(screen.getByText('Pendiente')).toBeTruthy(); expect(screen.getByText('Recibido')).toBeTruthy()
    expect(screen.getAllByText('Pendiente de recibir').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('btn-pagado').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Recibir mercancía/ }).length).toBeGreaterThan(0)
  })
  it('18 · Almacén no ve "Marcar pagado" ni "Comprar a proveedor"; sí puede recibir', async () => {
    render(<RoleProvider><Como rol="warehouse"><Reabastecimiento /></Como></RoleProvider>)
    expect(await screen.findByText('Compras a proveedores')).toBeTruthy()
    expect(screen.queryByTestId('btn-pagado')).toBeNull()
    expect(screen.queryByTestId('btn-comprar')).toBeNull()
    expect(screen.getAllByRole('button', { name: /Recibir mercancía/ }).length).toBeGreaterThan(0)
  })
})
