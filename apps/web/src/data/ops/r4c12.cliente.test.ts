// R4-C12 · Lecciones del primer cliente real (27 oct 2026): busca la sigla tal cual ("TNM"), un solo turno para mensajes
// seguidos ("Tnm" + "Porfavor."), los archivos que la IA no ve pasan a un asesor, y "es de lo que me envían ustedes" es
// recompra. Sin red.
import { describe, it, expect } from 'vitest'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'

describe('búsqueda y archivos', () => {
  it('el canal exige buscar primero lo que escribió el cliente, siglas incluidas', () => {
    const c = politica.contextoCanal('whatsapp')
    expect(c).toContain('busca PRIMERO exactamente como lo escribió el cliente'); expect(c).toContain('si escribe "TNM", busca "TNM"')
    expect(c).toContain('Nunca digas que no lo manejamos sin haber buscado lo que escribió')
  })
  it('imagen, documento, audio o video → atención de un asesor; sticker, ubicación o contacto no', () => {
    for (const t of ['Envió una imagen por WhatsApp.', 'Envió un documento por WhatsApp.', 'Envió un audio por WhatsApp.', 'Envió un video por WhatsApp. «esta caja»'])
      expect(politica.atencionComercial(t), t).toBe('adjunto')
    for (const t of ['Envió un sticker por WhatsApp.', 'Compartió una ubicación por WhatsApp.', 'Compartió un contacto por WhatsApp.'])
      expect(politica.atencionComercial(t), t).toBeNull()
    expect(politica.contextoCanal('whatsapp')).toContain('y tú no lo ves (audio, video o no se pudo abrir), agradécelo y dile que un asesor de Renovacell lo revisa aquí mismo')   // R4-C13
  })
  it('"es de lo que me envían ustedes" es recompra', () => {
    for (const t of ['Pues es de lo q me envían ustedes', 'es lo que nos mandan siempre', 'lo que me surten ustedes']) expect(politica.atencionComercial(t.replace(' q ', ' que ')), t).toBe('recompra')
  })
})

describe('mensajes seguidos: una sola respuesta', () => {
  it('el webhook espera y no responde si ya llegó otro mensaje del cliente', () => {
    expect(webhook).toMatch(/const AGRUPAR_MS = 3_500/)
    expect(webhook).toMatch(/await mostrarEscribiendo\(m\.wamid\)[^\n]*\n[\s\S]*?if \(await llegoOtroMensaje\(admin, r\.conversation_id, r\.seq\)\) return\n[\s\S]*?const ia = await responderIA\(/)   // R4-C13: la descarga del archivo va en medio
    expect(webhook).toMatch(/\.in\('actor_type', \['visitor', 'doctor'\]\)\.gt\('seq', seq\)\.limit\(1\)/)
    expect(webhook).toMatch(/return !error && Array\.isArray\(data\) && data\.length > 0/)
  })
})

describe('la compra anterior no contamina un saludo nuevo', () => {
  it('solo una respuesta corta que continúa cuenta como continuación', () => {
    for (const t of ['100', 'la de 200', '2 piezas', 'la de 100 UI']) expect(politica.esContinuacionCorta(t), t).toBe(true)
    for (const t of ['buen dia', 'Hola', '¿cuál es el número para marcarles?', 'puedo hablar con un vendedor o persona humana', 'hablo con el barbero?']) expect(politica.esContinuacionCorta(t), t).toBe(false)
  })
})
