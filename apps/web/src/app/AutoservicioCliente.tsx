// C360-F3 · Autoservicio del doctor (Mi perfil): sus teléfonos y perfiles fiscales (0..N), con los mismos
// comandos del servidor que usa Dirección. El servidor deriva el cliente del JWT (p_customer = null) y
// solo permite lo propio. Los domicilios siguen en "Ubicaciones de entrega" (mismos comandos).
import React from 'react'
import { useCustomer360 } from '../data/hooks/useCustomer360'
import { cliente360 as clientePorDefecto, type ClienteC360 } from '../data/ops/customer360'
import { TelefonosEditor, PerfilesFiscalesEditor } from './Cliente360Editores'

const titulo: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }

export function AutoservicioCliente({ cliente = clientePorDefecto }: { cliente?: ClienteC360 }) {
  const { data, error, recargar } = useCustomer360(null, cliente)
  if (error) return <div style={{ marginTop: 18, fontSize: 12.5, color: 'var(--ink-3)' }}>Tus teléfonos y datos fiscales estarán disponibles cuando Renovacell complete tu expediente de cliente.</div>
  if (!data) return null
  return (
    <>
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }} data-testid="autoservicio-telefonos">
        <div style={titulo}>Teléfonos</div>
        <TelefonosEditor customerId={null} telefonos={data.contacto.telefonos} editable={data.permisos.telefonos} cliente={cliente} onCambio={recargar} />
      </div>
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }} data-testid="autoservicio-fiscal">
        <div style={titulo}>Datos fiscales (para tus facturas CFDI)</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', margin: '4px 0 8px' }}>Puedes tener varios (por ejemplo, persona física y tu clínica). Al pedir factura eliges cuál usar; cambiarlos después no modifica pedidos ya hechos.</div>
        <PerfilesFiscalesEditor customerId={null} perfiles={data.facturacion} editable={data.permisos.fiscal} cliente={cliente} onCambio={recargar} />
      </div>
    </>
  )
}
