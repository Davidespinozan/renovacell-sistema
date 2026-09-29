// W1: con backend, el inventario en CUSTODIA (eventos y consignación) queda DESHABILITADO
// hasta W2 — su orquestación vive en el cliente (asignar, vender, regresar) y no cumple las
// reglas de W1 (comando del servidor + idempotencia + kardex con referencia de negocio).
// En modo demo (sin backend) siguen funcionando para mostrar el flujo.
import { hasSupabase } from '../../lib/supabase'

export const CUSTODY_INVENTORY_DISABLED: boolean = hasSupabase
export const CUSTODY_DISABLED_MSG =
  'Inventario de eventos y consignación deshabilitado temporalmente (se habilita en la siguiente fase). Vende desde Punto de venta de mostrador.'
