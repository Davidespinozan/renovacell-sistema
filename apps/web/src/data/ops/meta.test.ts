// META-CANALES (170) · lectura de los mensajes de Instagram/Messenger del webhook de Meta y las piezas del envío.
import { describe, it, expect } from 'vitest'
import { extraerMeta, configMeta, cuerpoMeta, leerRespuestaMeta, nombreDePerfil, urlPerfil } from '../../../../../supabase/functions/_shared/meta'
import mig from '../../../../../supabase/migrations/20261223120000_meta_canales.sql?raw'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'
import send from '../../../../../supabase/functions/meta-send/index.ts?raw'
import chatEdge from '../../../../../supabase/functions/chat/index.ts?raw'

const ev = (extra: Record<string, unknown>, message: Record<string, unknown>) => ({ sender: { id: '17841400000000001' }, recipient: { id: '123456789' }, timestamp: 1, message, ...extra })

describe('Mensajes de Instagram y Messenger entrantes', () => {
  it('texto y adjuntos (con su leyenda por canal); el objeto decide el canal', () => {
    const ig = extraerMeta({ object: 'instagram', entry: [{ id: '1', messaging: [ev({}, { mid: 'mid.IG000001', text: 'Hola' }), ev({}, { mid: 'mid.IG000002', attachments: [{ type: 'image', payload: {} }] }), ev({}, { mid: 'mid.IG000003', attachments: [{ type: 'story_mention', payload: {} }] })] }] })
    expect(ig.map((m) => m.texto)).toEqual(['Hola', 'Envió una imagen por Instagram.', 'Te mencionó en una historia de Instagram.'])
    expect(ig[0]).toMatchObject({ canal: 'instagram', psid: '17841400000000001', mid: 'mid.IG000001', destino: '123456789' })
    const fb = extraerMeta({ object: 'page', entry: [{ id: '1', messaging: [ev({}, { mid: 'mid.FB000001', attachments: [{ type: 'file' }] })] }] })
    expect(fb[0]).toMatchObject({ canal: 'messenger', texto: 'Envió un archivo por Facebook.' })
  })
  it('ignora ecos (lo que mandó la página), lecturas/entregas, otros objetos y lo que no trae PSID o mid', () => {
    expect(extraerMeta({ object: 'page', entry: [{ messaging: [ev({}, { mid: 'mid.E', text: 'eco', is_echo: true }), ev({}, { mid: 'short', text: 'x' }), { sender: { id: 'abc' }, message: { mid: 'mid.X000001', text: 'x' } }, { sender: { id: '1234567' }, read: { watermark: 1 } }, { sender: { id: '1234567' }, delivery: { mids: [] } }] }] })).toEqual([])
    expect(extraerMeta({ object: 'whatsapp_business_account', entry: [{ messaging: [ev({}, { mid: 'mid.X000001', text: 'x' })] }] })).toEqual([])
  })
  it('envío: llaves, cuerpo del Send API (Instagram hasta 1000 caracteres), respuesta y nombre del perfil', () => {
    expect(configMeta(() => undefined)).toBeNull()
    expect(configMeta((k) => ({ META_PAGE_TOKEN: 'tok', META_PAGE_ID: '123456789' } as Record<string, string>)[k])).toEqual({ token: 'tok', pageId: '123456789', version: 'v21.0' })
    expect(cuerpoMeta('messenger', '555', 'Hola')).toEqual({ recipient: { id: '555' }, messaging_type: 'RESPONSE', message: { text: 'Hola' } })
    expect((cuerpoMeta('instagram', '555', 'x'.repeat(1500)).message as { text: string }).text).toHaveLength(1000)
    expect(leerRespuestaMeta(200, { message_id: 'mid.OUT1', recipient_id: '555' })).toEqual({ ok: true, mid: 'mid.OUT1' })
    expect(leerRespuestaMeta(400, { error: { message: 'This message is sent outside of allowed window', code: 10 } })).toEqual({ ok: false, error: 'Meta 400 (10): This message is sent outside of allowed window' })
    expect(urlPerfil('instagram', '555', { token: 't', pageId: '1', version: 'v21.0' })).toBe('https://graph.facebook.com/v21.0/555?fields=name,username')
    expect(nombreDePerfil({ name: 'Ana Ruiz' })).toBe('Ana Ruiz'); expect(nombreDePerfil({ username: 'ana.ig' })).toBe('@ana.ig'); expect(nombreDePerfil({ first_name: 'Beto', last_name: 'FB' })).toBe('Beto FB'); expect(nombreDePerfil(null)).toBe('')
  })
})

describe('costura: base, webhook, despacho y chat', () => {
  it('la 170 crea las tablas y funciones de Meta, cambia _cc_nombre_dueno y exige la 168/169', () => {
    for (const s of ['create table public.cc_meta_config', 'create table public.cc_meta_contactos', 'create table public.cc_meta_mensajes', 'create table public.cc_meta_salida', 'create function public.cc_meta_entrante', 'create function public.cc_canal_conversacion', 'create function public.cc_canales_bandeja', 'create trigger trg_cc_meta_encolar', "(Instagram)", "(Facebook)"]) expect(mig).toContain(s)
    expect(mig).toMatch(/if to_regclass\('public\.cc_wa_salida'\) is null or to_regprocedure\('public\.cc_wa_bandeja\(\)'\) is null then raise exception/)
  })
  it('webhook: cada mensaje de Meta entra por su mid; en activo avisa, la IA contesta y sale por el canal; el nombre se completa aparte', () => {
    expect(webhook).toMatch(/admin\.rpc\('cc_meta_entrante', \{ p_canal: m\.canal, p_psid: m\.psid, p_nombre: null, p_mid: m\.mid, p_texto: m\.texto, p_encolar: false \}\)/)
    expect(webhook).toMatch(/if \(error\) \{ obs\('meta', 'internal_error'[^\n]*return new Response\('reintentar', \{ status: 500 \}\)/)
    expect(webhook).toMatch(/if \(r\.nuevo\) await completarNombreMeta\(admin, m\.canal, m\.psid\)/)
    expect(webhook).toMatch(/if \(ia === 'respondio'\) await despacharMeta\(admin\)/)
    expect(webhook).not.toMatch(/prospects/)
  })
  it('meta-send despacha WhatsApp y Meta (tarea con secreto o personal autenticado); el chat devuelve el canal y despacha ambos', () => {
    expect(send).toMatch(/despachar = async \(\) => \(\{ whatsapp: hayWA \? await despacharWhatsApp\(admin\) : null, meta: hayMeta \? await despacharMeta\(admin\) : null \}\)/)
    expect(send).toMatch(/if \(q\.quien\.role === '' \|\| q\.quien\.role === 'doctor'\) return json\(403/)
    expect(send).not.toMatch(/prospects/)
    expect(chatEdge).toMatch(/admin\.rpc\('cc_canal_conversacion', \{ p_conv: conv \}\)/)
    expect(chatEdge).toMatch(/cart_id, canal, whatsapp \}\)/)
    expect((chatEdge.match(/Promise\.all\(\[despacharWhatsApp\(admin\), despacharMeta\(admin\)\]\)/g) ?? []).length).toBe(2)
  })
})
