// UX V2-A/B · Guardas de repositorio: apertura automática solo desde la respuesta del servidor; badge con
// categorías explícitas; redactor y móvil; CSS saneado; la landing conserva su assistant; la IA no recibe
// líneas del asesor como si fueran del doctor; herramientas y conocimiento sin cambios.
import { describe, it, expect } from 'vitest'
// @ts-expect-error tipos de node no incluidos en el tsconfig del front (vitest corre en Node)
import { readFileSync } from 'node:fs'
import hookSrc from '../hooks/useCarritoCanonico.ts?raw'
import storeSrc from '../store/chatUiStore.ts?raw'
import lanzadorSrc from '../../app/ChatFlotante.tsx?raw'
import chatSrc from '../../screens/chat/ChatCanonico.tsx?raw'
import panelSrc from '../../screens/chat/CarritoPanel.tsx?raw'
import politicaSrc from '../../../../../supabase/functions/_shared/ia/politica.ts?raw'
import herramientasSrc from '../../../../../supabase/functions/_shared/ia/herramientas.ts?raw'
import landingSrc from '../../../public/landing/index.html?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')
const css = (f: string) => readFileSync(new URL(`../../styles/${f}`, import.meta.url), 'utf8')
const shell = css('shell.css'); const chat = css('chat.css')
const tokens = readFileSync(new URL('../../../../../packages/ui/tokens.css', import.meta.url), 'utf8')

describe('V2-A · apertura y actividad', () => {
  it('la apertura nace de la respuesta del servidor, no de cantidades, polling ni texto', () => {
    const h = codigo(hookSrc)
    expect(h).toMatch(/if \(r\.ok\) \{ const h = handoffNuevoDe\(r\.data\); if \(h\) chatUi\.solicitarApertura\(\{ motivo: 'first_item_handoff', \.\.\.h \}\) \}/)
    const s = codigo(storeSrc)
    expect(s).toMatch(/if \(!m \|\| m\.idempotente\) return null/)
    expect(s).toMatch(/h\.estado !== 'solicitado' \|\| h\.ya_en_curso/)
    expect(s).not.toMatch(/qty_despues|n_items|content|seller/)
  })
  it('V2-D2 · el episodio comercial NO abre el chat: se marca por episodio y despierta la lectura; sin notificaciones del navegador', () => {
    const l = codigo(lanzadorSrc)
    expect(l).toMatch(/chatUi\.consumir\(solicitud\.id\)\n\s*if \(!visible\) return/)
    expect(l).toMatch(/marcarAbiertoPara\(solicitud\.episodio\)\n\s*if \(!abiertoRef\.current\) void revisarRef\.current\(\)/)
    expect(l).not.toMatch(/abrirAuto/)                                            // no existe apertura automática
    expect((l.match(/setAbierto\(true\)/g) ?? []).length).toBe(1)               // solo abrirManual abre
    expect(l).not.toMatch(/new Notification|Notification\.requestPermission/)
    expect((l.match(/<ChatCanonico /g) ?? []).length).toBe(1)
  })
  it('badge con categorías explícitas: asesor/Dirección/IA siempre; sistema solo con atención humana activa; nunca propios', () => {
    const l = codigo(lanzadorSrc)
    expect(l).toMatch(/if \(m\.propio\) return false/)
    expect(l).toMatch(/if \(m\.actor === 'seller' \|\| m\.actor === 'admin' \|\| m\.actor === 'ai'\) return true/)
    expect(l).toMatch(/if \(m\.actor === 'system'\) return modo === 'human_active'/)
    expect(l).toMatch(/chat-fab--pulso/)
  })
})

describe('V2-B · redactor, móvil y CSS', () => {
  it('redactor: textarea con Enter/Shift+Enter, idempotencia al reintentar, sin botón grande de cierre', () => {
    const c = codigo(chatSrc)
    expect(c).toMatch(/<textarea/); expect(c).toMatch(/e\.key === 'Enter' && !e\.shiftKey/); expect(c).toMatch(/enterKeyHint="send"/)
    expect(c).toMatch(/cliente\.enviar\(convId, t, clientId\)/)   // el MISMO client_message_id al reintentar
    expect(c).toMatch(/className="rc-ico" onClick=\{onSalir\}/)
    expect(c).not.toMatch(/className="btn" onClick=\{onSalir\}/)
    expect(c).not.toMatch(/estilos\.pagina|style=\{estilos/)        // sin estilos inline de panel de ERP
  })
  it('chip de carrito: vacío sin franja; botón de confirmar y Stripe intactos (CC-6)', () => {
    const p = codigo(panelSrc)
    expect(p).toMatch(/if \(cart\.n_items === 0 && !pedido && !revision\) return null/)
    expect(p).toMatch(/className="rc-chip"/)
    expect(p).toMatch(/data-testid="checkout-confirmar">Confirmar pedido<\/button>/)
  })
  it('19/20/22 · móvil: dvh + teclado, bloqueo de scroll, reduced-motion; .btn-primary y variables definidas', () => {
    expect(shell).toMatch(/\.chat-drawer\{width:100%;height:calc\(100dvh - var\(--rc-kb,0px\)\)/)
    expect(shell).toMatch(/body\.chat-open\{overflow:hidden\}/)
    expect(codigo(lanzadorSrc)).toMatch(/document\.body\.classList\.add\('chat-open'\)/)
    expect(codigo(lanzadorSrc)).toMatch(/window\.visualViewport/)
    expect(shell).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\.chat-fab,\.chat-fab--pulso,\.chat-vista,\.chat-drawer,\.chat-drawer-wrap,\.sheet,\.sheet-wrap,\.overlay,\.modal\{animation:none\}/)
    expect(chat).toMatch(/@media \(prefers-reduced-motion:reduce\)/)
    expect(shell).toMatch(/\n\.btn-primary\{/)
    for (const v of ['--bg:', '--bg-2:', '--brand-soft:', '--card:']) expect(tokens).toContain(v)
    expect(chat).toMatch(/\.rc-composer\{[^}]*env\(safe-area-inset-bottom/)
    expect(chat).toMatch(/\.rc-input\{[^}]*min-height:44px/)
  })
  it('21 · foco: entra al redactor al abrir y vuelve al lanzador al cerrar', () => {
    expect(codigo(chatSrc)).toMatch(/if \(autoFoco && !cargando\) area\.current\?\.focus\(\)/)
    expect(codigo(lanzadorSrc)).toMatch(/fab\.current\?\.focus\(\)/)
  })
  it('23 · la landing pública conserva su assistant', () => {
    expect(landingSrc).toMatch(/\/functions\/v1\/assistant/)
  })
})

describe('IA · contexto', () => {
  it('25 · solo visitante/doctor son "user" y solo la IA es "assistant"; asesor/Dirección se excluyen', () => {
    const p = codigo(politicaSrc)
    expect(p).toMatch(/m\.actor === 'ai' \? 'assistant' : m\.actor === 'visitor' \|\| m\.actor === 'doctor' \? 'user' : null/)
    expect(p).toMatch(/if \(!role\) continue/)
  })
  it('26 · el registro de herramientas no cambió (16 nombres, sin confirmar pedido)', () => {
    const h = codigo(herramientasSrc)
    expect((h.match(/name: '/g) ?? []).length).toBe(16)
    expect(h).not.toContain("name: 'confirmar_checkout'")
  })
})
