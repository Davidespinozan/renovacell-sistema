// UX · piezas en el carrito del doctor, para el contador de la pestaña "Carrito" de la barra de abajo. Lo publica el
// carrito canónico (useCarritoCanonico) cada vez que cambia; quien lo lee no hace llamadas propias.
import { useSyncExternalStore } from 'react'
let piezas = 0
const subs = new Set<() => void>()
export const publicarPiezas = (n: number) => { if (n !== piezas) { piezas = n; subs.forEach((s) => s()) } }
export const usePiezasCarrito = () => useSyncExternalStore((s) => { subs.add(s); return () => { subs.delete(s) } }, () => piezas, () => piezas)
