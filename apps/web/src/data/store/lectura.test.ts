// W4-02 · LECTURA ACOTADA — ninguna lista se trunca en silencio.
//
// Lo que se protege: PostgREST corta en 1,000 filas sin avisar. Aquí se prueba que la
// lectura recorre todas las páginas sin repetir ni saltarse filas, que el tope se
// anuncia, y que una lectura fallida nunca se presenta como "no hay nada".
import { describe, it, expect, beforeEach } from 'vitest'
import { leerTodo, PAGINA, TOPE } from './lectura'
import { getFallosSnapshot, limpiarFallos } from './escritura'

beforeEach(limpiarFallos)

// Servidor de mentira con N filas y orden estable; registra los rangos que se le piden.
function servidor(total: number, fallarEnPagina?: number) {
  const pedidos: [number, number][] = []
  const filas = Array.from({ length: total }, (_, i) => ({ id: i }))
  const pagina = (desde: number, hasta: number) => {
    pedidos.push([desde, hasta])
    if (fallarEnPagina != null && pedidos.length === fallarEnPagina) {
      return Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } })
    }
    return Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null })
  }
  return { pagina, pedidos }
}

describe('leerTodo recorre todas las páginas', () => {
  it('primera página: menos de 1,000 filas → una sola petición y todo completo', async () => {
    const s = servidor(347)
    const r = await leerTodo('los pedidos', s.pagina)
    expect(r.data).toHaveLength(347)
    expect(s.pedidos).toEqual([[0, PAGINA - 1]])
    expect(r.truncada).toBe(false)
    expect(r.error).toBeNull()
  })

  it('2,570 filas (el tamaño real de clientes) → 3 páginas y NINGUNA fila perdida', async () => {
    const s = servidor(2570)
    const r = await leerTodo('los clientes', s.pagina)
    expect(r.data).toHaveLength(2570)
    expect(s.pedidos).toHaveLength(3)
  })

  it('las páginas son contiguas: sin traslapes ni huecos entre una y la siguiente', async () => {
    const s = servidor(3500)
    await leerTodo('los movimientos', s.pagina)
    expect(s.pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999]])
  })

  it('sin filas duplicadas ni faltantes entre páginas', async () => {
    const s = servidor(2999)
    const r = await leerTodo('los cobros', s.pagina)
    const ids = r.data.map((x) => x.id)
    expect(new Set(ids).size).toBe(2999)
    expect(ids[0]).toBe(0)
    expect(ids[2998]).toBe(2998)
  })

  it('exactamente 1,000 filas: pide una página más para SABER que ya no hay otras', async () => {
    const s = servidor(1000)
    const r = await leerTodo('los envíos', s.pagina)
    expect(r.data).toHaveLength(1000)
    expect(s.pedidos).toHaveLength(2)
    expect(r.truncada).toBe(false)
  })

  it('lista vacía → cero filas, sin aviso: vacío de verdad no es un problema', async () => {
    const r = await leerTodo('los reembolsos', servidor(0).pagina)
    expect(r.data).toEqual([])
    expect(r.error).toBeNull()
    expect(getFallosSnapshot()).toHaveLength(0)
  })
})

describe('el tope se anuncia, no se esconde', () => {
  it('al llegar al tope se dice cuántos se cargaron', async () => {
    const r = await leerTodo('los pedidos', servidor(5000).pagina, { tope: 3000 })
    expect(r.data).toHaveLength(3000)
    expect(r.truncada).toBe(true)
    const f = getFallosSnapshot()
    expect(f).toHaveLength(1)
    expect(f[0].que).toBe('mostrar todo el historial de los pedidos')
    expect(f[0].error).toMatch(/3,000 registros, los más recientes/)
  })

  it('el aviso de volumen se retira solo cuando la lista vuelve a caber', async () => {
    await leerTodo('los pedidos', servidor(5000).pagina, { tope: 3000 })
    expect(getFallosSnapshot()).toHaveLength(1)
    await leerTodo('los pedidos', servidor(120).pagina, { tope: 3000 })
    expect(getFallosSnapshot()).toHaveLength(0)
  })

  it('el tope por omisión es explícito y finito', () => {
    expect(TOPE).toBe(20_000)
    expect(PAGINA).toBe(1000)
  })
})

describe('una lectura que falla no se disfraza de lista vacía', () => {
  it('error → se devuelve el error y se avisa en pantalla', async () => {
    const r = await leerTodo('los pedidos', servidor(100, 1).pagina)
    expect(r.error).not.toBeNull()
    const f = getFallosSnapshot()
    expect(f[0].que).toBe('cargar los pedidos')
    expect(f[0].error).toMatch(/puede estar desactualizado/)
    // Sin texto crudo del servidor.
    expect(f[0].error).not.toMatch(/statement|timeout|canceling/)
  })

  it('falla a media lectura → error, no "aquí están todas"', async () => {
    const r = await leerTodo('los movimientos', servidor(2500, 2).pagina)
    expect(r.error).not.toBeNull()
    expect(r.truncada).toBe(false)
  })

  it('el mismo aviso NO se apila en cada recarga', async () => {
    for (let i = 0; i < 4; i++) await leerTodo('los pedidos', servidor(100, 1).pagina)
    expect(getFallosSnapshot().filter((x) => x.que === 'cargar los pedidos')).toHaveLength(1)
  })

  it('cuando la lectura vuelve a funcionar, el aviso desaparece solo', async () => {
    await leerTodo('los pedidos', servidor(100, 1).pagina)
    expect(getFallosSnapshot()).toHaveLength(1)
    await leerTodo('los pedidos', servidor(100).pagina)
    expect(getFallosSnapshot()).toHaveLength(0)
  })

  it('una excepción de red tampoco revienta: se reporta', async () => {
    const r = await leerTodo('los lotes', () => Promise.reject(new Error('Failed to fetch')))
    expect(r.error).not.toBeNull()
    expect(getFallosSnapshot()).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GUARDA: las tablas que crecen sin límite solo se leen acotadas.
// ─────────────────────────────────────────────────────────────────────────────
const fuentes = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!../database.types.ts'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const TODO = Object.values(fuentes).join('\n')

// Tablas transaccionales: crecen con cada operación del negocio.
const CRECEN = ['orders', 'inventory_movements', 'lots', 'payment_entries', 'payment_claims', 'v_order_money',
  'shipments', 'custodies', 'custody_lines', 'v_custody_stock', 'v_stock_disponible', 'refunds',
  'stock_returns', 'expenses', 'replenishments', 'cash_closings', 'prospects', 'product_stock', 'product_prices']

describe('guarda: las tablas que crecen se leen acotadas', () => {
  for (const t of CRECEN) {
    it(`${t}: ninguna lectura completa sin paginar, limitar o filtrar`, () => {
      const re = new RegExp(`from\\('${t}'\\)\\s*\\n?\\s*\\.select\\(`, 'g')
      for (const m of TODO.matchAll(re)) {
        const antes = TODO.slice(Math.max(0, (m.index ?? 0) - 160), m.index)
        const despues = TODO.slice(m.index ?? 0, (m.index ?? 0) + 700)
        const sentencia = despues.split(/\n\s*if \(|\n\s*\n/)[0]
        const acotada = /leerTodo[<(]/.test(antes) || /\.(range|limit|maybeSingle|single|eq|in|is|gte|lte)\(/.test(sentencia)
        expect(acotada, `lectura sin acotar de ${t}: ${sentencia.slice(0, 90)}`).toBe(true)
      }
    })
  }

  it('toda lectura paginada lleva una llave de desempate antes del rango', () => {
    const llamadas = [...TODO.matchAll(/leerTodo[<(][\s\S]{0,900}?\.range\(/g)].map((m) => m[0])
    expect(llamadas.length).toBeGreaterThanOrEqual(18)
    for (const c of llamadas) {
      // Lo último antes de .range( debe ser un .order( — la llave única de desempate.
      expect(c, c.slice(0, 80)).toMatch(/\.order\('[a-z_]+'\)\s*\.range\($/)
    }
  })

  it('el chat pide los mensajes MÁS RECIENTES, no los más viejos', () => {
    const chat = fuentes['./chatStore.ts']
    const i = chat.indexOf("from('messages').select(")
    const q = chat.slice(i, i + 320)
    expect(q).toMatch(/ascending: false/)
    expect(q).toMatch(/\.limit\(MENSAJES_RECIENTES\)/)
  })
})
