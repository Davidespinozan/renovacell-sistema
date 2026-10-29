// Las pantallas de trabajo leen de stores que solo se recargaban al iniciar sesión, al renovar el token (~1 h) o tras
// una acción propia. Resultado (auditoría 28 oct): llega "Pago confirmado · listo para surtir" y el pedido no aparece en
// Preparar pedidos hasta F5; el doctor reporta su pago y su tarjeta sigue diciendo "pendiente". Aquí se recarga la
// verdad del servidor cuando (a) llega un aviso en vivo y (b) la persona regresa a la pestaña / app.
import { hasSupabase } from '../../lib/supabase'
import { alLlegarAviso } from './notificationsStore'
import { reloadOrders } from './ordersStore'
import { reloadMoney } from './moneyStore'
import { reloadShipments } from './shipmentsStore'
import { reloadInventory } from './lotsStore'

const ESPERA_MS = 1200          // varios avisos seguidos → una sola recarga
const MIN_ENTRE_VISIBLE_MS = 30_000

let timer: ReturnType<typeof setTimeout> | null = null
let ultimaVisible = 0

export function refrescarDatos(): void {
  if (!hasSupabase) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    reloadOrders()
    void reloadMoney()
    reloadShipments()
    reloadInventory()
  }, ESPERA_MS)
}

let instalado = false
/** Se llama una vez desde el shell de la app. */
export function instalarRefresco(): void {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  alLlegarAviso(() => refrescarDatos())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    const ahora = Date.now()
    if (ahora - ultimaVisible < MIN_ENTRE_VISIBLE_MS) return
    ultimaVisible = ahora
    refrescarDatos()
  })
}
