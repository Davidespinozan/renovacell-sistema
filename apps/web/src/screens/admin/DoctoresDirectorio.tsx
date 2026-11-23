// DOCTORES (Admin · Comercial) = MISMA población que Ventas "Clientes" (customers), población
// completa. customers = doctor/comprador comercial (con o sin portal). profiles solo = acceso al
// portal (badge "con/sin portal"). NO es la población maestra: la gestión de portal (verificar/
// invitar) vive aparte y se conectará con la conversión prospecto→customer→portal (fase futura).
import { useState } from 'react'
import { CustomerDirectory } from '../../app/CustomerDirectory'
import { NuevoProspectoForm, type ProspectoCreado } from '../pos/NuevoProspecto'   // DIRECCIÓN-ALTA (23 nov 2026, Toño)
import { avisar } from '../../app/dialogos'

// Dirección registra al cliente SIN vendedora (el servidor solo asigna cuando la registra una vendedora).
export const avisoAltaDireccion = (p: ProspectoCreado): string =>
  p.status === 'creado' ? `${p.nombre} quedó registrado como cliente, sin vendedora asignada. Si quieres, asígnasela desde su ficha.`
    : `${p.nombre} ya estaba registrado (mismo celular). Búscalo en la lista.`

export function DoctoresDirectorio() {
  const [registrando, setRegistrando] = useState(false)
  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* DIRECCIÓN-ALTA · Dirección también da de alta clientes nuevos (mismo formulario y regla del servidor que Ventas) */}
      <div className="card prospecto-card">
        {registrando
          ? <NuevoProspectoForm onCancelar={() => setRegistrando(false)} onListo={(p) => { setRegistrando(false); void avisar(avisoAltaDireccion(p)) }} />
          : <button type="button" className="btn" onClick={() => setRegistrando(true)} data-testid="direccion-nuevo-cliente">＋ Nuevo cliente</button>}
      </div>
      <CustomerDirectory title="Clientes" scope="all" />
    </div>
  )
}
