// ANTIBOT (5 nov 2026) · la IA de canal no conversa con otro bot. Fixtures = textos reales del incidente (bot de otra empresa).
import { describe, it, expect } from 'vitest'
import { esNumeroEmpresa, frenoBot, sinContenido, pareceAutomatico } from '../../../../../supabase/functions/_shared/ia/antibot'
import responderSrc from '../../../../../supabase/functions/_shared/ia/responder.ts?raw'
import { LIMITES } from '../../../../../supabase/functions/_shared/limite'

const v = (content: string) => ({ actor: 'visitor', content })
const ai = (content: string) => ({ actor: 'ai', content })
const NO_ENTENDI = '¡Vaya! 🤔 No entendí lo que me escribiste. Pero no te preocupes, *¡Intenta de nuevo!*'
const FINALIZAR = 'Creo que no estamos en la misma sintonía. 😅 Voy a finalizar la charla por el momento. Si necesitas más ayuda, escríbeme *Hola* y seguimos conversando.'
const ANDY = 'Hola, no te había visto por aquí. 👀 Mucho gusto, soy Andy Asistente virtual de Farmacias del Ahorro ¿Cuál es tu nombre? 👇🏼 *Escribe solo tu nombre*'
const OPCIONES = 'No logré entender lo que escribiste, selecciona una de las opciones.'
const NUESTRA = 'Parece que otro asistente automático te está respondiendo, porque ese mensaje es de Farmacias del Ahorro y no de nosotros. Soy el asistente virtual de Renovacell.'

describe('ANTIBOT · frenoBot', () => {
  it('sin contenido (plantilla/aviso de empresa, reacción) no se contesta', () => {
    expect(sinContenido('Envió un mensaje por WhatsApp.')).toBe(true)
    expect(sinContenido('Envió un mensaje por Instagram.')).toBe(true)
    expect(sinContenido('Envió una imagen por WhatsApp.')).toBe(false)   // la imagen sí la ve la IA (visión)
    expect(frenoBot([], 'Envió un mensaje por WhatsApp.')).toBe('sin_contenido')
  })
  it('incidente: el bot repite NUESTRO texto → eco', () => {
    expect(frenoBot([v('x'), ai(NUESTRA)], 'Hola de nuevo ' + NUESTRA)).toBe('eco')
  })
  it('incidente: segunda frase automática en la sesión → automático', () => {
    expect(frenoBot([v(NO_ENTENDI), v(NO_ENTENDI), v(FINALIZAR), ai('Cuéntame qué producto buscas.')], ANDY)).toBe('automatico')
    expect(frenoBot([v(ANDY), ai('Hola')], OPCIONES)).toBe('automatico')
  })
  it('el mismo texto 3 veces con respuestas de la IA entre ellas → repetido', () => {
    const t = 'Quiero información de todo por favor'
    expect(frenoBot([v(t), ai('Claro, ¿de qué producto?'), v(t), ai('¿Cuál te interesa?')], t)).toBe('repetido')
  })
  it('una persona que reenvía porque la IA tardó NO se frena', () => {
    const t = 'Tienen toxina botulínica disponible?'
    expect(frenoBot([v(t), v(t)], t)).toBeNull()
  })
  it('una sola frase "automática" de una persona no frena; texto normal tampoco', () => {
    expect(frenoBot([], 'No entendí lo que me dijiste, me explicas el precio?')).toBeNull()
    expect(frenoBot([v('Hola'), ai('¡Hola! ¿En qué te ayudo?')], 'Busco TNM, 10 piezas')).toBeNull()
    expect(frenoBot([v(OPCIONES), ai('ok')], 'Perdón, era el bot del banco. Quiero 2 Nabota')).toBeNull()
  })
  it('el disparador incluido al final del historial no cuenta contra sí mismo', () => {
    expect(frenoBot([v(OPCIONES)], OPCIONES)).toBeNull()
  })
  it('pareceAutomatico reconoce menús típicos', () => {
    expect(pareceAutomatico('Responde con el número de la opción')).toBe(true)
    expect(pareceAutomatico('Me interesa el mayoreo')).toBe(false)
  })
})

describe('BOT DETECTADO · aviso a Renovacell', () => {
  it('número 800/900 de empresa (como el de hoy) sí; celulares no', () => {
    expect(esNumeroEmpresa('wa:5218007112222')).toBe(true)
    expect(esNumeroEmpresa('wa:528007112222')).toBe(true)
    expect(esNumeroEmpresa('wa:5219001234567')).toBe(true)
    expect(esNumeroEmpresa('wa:5216671112233')).toBe(false)
    expect(esNumeroEmpresa('meta:8001234567')).toBe(false)
  })
  it('800/900 y conversación ya marcada: silencio total; un sin-contenido de celular no se marca', () => {
    expect(responderSrc).toMatch(/if \(esNumeroEmpresa\(sujeto\)\) \{ await admin\.rpc\('cc_bot_detectado', \{ p_conv: conv, p_motivo: 'numero_empresa' \}\)/)
    expect(responderSrc).toMatch(/if \(yaBot\) return 'silenciada'/)
    expect(responderSrc).toMatch(/const motivoBot = freno === 'sin_contenido' \? null : freno/)
    expect(responderSrc.indexOf('esNumeroEmpresa(sujeto)')).toBeLessThan(responderSrc.indexOf('politica.transferenciaDeterminista(texto)'))
  })
  it('frases del bot del 6 nov', () => {
    expect(pareceAutomatico('Recuerda que puedes escribir *Menú* en cualquier momento para volver al inicio.')).toBe(true)
    expect(pareceAutomatico('👋 Hola, parece que nos perdimos de vista.')).toBe(true)
    expect(pareceAutomatico('¿Me puedes mandar el menú de productos?')).toBe(false)
  })
})

describe('ANTIBOT · cableado en responderIA', () => {
  it('el freno corre en canales ANTES del traspaso y del proveedor; el techo por contacto va con los demás límites, solo en canal', () => {
    const iFreno = responderSrc.indexOf('frenoBot(hist, texto)')
    const iTrans = responderSrc.indexOf('politica.transferenciaDeterminista(texto)')
    const iTecho = responderSrc.indexOf("'ia_turno_canal_hora'")
    const iProv = responderSrc.indexOf('crearProveedorAnthropic(')
    expect(iFreno).toBeGreaterThan(0)
    expect(iFreno).toBeLessThan(iTrans)
    expect(iTrans).toBeLessThan(iTecho)
    expect(iTecho).toBeLessThan(iProv)
    expect(LIMITES.ia_turno_canal_hora).toEqual({ limite: 30, ventanaSegs: 3600 })
    expect(LIMITES.ia_turno_canal_dia).toEqual({ limite: 100, ventanaSegs: 86400 })
  })
})
