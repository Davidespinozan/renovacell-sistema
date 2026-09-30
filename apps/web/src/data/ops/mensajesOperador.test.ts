// W2-C ENABLEMENT UX · El operador nunca ve el crudo del servidor.
//
// Estas pruebas se leen contra el FUENTE SQL: enumeran cada `raise exception 'CODIGO: …'`
// de los comandos que el operador puede invocar y exigen que el mapper tenga una
// traducción en español para todos. Si mañana alguien agrega un código nuevo al servidor
// y olvida el mensaje, esta prueba falla — no se descubre con un usuario enfrente.
import { describe, it, expect } from 'vitest'
import { w1Message, w1Code, limpiarDetalle } from './w1Command'
import w1m3 from '../../../../../supabase/migrations/20261012120200_w1_m3_commands.sql?raw'
import w2n3 from '../../../../../supabase/migrations/20261013120200_w2_n3_commands.sql?raw'
import w2cc3 from '../../../../../supabase/migrations/20261014120200_w2c_c3_commands.sql?raw'

// Comandos que una pantalla puede llamar. Los helpers internos (revocados a
// `authenticated`) entran igual, porque los invocan estos comandos y sus errores SÍ
// llegan al operador.
const COMANDOS = [
  'abrir_custodia', 'entregar_custodia', 'devolver_de_custodia', 'registrar_perdida_custodia',
  'cerrar_custodia', 'estado_custodia', 'conciliar_custodia',
  'vender_pos', 'surtir_pedido', 'ajustar_lote', '_w2c_perdida', '_w2c_op_begin',
]

// Códigos que cada función lanza, leídos del fuente.
function codigosDe(src: string, nombres: string[]): Set<string> {
  const out = new Set<string>()
  const re = /^create (?:or replace )?function public\.([a-z_0-9]+)\(/gm
  const marcas: { i: number; name: string }[] = []
  for (let m = re.exec(src); m; m = re.exec(src)) marcas.push({ i: m.index, name: m[1] })
  marcas.forEach(({ i, name }, k) => {
    if (!nombres.includes(name)) return
    const cuerpo = src.slice(i, k + 1 < marcas.length ? marcas[k + 1].i : src.length)
    for (const c of cuerpo.matchAll(/raise exception '([A-Z][A-Z0-9_]{3,})/g)) out.add(c[1])
  })
  return out
}

const alcanzables = new Set<string>([
  ...codigosDe(w1m3, COMANDOS), ...codigosDe(w2n3, COMANDOS), ...codigosDe(w2cc3, COMANDOS),
])

describe('cobertura: todo código alcanzable tiene mensaje en español', () => {
  it('la lista de códigos no está vacía (la lectura del fuente funciona)', () => {
    expect(alcanzables.size).toBeGreaterThan(40)
  })
  it('ninguno cae al crudo del servidor', () => {
    // Sin traducción, w1Message devuelve EXACTAMENTE el detalle del servidor. Con
    // traducción devuelve la frase en español (y, cuando aporta, el detalle entre
    // paréntesis). Así que basta comparar contra el detalle pelón.
    const CRUDO = 'zzqq detalle interno del servidor'
    const sinTraducir = [...alcanzables].filter((c) => w1Message(`${c}: ${CRUDO}`) === CRUDO)
    expect(sinTraducir, `sin traducción: ${sinTraducir.join(', ')}`).toEqual([])
  })
  it('todos los códigos de custodia del checkpoint están cubiertos', () => {
    const pedidos = ['CUSTODIA_EN_PODER', 'DISPONIBILIDAD_INSUFICIENTE', 'CUSTODIA_SALDO_INSUFICIENTE',
      'CUSTODIA_CON_SALDO', 'CUSTODIA_CERRADA', 'INSPECCION_REQUERIDA', 'INSPECCION_INVALIDA',
      'CUSTODIA_INEXISTENTE', 'CUSTODIA_YA_ABIERTA', 'TENEDOR_REQUERIDO', 'TENEDOR_INVALIDO',
      'TENEDOR_INTERNO_REQUIERE_CUENTA', 'CLIENTE_INEXISTENTE', 'USUARIO_INEXISTENTE',
      'EVENTO_REQUIERE_NOMBRE', 'CONSIGNACION_SIN_EVENTO', 'ENTREGA_SIN_RENGLONES',
      'DEVOLUCION_SIN_RENGLONES', 'PERDIDA_SIN_RENGLONES', 'TIPO_INVALIDO']
    const CRUDO = 'zzqq detalle interno'
    pedidos.forEach((c) => {
      expect(alcanzables.has(c), `${c} debería ser alcanzable`).toBe(true)
      expect(w1Message(`${c}: ${CRUDO}`), c).not.toBe(CRUDO)
      // TIPO_INVALIDO es la ÚNICA excepción documentada: su detalle son las opciones
      // válidas y sin él el mensaje no diría cuáles (lo cubre su propio describe).
      if (c !== 'TIPO_INVALIDO') expect(w1Message(`${c}: ${CRUDO}`), c).not.toContain('zzqq')
    })
  })
  it('el detalle anexado nunca trae tokens internos del servidor', () => {
    // El vocabulario interno viene en minúsculas con guion bajo ("correccion_recepcion",
    // "staff"). Lo que ve el operador es español, no el enum de la base.
    ;[...alcanzables].forEach((c) => {
      const m = w1Message(`${c}: usa correccion_recepcion o pending_payment`)
      expect(m, c).not.toContain('correccion_recepcion')
      expect(m, c).not.toContain('pending_payment')
    })
  })
  it('los mensajes están en español y son frases, no códigos', () => {
    ;[...alcanzables].forEach((c) => {
      const m = w1Message(`${c}: detalle`)
      expect(m.length, c).toBeGreaterThan(15)
      expect(m, c).not.toMatch(/[A-Z]{4,}_[A-Z]/)      // sin códigos crudos
      expect(m, c).toMatch(/[a-záéíóúñ]/)              // texto real
    })
  })
})

describe('nada interno llega al operador', () => {
  it('no se filtran identificadores internos (uuid)', () => {
    const m = w1Message('CUSTODIA_EN_PODER: el lote 3f2a8c1d-4b5e-4f6a-8b9c-0d1e2f3a4b5c tiene 7 unidades en custodia; disponibles 3')
    expect(m).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    expect(m).toContain('7')          // la cantidad sí sirve
    expect(m).toContain('custodia')
  })
  it('tampoco cuando el servidor no manda código', () => {
    const m = w1Message('Inventario insuficiente en el lote 3f2a8c1d-4b5e-4f6a-8b9c-0d1e2f3a4b5c')
    expect(m).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    expect(m).toContain('Inventario insuficiente')
  })
  it('no se muestran nombres internos de tablas ni funciones', () => {
    const prohibidos = ['custody_lines', 'custody_operations', 'payment_entries', 'inventory_movements',
      'lots', 'public.', 'select ', 'insert into', 'update ', '_w2c_', 'pg_']
    ;[...alcanzables].forEach((c) => {
      const m = w1Message(`${c}: detalle`).toLowerCase()
      prohibidos.forEach((p) => expect(m, `${c} filtra "${p}"`).not.toContain(p))
    })
  })
  it('limpiarDetalle deja el texto legible al quitar lo interno', () => {
    expect(limpiarDetalle('el lote 3f2a8c1d-4b5e-4f6a-8b9c-0d1e2f3a4b5c no alcanza')).toBe('el lote no alcanza')
    expect(limpiarDetalle('3f2a8c1d-4b5e-4f6a-8b9c-0d1e2f3a4b5c')).toBe('')
    expect(limpiarDetalle('usa merma o correccion_recepcion')).toBe('usa merma o')
    expect(limpiarDetalle('hay una diferencia de 100')).toBe('hay una diferencia de 100')
  })
  it('si al quitar el identificador el detalle no aporta, queda solo el mensaje base', () => {
    const m = w1Message('CUSTODIA_INEXISTENTE: 3f2a8c1d-4b5e-4f6a-8b9c-0d1e2f3a4b5c')
    expect(m).toBe('No se encontró esa custodia. Recarga la pantalla.')
  })
})

describe('TIPO_INVALIDO ya no miente según el contexto', () => {
  it('en una custodia enumera las opciones de custodia', () => {
    expect(w1Message('TIPO_INVALIDO: usa evento o vendedor')).toContain('evento o vendedor')
  })
  it('en una pérdida enumera las opciones de pérdida', () => {
    expect(w1Message('TIPO_INVALIDO: usa faltante, merma o caducado')).toContain('faltante, merma o caducado')
  })
  it('en un reembolso enumera las opciones de reembolso', () => {
    expect(w1Message('TIPO_INVALIDO: usa devolucion, correccion o cortesia')).toContain('devolucion, correccion o cortesia')
  })
  it('el mensaje base no asume ningún contexto', () => {
    expect(w1Message('TIPO_INVALIDO')).toBe('El tipo indicado no es válido para esta operación.')
  })
})

describe('fallback y no-regresión', () => {
  it('un error desconocido conserva un mensaje seguro', () => {
    expect(w1Message('CODIGO_QUE_NO_EXISTE: algo pasó')).toBe('algo pasó')
    expect(w1Message('')).toBe('No se pudo completar la operación.')
    expect(w1Message('boom')).toBe('boom')
  })
  it('w1Code sigue extrayendo el código', () => {
    expect(w1Code('CUSTODIA_CERRADA: esa custodia ya se cerró')).toBe('CUSTODIA_CERRADA')
    expect(w1Code('sin codigo')).toBeUndefined()
  })
  // Los mensajes que ya existían no deben cambiar por este checkpoint.
  it('los mensajes de W1 siguen iguales', () => {
    expect(w1Message('NO_AUTORIZADO: x')).toBe('No tienes permiso para esta operación.')
    expect(w1Message('CADUCADO_NO_RECIBIBLE: x')).toBe('Ese producto ya está caducado: no puede entrar como stock.')
    expect(w1Message('RECEPCION_EXCEDE_PENDIENTE: pendiente 40'))
      .toBe('La cantidad supera lo pendiente de la orden. El excedente se registra aparte con autorización de Dirección. (pendiente 40)')
    expect(w1Message('DEVOLUCION_EXCEDE_SURTIDO: x')).toBe('No se puede devolver más de lo que salió de ese lote en el pedido.')
    expect(w1Message('MERMA_DEBE_SER_NEGATIVA: x')).toBe('Una merma solo da de baja unidades.')
  })
  it('los mensajes de W2 siguen iguales', () => {
    expect(w1Message('PEDIDO_NO_LIBERADO: x'))
      .toBe('Ese pedido no está liberado para surtir: registra el cobro o pide a Dirección que autorice crédito.')
    expect(w1Message('PAGO_SOLO_POR_COMANDO: x'))
      .toBe('El estado de pago no se edita a mano: se registra con un cobro, una verificación o un reembolso.')
    expect(w1Message('YA_VERIFICADO: x'))
      .toBe('Ese pago ya fue verificado: no se puede rechazar. Si el dinero no llegó, Dirección debe reversar el asiento.')
    expect(w1Message('MOTIVO_REQUERIDO: hay una diferencia de 100; explica por qué'))
      .toBe('Escribe el motivo — es obligatorio. (hay una diferencia de 100; explica por qué)')
  })
  it('OP_ID_REUTILIZADO nunca anexa detalle técnico', () => {
    const m = w1Message('OP_ID_REUTILIZADO: ese identificador ya se usó con otros datos 123')
    expect(m).toBe('Esta operación ya se registró con otros datos. Recarga la pantalla para ver el estado real antes de volver a intentar.')
  })
})
