// CLIENTES (Ventas · "Mi cartera") = MISMA población comercial que Admin "Doctores" (customers),
// filtrada a la cartera del vendedor por seller_name. Es la etiqueta de VENTAS del doctor comercial;
// no una tercera categoría. La lógica vive en CustomerDirectory (compartida).
import { CustomerDirectory } from '../app/CustomerDirectory'

export function Clientes() {
  return <CustomerDirectory title="Clientes" scope="cartera" />
}
