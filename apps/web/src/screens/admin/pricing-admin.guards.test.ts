// Guards de la herramienta de PRECIOS: 3 conceptos separados, canales muestran volumen,
// auditoría y seguridad (server autoridad). El cálculo se prueba en volumePricing.test.ts.
import { describe, it, expect } from 'vitest'
import preciosSrc from './Precios.tsx?raw'
import productsStoreSrc from '../../data/store/productsStore.ts?raw'
import volumeStoreSrc from '../../data/store/volumePricesStore.ts?raw'
import catalogoSrc from '../doctor/Catalogo.tsx?raw'
import cajaSrc from '../pos/Caja.tsx?raw'
import nuevoPedidoSrc from '../sales/NuevoPedido.tsx?raw'
import volumeEngineSrc from '../../../../../supabase/migrations/20261002120000_volume_pricing_engine.sql?raw'

describe('Admin Precios — 3 conceptos separados', () => {
  it('tiene tabs General | Mayoreo | Descuentos por cantidad', () => {
    expect(preciosSrc).toMatch(/'general'/); expect(preciosSrc).toMatch(/'mayoreo'/); expect(preciosSrc).toMatch(/'volumen'/)
    expect(preciosSrc).toMatch(/Descuentos por cantidad/)
  })
  it('General edita products.price vía setBasePrice; excluye no-vendibles/parents (isSellableSku)', () => {
    expect(preciosSrc).toMatch(/setBasePrice/)
    expect(preciosSrc).toMatch(/isSellableSku/)
    expect(preciosSrc).toMatch(/sellable !== false/)
  })
  it('Mayoreo se explica como tarifa por cliente y NO como promoción por cantidad', () => {
    expect(preciosSrc).toMatch(/tarifa contractual por cliente/)
    expect(preciosSrc).toMatch(/no una promoci/)
  })
  it('Descuentos por cantidad usa el store de volumen (no recrea la lógica de precio)', () => {
    expect(preciosSrc).toMatch(/useVolumePrices/)
  })
})

describe('Seguridad / precio general', () => {
  it('setBasePrice valida vendible y precio>0, y audita valor anterior→nuevo', () => {
    expect(productsStoreSrc).toMatch(/sellable === false/)
    expect(productsStoreSrc).toMatch(/price > 0/)
    expect(productsStoreSrc).toMatch(/Precio general actualizado/)
  })
  it('las mutaciones de volumen se auditan y validan', () => {
    expect(volumeStoreSrc).toMatch(/logAudit/)
    expect(volumeStoreSrc).toMatch(/validateVolumeRule/)
    expect(volumeStoreSrc).toMatch(/Regla de volumen creada/)
  })
})

describe('Consistencia omnicanal — todos previsualizan volumen con el helper compartido', () => {
  it('Portal Doctor (Catalogo) muestra promo y precio por cantidad', () => {
    expect(catalogoSrc).toMatch(/effectiveUnitPrice/)
    expect(catalogoSrc).toMatch(/volumePromoLabel/)
  })
  it('POS (Caja) previsualiza volumen', () => {
    expect(cajaSrc).toMatch(/effectiveUnitPrice/)
    expect(cajaSrc).toMatch(/volumePromoLabel/)
  })
  it('Nuevo Pedido previsualiza volumen', () => {
    expect(nuevoPedidoSrc).toMatch(/effectiveUnitPrice/)
  })
})

describe('Autoridad del servidor + precedencia', () => {
  it('precio_de sigue siendo LEAST(base, volumen) en el backend', () => {
    expect(volumeEngineSrc).toMatch(/least\(b\.base, v\.vol\)/)
  })
  it('el helper de UI documenta que el servidor es la autoridad', () => {
    expect(catalogoSrc).toMatch(/autoridad|servidor/)
  })
})
