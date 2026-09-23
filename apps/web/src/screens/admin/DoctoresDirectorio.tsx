// DOCTORES (Admin · Comercial) = MISMA población que Ventas "Clientes" (customers), población
// completa. customers = doctor/comprador comercial (con o sin portal). profiles solo = acceso al
// portal (badge "con/sin portal"). NO es la población maestra: la gestión de portal (verificar/
// invitar) vive aparte y se conectará con la conversión prospecto→customer→portal (fase futura).
import { CustomerDirectory } from '../../app/CustomerDirectory'

export function DoctoresDirectorio() {
  return <CustomerDirectory title="Doctores" scope="all" />
}
