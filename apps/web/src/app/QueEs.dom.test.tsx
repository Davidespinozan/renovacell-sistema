// @vitest-environment jsdom
// QUÉ ES ESTA PANTALLA (27 nov 2026, dueño: «necesito que expliques de manera clara ahí en el sistema qué es cada sección:
// la facturación, trazabilidad, mermas y control de inventario… específicamente la revisión fiscal»).
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
const h = vi.hoisted(() => ({ ancho: true }))
vi.mock('./useAnchoMinimo', () => ({ useAnchoMinimo: () => h.ancho }))
import { QueEs, QueEsParte } from './QueEs'
import { EXPLICACIONES, parteDe, type Explicacion, type IdExplicacion } from './explicaciones'

const ids = Object.keys(EXPLICACIONES) as IdExplicacion[]
const de = (id: IdExplicacion): Explicacion => EXPLICACIONES[id]
const leer = (ruta: string) => readFileSync(resolve(__dirname, '..', ruta), 'utf8')

beforeEach(() => { cleanup(); h.ancho = true; try { localStorage.clear() } catch { /* sin almacenamiento */ } })

describe('el texto de cada pantalla', () => {
  it('están las cinco que pidió el dueño', () => {
    expect(ids.sort()).toEqual(['control_inventario', 'facturacion', 'mermas', 'revision_fiscal', 'trazabilidad'])
  })
  it('cada una dice qué es en una o dos frases, sin palabras del oficio', () => {
    for (const id of ids) {
      const e = de(id)
      expect(e.titulo.length, id).toBeGreaterThan(3)
      expect(e.que.length, id).toBeGreaterThan(60); expect(e.que.length, id).toBeLessThanOrEqual(260)
      expect(e.que, id).not.toMatch(/kardex|CFDI|ledger|borrador|autoridad fiscal|disponer|conciliaci|inmutable|recall|PAC\b/i)
      expect((e.pasos ?? []).length, id).toBeLessThanOrEqual(5)
    }
  })
  it('ninguna palabra del oficio que se use en el texto se queda sin definir', () => {
    const RARAS: Array<[RegExp, string]> = [[/kardex/i, 'Kardex'], [/\bCFDI\b/, 'CFDI'], [/timbrar/i, 'Timbrar'], [/recall/i, 'Recall'], [/disponer/i, 'Disponer'], [/conciliar/i, 'Conciliar']]
    for (const id of ids) {
      const e = de(id)
      const texto = [e.que, ...(e.pasos ?? []), ...(e.partes ?? []).flat(), e.nota ?? ''].join(' ')
      for (const [re, palabra] of RARAS) if (re.test(texto)) expect((e.palabras ?? []).map(([p]) => p), `${id}: falta definir «${palabra}»`).toContain(palabra)
    }
  })
  it('las partes se llaman igual que lo que se ve en la pantalla', () => {
    const rf = leer('screens/admin/RevisionFiscal.tsx')
    for (const [n] of de('revision_fiscal').partes ?? []) expect(rf, n).toContain(n)
    const ci = leer('screens/admin/ControlInventario.tsx')
    for (const [n] of de('control_inventario').partes ?? []) expect(ci, n).toContain(n)
    const tz = leer('screens/admin/Trazabilidad.tsx')
    for (const [n] of de('trazabilidad').partes ?? []) expect(tz, n).toContain(n)
    const me = leer('screens/admin/Mermas.tsx')
    for (const [n] of (de('mermas').partes ?? []).filter(([x]) => x !== '(mínimo)')) expect(me, n).toContain(n)
    expect(me).toContain('(mínimo)')
  })
  it('los botones que nombra existen con ese nombre', () => {
    const rf = leer('screens/admin/RevisionFiscal.tsx')
    for (const b of ['Revisar', 'Guardar borrador', 'Validar este producto', 'Datos para la factura']) expect(rf, b).toContain(b)
    const fa = leer('screens/admin/Facturacion.tsx') + leer('screens/admin/TimbrarCFDI.tsx')
    for (const b of ['Por emitir', 'Solicitar factura', 'Timbrar factura', 'Enviar por WhatsApp']) expect(fa, b).toContain(b)
    expect(leer('screens/admin/ControlInventario.tsx')).toContain('Conciliar ahora')
    expect(leer('screens/warehouse/MermaModal.tsx')).toContain('Dar de baja')
  })
  it('cada pantalla monta su explicación', () => {
    expect(leer('screens/admin/Facturacion.tsx')).toContain('<QueEs id="facturacion" />')
    expect(leer('screens/admin/RevisionFiscal.tsx')).toContain('<QueEs id="revision_fiscal" sinPartes />')
    expect(leer('screens/admin/Trazabilidad.tsx')).toContain('<QueEs id="trazabilidad" sinPartes />')
    expect(leer('screens/admin/Mermas.tsx')).toContain('<QueEs id="mermas" />')
    expect(leer('screens/admin/ControlInventario.tsx')).toContain('<QueEs id="control_inventario" sinPartes />')
    // las que no repiten sus partes arriba las explican al elegir cada pestaña interna
    for (const f of ['RevisionFiscal', 'Trazabilidad', 'ControlInventario']) expect(leer(`screens/admin/${f}.tsx`), f).toContain('<QueEsParte id=')
  })
})

describe('<QueEs>', () => {
  it('en el celular el detalle viene cerrado: queda la frase y «Cómo se usa»; al abrirlo se recuerda', () => {
    h.ancho = false
    const { unmount } = render(<QueEs id="facturacion" />)
    expect(screen.getByTestId('quees-que')).toHaveTextContent('Aquí se hacen las facturas de las ventas')
    expect(screen.queryByTestId('quees-cuerpo')).toBeNull()
    fireEvent.click(screen.getByTestId('quees-alternar'))
    expect(screen.getByTestId('quees-cuerpo')).toHaveTextContent('Timbrar factura')
    unmount()
    render(<QueEs id="facturacion" />)
    expect(screen.getByTestId('quees-cuerpo')).toBeInTheDocument()              // lo abrió: se queda abierto
  })
  it('con pestañas internas no repite sus partes arriba (cada pestaña se explica al elegirla)', () => {
    render(<QueEs id="revision_fiscal" sinPartes />)
    const c = screen.getByTestId('quees-cuerpo')
    expect(c).not.toHaveTextContent('Qué hay en esta pantalla'); expect(c).toHaveTextContent('Cómo se usa'); expect(c).toHaveTextContent('Completo sin validar')
  })
  it('lo que es la pantalla está siempre a la vista, y en computadora el detalle viene abierto la primera vez', () => {
    render(<QueEs id="revision_fiscal" />)
    const b = screen.getByTestId('quees-revision_fiscal')
    expect(within(b).getByTestId('quees-que')).toHaveTextContent('Revisión fiscal.')
    expect(within(b).getByTestId('quees-que')).toHaveTextContent('se llama «validar»')
    const c = within(b).getByTestId('quees-cuerpo')
    expect(c).toHaveTextContent('Cómo se usa'); expect(c).toHaveTextContent('Validar este producto')
    expect(c).toHaveTextContent('Qué hay en esta pantalla'); expect(c).toHaveTextContent('Sugerencias por categoría')
    expect(c).toHaveTextContent('Palabras que vas a ver'); expect(c).toHaveTextContent('Completo sin validar')
    expect(within(b).getByTestId('quees-nota')).toHaveTextContent('No existe «validar todo»')
  })
  it('«Ocultar» esconde el detalle, deja la frase, y se recuerda al volver', () => {
    const { unmount } = render(<QueEs id="mermas" />)
    fireEvent.click(screen.getByTestId('quees-alternar'))
    expect(screen.queryByTestId('quees-cuerpo')).toBeNull()
    expect(screen.getByTestId('quees-que')).toHaveTextContent('Merma es producto que se perdió')
    expect(screen.getByTestId('quees-alternar')).toHaveTextContent('Cómo se usa')
    unmount()
    render(<QueEs id="mermas" />)
    expect(screen.queryByTestId('quees-cuerpo')).toBeNull()                    // sigue oculto
    render(<QueEs id="trazabilidad" />)                                        // otra pantalla no se oculta por eso
    expect(within(screen.getByTestId('quees-trazabilidad')).getByTestId('quees-cuerpo')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('quees-mermas')).getByTestId('quees-alternar'))
    expect(within(screen.getByTestId('quees-mermas')).getByTestId('quees-cuerpo')).toHaveTextContent('Dar de baja')
  })
})

describe('<QueEsParte>', () => {
  it('dice qué es la pestaña interna elegida, con el mismo texto que el bloque de arriba', () => {
    render(<QueEsParte id="control_inventario" parte="Conciliación" />)
    expect(screen.getByTestId('quees-parte')).toHaveTextContent('Conciliación: El sistema suma las entradas y salidas de cada lote')
    expect(parteDe('control_inventario', 'Conciliación')).toContain('0 diferencias')
  })
  it('una parte que no está descrita no pinta nada', () => {
    const { container } = render(<QueEsParte id="control_inventario" parte="No existe" />)
    expect(container).toBeEmptyDOMElement()
  })
})
