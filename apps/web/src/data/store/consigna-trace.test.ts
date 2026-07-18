// TRAZABILIDAD COFEPRIS en consignación (regresión).
//
// El lote se descuenta del central al ASIGNAR al vendedor, así que al VENDER no se
// vuelve a tocar el stock. Pero el renglón del pedido DEBE quedar estampado con el
// lote: sin eso, un recall no puede saber qué lote recibió ese cliente — y la venta
// en campo es justo un canal que llega al paciente sin pasar por Almacén.
import { describe, it, expect } from 'vitest'
import { assignToVendor, sellFromConsigna, balanceOf } from './consignaStore'
import { getSnapshotLots } from './lotsStore'

const VENDOR = 'ventas-trace@renovacell.mx'

describe('consignación · trazabilidad lote→cliente', () => {
  it('la venta directa estampa el lote en el renglón del pedido', () => {
    // Toma un producto que tenga lotes con existencia en el inventario de demo.
    const lot = getSnapshotLots().find((l) => l.quantity > 0)
    expect(lot, 'se requiere al menos un lote con existencia').toBeTruthy()
    const productId = lot!.product_id

    const asignado = assignToVendor(VENDOR, productId, 2)
    expect(asignado.ok).toBe(true)

    // Al asignar, el saldo del vendedor debe saber de QUÉ lotes se compone.
    const item = balanceOf(VENDOR).find((x) => x.product_id === productId)
    expect(item?.lots?.length ?? 0).toBeGreaterThan(0)

    const order = sellFromConsigna(VENDOR, [{ product_id: productId, qty: 1, unit_price: 100 }], 100, 'efectivo', 'doc-1')
    expect(order).toBeTruthy()

    // El renglón vendido trae lote → el recall puede identificar al cliente.
    const renglon = order!.items.find((it) => it.product_id === productId)
    expect(renglon?.lot_id, 'el renglón debe traer lot_id para el recall').toBeTruthy()

    // Y el desglose restante del vendedor bajó en la cantidad vendida.
    const despues = balanceOf(VENDOR).find((x) => x.product_id === productId)
    const quedan = (despues?.lots ?? []).reduce((s, l) => s + l.qty, 0)
    expect(quedan).toBe(1)
  })
})