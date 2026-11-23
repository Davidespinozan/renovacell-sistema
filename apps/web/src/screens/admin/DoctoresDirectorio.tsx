// DOCTORES (Admin · Comercial) = MISMA población que Ventas "Clientes" (customers), población
// completa. customers = doctor/comprador comercial (con o sin portal). profiles solo = acceso al
// portal (badge "con/sin portal"). NO es la población maestra: la gestión de portal (verificar/
// invitar) vive aparte y se conectará con la conversión prospecto→customer→portal (fase futura).
import { useState } from 'react'
import { CustomerDirectory } from '../../app/CustomerDirectory'
import { AltaClienteForm, avisoAlta } from '../pos/AltaCliente'   // DIRECCIÓN-ALTA (23 nov 2026, Toño) · ALTA COMPLETA
import { avisar } from '../../app/dialogos'

export function DoctoresDirectorio() {
  const [registrando, setRegistrando] = useState(false)
  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* DIRECCIÓN-ALTA · Dirección también da de alta clientes nuevos (mismo formulario y regla del servidor que Ventas) */}
      <div className="card prospecto-card">
        {registrando
          ? <AltaClienteForm onCancelar={() => setRegistrando(false)} onListo={(p) => { setRegistrando(false); void avisar(avisoAlta(p, 'direccion')) }} />
          : <button type="button" className="btn" onClick={() => setRegistrando(true)} data-testid="direccion-nuevo-cliente">＋ Nuevo cliente</button>}
      </div>
      <CustomerDirectory title="Clientes" scope="all" />
    </div>
  )
}
