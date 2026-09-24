// CLIENTES (Ventas) = MISMA población comercial que Admin "Doctores" (customers). El vendedor
// consulta TODO el directorio por defecto ("Todos") y puede filtrar a "Mi cartera" (por seller_name).
// Read-only para pos (sin update/delete/reasignación). La lógica vive en CustomerDirectory (compartida).
// DEUDA TÉCNICA: "Mi cartera" usa seller_name (matching por nombre, frágil). El ownership futuro
// debería basarse en un id estable de vendedor (seller/profile id), no en comparación de nombres.
import { CustomerDirectory } from '../app/CustomerDirectory'

export function Clientes() {
  return <CustomerDirectory title="Clientes" scope="all" carteraToggle />
}
