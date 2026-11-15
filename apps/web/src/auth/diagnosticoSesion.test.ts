// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { anotarSalida, fueSalidaPedida, marcarSalidaPedida, subirDiagnostico } from './diagnosticoSesion'

describe('diagnóstico de sesión', () => {
  beforeEach(() => localStorage.removeItem('rc_diag_sesion'))
  it('anota, sube y borra; si falla se queda', async () => {
    anotarSalida('sesion_perdida', 'x'); anotarSalida('perfil_sin_red_fuera')
    const malo = vi.fn().mockResolvedValue({ error: { message: 'red' } })
    await subirDiagnostico(malo)
    expect(JSON.parse(localStorage.getItem('rc_diag_sesion')!)).toHaveLength(2)
    const bueno = vi.fn().mockResolvedValue({ error: null })
    await subirDiagnostico(bueno)
    expect(bueno.mock.calls[0][1].p_eventos[0].evento).toBe('sesion_perdida')
    expect(localStorage.getItem('rc_diag_sesion')).toBeNull()
  })
  it('guarda solo los últimos 20', () => {
    for (let i = 0; i < 25; i++) anotarSalida('sesion_perdida')
    expect(JSON.parse(localStorage.getItem('rc_diag_sesion')!)).toHaveLength(20)
  })
  it('la salida pedida se consume una vez', () => {
    marcarSalidaPedida(); expect(fueSalidaPedida()).toBe(true); expect(fueSalidaPedida()).toBe(false)
  })
})
