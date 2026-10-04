// W4-01 · ESCRITURA CONFIRMADA — la primitiva y la guarda que la protege.
//
// Lo que se protege: que ningún store vuelva a mostrar un éxito que el servidor no
// confirmó, y que un corte de red nunca se convierta ni en "éxito" ni en "rechazo".
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  confirmar, trasEscribir, mensajeDeError, reportarFallo, descartarFallo, limpiarFallos,
  getFallosSnapshot, DESCONOCIDO_MSG, REINTENTO_SEGURO_MSG,
} from './escritura'

const ok = () => Promise.resolve({ error: null })
const falla = (message: string, code?: string) => Promise.resolve({ error: { message, code } })

beforeEach(limpiarFallos)

describe('confirmar() dice la verdad sobre el servidor', () => {
  it('éxito → ok, y no deja ningún aviso', async () => {
    expect(await confirmar('guardar', ok())).toEqual({ ok: true })
    expect(getFallosSnapshot()).toHaveLength(0)
  })

  it('RECHAZO de negocio → no ok, no ambiguo, con el motivo en lenguaje de operador', async () => {
    const r = await confirmar('surtir el pedido', falla('NO_AUTORIZADO: solo Almacén surte', 'P0001'))
    expect(r).toEqual({ ok: false, error: 'No tienes permiso para esta operación.', ambiguous: false })
  })

  it('RECHAZO crudo de Postgres → se traduce, nunca se muestra tal cual', async () => {
    for (const [crudo, esperado] of [
      ['new row violates row-level security policy for table "orders"', 'No tienes permiso para esta operación.'],
      ['duplicate key value violates unique constraint "products_sku_key"', 'Ya existe un registro con esos datos.'],
      ['update or delete on table "products" violates foreign key constraint "x"', 'No se puede: hay otros registros que dependen de éste.'],
      ['null value in column "name" violates not-null constraint', 'Falta un dato obligatorio.'],
    ] as const) {
      const r = await confirmar('guardar', falla(crudo, '23505'))
      expect(r.ok).toBe(false)
      if (!r.ok) { expect(r.error).toBe(esperado); expect(r.error).not.toMatch(/violates|constraint|relation|column/) }
    }
  })

  it('una restricción que sabemos leer manda sobre la traducción genérica', async () => {
    const r = await confirmar('guardar', falla('new row for relation "product_fiscal" violates check constraint "ck_pf_tasa"', '23514'))
    if (!r.ok) expect(r.error).toMatch(/La tasa no corresponde al tratamiento/)
  })

  it('un error que no reconocemos NO filtra texto del servidor en una escritura directa', async () => {
    const r = await confirmar('guardar', falla('ERROR: relation "pg_internal_thing" does not exist at character 15', 'XX000'))
    if (!r.ok) expect(r.error).toBe('No se pudo guardar el cambio.')
  })
})

describe('DESCONOCIDO ≠ rechazado: un corte de red no es un "no"', () => {
  it('la promesa revienta → ambiguo, y se pide VERIFICAR antes de repetir', async () => {
    const r = await confirmar('marcar como enviado', Promise.reject(new Error('Failed to fetch')))
    expect(r).toEqual({ ok: false, error: DESCONOCIDO_MSG, ambiguous: true })
    expect(DESCONOCIDO_MSG).toMatch(/verifica/)
    // Una escritura directa no lleva identificador de operación: no se promete que repetir sea inocuo.
    expect(DESCONOCIDO_MSG).not.toMatch(/no se duplica/i)
  })

  it('error de transporte devuelto como objeto → también ambiguo', async () => {
    const r = await confirmar('guardar', falla('Failed to fetch'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.ambiguous).toBe(true)
  })

  it('si el servidor garantiza idempotencia, se dice que reintentar es seguro', async () => {
    const r = await confirmar('confirmar la entrega', Promise.reject(new Error('timeout')), { reintentoSeguro: true })
    expect(r).toEqual({ ok: false, error: REINTENTO_SEGURO_MSG, ambiguous: true })
  })

  it('un timeout NUNCA se convierte en éxito', async () => {
    const r = await confirmar('cobrar', falla('canceling statement due to statement timeout'))
    expect(r.ok).toBe(false)
  })

  it('un rechazo de permisos no se confunde con ambigüedad aunque venga sin código', async () => {
    const r = await confirmar('guardar', falla('permission denied for table orders'))
    if (!r.ok) { expect(r.ambiguous).toBe(false); expect(r.error).toBe('No tienes permiso para esta operación.') }
  })
})

describe('ningún fallo se queda callado', () => {
  it('cada fallo se publica en el canal global, con QUÉ se intentaba', async () => {
    await confirmar('cambiar el precio de "Sérum Oro"', falla('permission denied'))
    const f = getFallosSnapshot()
    expect(f).toHaveLength(1)
    expect(f[0].que).toBe('cambiar el precio de "Sérum Oro"')
    expect(f[0].ambiguous).toBe(false)
  })

  it('el aviso se queda hasta que el operador lo descarta', async () => {
    await confirmar('guardar', falla('permission denied'))
    const id = getFallosSnapshot()[0].id
    expect(getFallosSnapshot()).toHaveLength(1)
    descartarFallo(id)
    expect(getFallosSnapshot()).toHaveLength(0)
  })

  it('no crece sin límite: conserva los más recientes', () => {
    for (let i = 0; i < 12; i++) reportarFallo(`operación ${i}`, 'x')
    const f = getFallosSnapshot()
    expect(f).toHaveLength(6)
    expect(f[0].que).toBe('operación 11')
  })

  it('trasEscribir: revierte SOLO si falló, y avisa', async () => {
    const revertir = vi.fn()
    trasEscribir('publicar tu comentario', ok(), revertir)
    await Promise.resolve(); await Promise.resolve()
    expect(revertir).not.toHaveBeenCalled()
    trasEscribir('publicar tu comentario', falla('permission denied'), revertir)
    await new Promise((r) => setTimeout(r, 0))
    expect(revertir).toHaveBeenCalledTimes(1)
    expect(getFallosSnapshot()[0].que).toBe('publicar tu comentario')
  })

  it('mensajeDeError distingue comando (redacta sus rechazos) de tabla (no se muestra)', () => {
    const e = { message: 'El envío no existe' }
    expect(mensajeDeError(e, 'comando')).toBe('El envío no existe')
    expect(mensajeDeError(e, 'tabla')).toBe('No se pudo guardar el cambio.')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GUARDA DE REPOSITORIO. El defecto original era un patrón de código: escribir,
// seguir adelante, y dejar el rechazo en la consola. Si reaparece, esta prueba falla.
// ─────────────────────────────────────────────────────────────────────────────
const fuentes = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!../database.types.ts'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>

// Clase D, deliberada y documentada en el propio archivo: avisos internos y bitácora.
const CLASE_D = ['notificationsStore.ts', 'auditStore.ts']

describe('guarda: ninguna escritura vuelve a ser silenciosa', () => {
  const ESCRITURA = /\.(insert|update|upsert|delete)\(/
  const SILENCIO = /\.then\(\(\{ error \}\) => \{ if \(error\) console\.warn\(/

  it('escanea los stores de la app', () => { expect(Object.keys(fuentes).length).toBeGreaterThan(40) })

  it('control positivo: el patrón SÍ detecta la escritura silenciosa original', () => {
    const viejo = "supabase.from('orders').update({ status: 'shipped' }).eq('id', id).then(({ error }) => { if (error) console.warn('[orders] ship', error.message); hydrate() })"
    expect(ESCRITURA.test(viejo) && SILENCIO.test(viejo)).toBe(true)
  })

  it('ninguna escritura deja su rechazo solo en la consola', () => {
    const culpables: string[] = []
    for (const [ruta, src] of Object.entries(fuentes)) {
      if (CLASE_D.some((d) => ruta.endsWith(d))) continue
      src.split('\n').forEach((l, i) => { if (ESCRITURA.test(l) && SILENCIO.test(l)) culpables.push(`${ruta}:${i + 1}`) })
    }
    expect(culpables).toEqual([])
  })

  it('ninguna escritura ignora por completo su resultado con .then(() => recargar)', () => {
    const culpables: string[] = []
    for (const [ruta, src] of Object.entries(fuentes)) {
      if (CLASE_D.some((d) => ruta.endsWith(d))) continue
      src.split('\n').forEach((l, i) => { if (ESCRITURA.test(l) && /\.then\(\(\) => (live\.)?(reload|hydrate)\(\)\)/.test(l)) culpables.push(`${ruta}:${i + 1}`) })
    }
    expect(culpables).toEqual([])
  })

  it('las funciones críticas confirman ANTES de avisar o auditar', () => {
    const orders = fuentes['./ordersStore.ts']
    for (const fn of ['markShipped', 'markDelivered']) {
      const i = orders.indexOf(`export async function ${fn}(`)
      const cuerpo = orders.slice(i, orders.indexOf('\n}\n', i))
      expect(cuerpo.indexOf('await confirmar(')).toBeGreaterThan(-1)
      expect(cuerpo.indexOf('await confirmar(')).toBeLessThan(cuerpo.indexOf('notify('))
      expect(cuerpo.indexOf('await confirmar(')).toBeLessThan(cuerpo.indexOf('logAudit('))
    }
  })
})
