// @vitest-environment jsdom
// ENLACE DE CONTRASEÑA (5 nov 2026) · el enlace de "crea tu contraseña" caía en la LANDING (raíz) porque Supabase ignora un
// redirect_to que no está en su lista y regresa al Site URL. La landing reenvía al sistema; un enlace vencido se explica.
import { describe, it, expect, vi, afterEach } from 'vitest'
import landing from '../../public/landing/index.html?raw'
import { enlaceVencido } from '../screens/Login'

const guion = landing.match(/<script>\s*\/\* ENLACE DE CONTRASEÑA[\s\S]*?<\/script>/)?.[0].replace(/<\/?script>/g, '') ?? ''
function correr(hash: string, search = '') {
  const replace = vi.fn()
  new Function('location', guion)({ hash, search, replace })
  return replace
}

describe('landing · reenvío de enlaces de acceso', () => {
  it('está en el <head>, antes de todo lo demás', () => {
    expect(guion).not.toBe('')
    expect(landing.indexOf('ENLACE DE CONTRASEÑA')).toBeLessThan(landing.indexOf('<title'))
  })
  it('recuperación (lo que manda alta-whatsapp) → /sistema con el mismo hash', () => {
    const r = correr('#access_token=abc&expires_in=3600&refresh_token=x&token_type=bearer&type=recovery')
    expect(r).toHaveBeenCalledWith('/sistema#access_token=abc&expires_in=3600&refresh_token=x&token_type=bearer&type=recovery')
  })
  it('enlace vencido y flujo con ?code= también van al sistema', () => {
    expect(correr('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')).toHaveBeenCalled()
    expect(correr('', '?code=0f5c3a1e-7b2d-4c1a-9e8f-123456789abc')).toHaveBeenCalledWith('/sistema?code=0f5c3a1e-7b2d-4c1a-9e8f-123456789abc')
  })
  it('las anclas normales de la landing no se tocan', () => {
    expect(correr('#cumplimiento')).not.toHaveBeenCalled()
    expect(correr('#s2rm')).not.toHaveBeenCalled()
    expect(correr('', '?utm_source=wa')).not.toHaveBeenCalled()
  })
})

describe('login · enlace vencido', () => {
  afterEach(() => window.history.replaceState(null, '', '/sistema'))
  it('otp_expired → aviso claro y limpia la dirección', () => {
    window.history.replaceState(null, '', '/sistema#error=access_denied&error_code=otp_expired')
    expect(enlaceVencido()).toMatch(/ya venció o ya se usó/)
    expect(window.location.hash).toBe('')
  })
  it('sin error en la dirección → nada', () => {
    window.history.replaceState(null, '', '/sistema#type=recovery')
    expect(enlaceVencido()).toBeNull()
  })
})
