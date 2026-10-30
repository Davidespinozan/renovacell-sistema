// CLIENTES (Ventas) = MISMA población comercial que Admin "Doctores" (customers). El vendedor
// consulta TODO el directorio por defecto ("Todos") y puede filtrar a "Mi cartera" (por seller_name).
// Read-only para pos (sin update/delete/reasignación). La lógica vive en CustomerDirectory (compartida).
// DEUDA TÉCNICA: "Mi cartera" usa seller_name (matching por nombre, frágil). El ownership futuro
// debería basarse en un id estable de vendedor (seller/profile id), no en comparación de nombres.
import { CustomerDirectory } from '../app/CustomerDirectory'
import { PorVerificar } from './PorVerificar'   // AVISO-VERIF · los que mandaron su verificación
import { ClasificarCartera } from './ClasificarCartera'   // HERRAMIENTAS DEL VENDEDOR · doctor/clínica y especialidad

export function Clientes() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <PorVerificar />
      <ClasificarCartera />
      <CustomerDirectory title="Clientes" scope="all" carteraToggle />
    </div>
  )
}
