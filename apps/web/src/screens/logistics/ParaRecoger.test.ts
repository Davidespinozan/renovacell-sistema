// PARA RECOGER · solo los pedidos ya despachados como «recoge en sucursal», sin envío de paquetería ni chofer.
import { describe, it, expect } from 'vitest'
import { paraRecoger } from './ParaRecoger'
import type { OrderWithItems } from '../../data/hooks/useOrders'

const o = (id: string, status: string, method: string | null) => ({ id, status, shipping_meta: method ? { method } : {}, items: [] }) as unknown as OrderWithItems

describe('paraRecoger', () => {
  it('muestra los recoge despachados y deja fuera lo demás', () => {
    const lista = [o('a', 'shipped', 'recoge'), o('b', 'packed', 'recoge'), o('c', 'shipped', 'chofer'), o('d', 'delivered', 'recoge'), o('e', 'shipped', 'recoge')]
    expect(paraRecoger(lista, (id) => id === 'e').map((x) => x.id)).toEqual(['a'])
  })
})
