// @vitest-environment jsdom
// CS-BB · manual BanBajío §4.1: clientLibrary e integridad pueden cambiar POR TRANSACCIÓN. La librería Flex se carga una sola vez
// por URL, y si un capture context nuevo trae otra URL/integridad se retira la anterior (script + window.Flex) y se carga la nueva.
import { describe, it, expect, beforeEach } from 'vitest'
import { cargarLibreriaFlex, _reiniciarCargasFlex, type FlexCtor } from './cybersource'

const URL1 = 'https://testflex.cybersource.com/microform/bundle/v2.5.2/flex-microform.min.js'
const URL2 = 'https://testflex.cybersource.com/microform/bundle/v2.6.0/flex-microform.min.js'
const w = window as unknown as { Flex?: FlexCtor }
const scripts = () => Array.from(document.head.querySelectorAll('script[data-flex-microform]')) as HTMLScriptElement[]
function simularCarga(version: string) {
  const l = scripts(); const s = l[l.length - 1]
  w.Flex = function Flex() { return { version } } as unknown as FlexCtor
  s.onload?.(new Event('load'))
}
beforeEach(() => { _reiniciarCargasFlex(); document.head.innerHTML = ''; delete w.Flex })

describe('CS-BB · carga de la librería Flex', () => {
  it('misma URL → una sola carga; URL distinta → se retira la anterior y se carga la nueva con su integridad', async () => {
    const p1 = cargarLibreriaFlex(URL1, 'sha256-uno')
    expect(scripts()).toHaveLength(1); expect(scripts()[0].src).toBe(URL1); expect(scripts()[0].integrity).toBe('sha256-uno'); expect(scripts()[0].crossOrigin).toBe('anonymous')
    simularCarga('v2.5.2')
    const F1 = await p1
    expect(await cargarLibreriaFlex(URL1, 'sha256-uno')).toBe(F1)
    expect(scripts()).toHaveLength(1)
    const p2 = cargarLibreriaFlex(URL2, 'sha256-dos')
    expect(scripts()).toHaveLength(1); expect(scripts()[0].src).toBe(URL2); expect(scripts()[0].integrity).toBe('sha256-dos')
    simularCarga('v2.6.0')
    const F2 = await p2
    expect(F2).not.toBe(F1)
    // misma URL con otra integridad también recarga
    const p3 = cargarLibreriaFlex(URL2, 'sha256-tres')
    expect(scripts()[0].integrity).toBe('sha256-tres'); simularCarga('v2.6.0b'); expect(await p3).not.toBe(F2)
  })
  it('URL fuera de cybersource.com → rechazo sin tocar el DOM', async () => {
    await expect(cargarLibreriaFlex('https://evil.example/flex.js', 'sha256-x')).rejects.toThrow('librería no permitida')
    expect(scripts()).toHaveLength(0)
  })
})
