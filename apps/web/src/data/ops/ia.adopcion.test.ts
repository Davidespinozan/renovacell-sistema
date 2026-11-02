// ADOPCIÓN DEL PORTAL (2 nov 2026) · WhatsApp es la puerta, el portal su casa: al aprobarlo recibe su acceso, cada pedido por
// WhatsApp lleva el enlace del portal y la IA lo invita en el momento justo (una vez, sin dejar de atenderlo).
import { describe, it, expect } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import altaSrc from '../../../../../supabase/functions/alta-whatsapp/index.ts?raw'

const doctor = { actor: 'doctor', audiencia: 'verified', puede_precio: true, puede_stock: true, puede_pedidos: true, verificado: true }

describe('la IA invita al portal', () => {
  it('reconocido en WhatsApp: regla "el portal es su casa" y el enlace al confirmar', () => {
    const s = politica.construirSistema({ ctx: doctor, intencion: 'CHECKOUT', limiteClinico: false, reglasConocimiento: [], evidencia: [], canal: 'whatsapp' })
    expect(s).toContain('EL PORTAL ES SU CASA'); expect(s).toMatch(/una vez por conversación/); expect(s).toMatch(/No prometas facturas/)
    expect(s).toMatch(/Si el resultado trae "portal"/)
  })
  it('sin reconocer, ni en el portal: no se agrega', () => {
    const anon = politica.construirSistema({ ctx: { ...doctor, actor: 'visitor', audiencia: 'public', verificado: false, puede_precio: false }, intencion: 'PRICE', limiteClinico: false, reglasConocimiento: [], evidencia: [], canal: 'whatsapp' })
    expect(anon).not.toContain('EL PORTAL ES SU CASA')
    expect(politica.construirSistema({ ctx: doctor, intencion: 'CHECKOUT', limiteClinico: false, reglasConocimiento: [], evidencia: [], canal: 'portal' })).not.toContain('EL PORTAL ES SU CASA')
  })
})

describe('aprobación por WhatsApp', () => {
  it('ya cliente: se liga a SU ficha (una sola coincidencia) en vez de fallar por duplicado', () => {
    expect(altaSrc).toMatch(/includes\('POSIBLE_DUPLICADO'\)[\s\S]{0,1200}cc_vincular_cliente/)
    expect(altaSrc).toMatch(/ids\.length > 1\) return json\(409/)
  })
  it('cuenta existente se reutiliza (verificándola si hacía falta, y si no se puede, se dice)', () => {
    expect(altaSrc).toMatch(/doctor_verificar[\s\S]{0,200}if \(eVer\) return json\(409/)
  })
  it('cuenta nueva: enlace para crear su contraseña, directo al sistema', () => {
    expect(altaSrc).toMatch(/generateLink\(\{ type: 'recovery', email: s\.email, options: \{ redirectTo: 'https:\/\/sistema\.renovacell\.mx\/sistema' \} \}\)/)
    expect(altaSrc).toMatch(/cc_alta_wa_cerrar', \{[^}]*p_enlace: enlace, p_cuenta_nueva: cuentaNueva \}/)
  })
})
