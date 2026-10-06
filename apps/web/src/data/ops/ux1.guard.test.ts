// UX-1 · Guardas: el doctor percibe UNA conversación con Renovacell. Sin "Asistente IA" como módulo,
// alias heredado hacia la canónica, lanzador flotante solo doctor y nunca dos ChatCanonico; la
// landing pública conserva su assistant; el badge usa el cursor del servidor (leido_hasta).
import { describe, it, expect } from 'vitest'
import rolesSrc from '../../app/roles.ts?raw'
import registrySrc from '../../screens/registry.tsx?raw'
import shellSrc from '../../app/AppShell.tsx?raw'
import lanzadorSrc from '../../app/ChatFlotante.tsx?raw'
import chatSrc from '../../screens/chat/ChatCanonico.tsx?raw'
// vitest corre en Node; el CSS se lee del disco porque vitest devuelve '' para imports .css (sin @types/node en src).
// @ts-expect-error tipos de node no incluidos en el tsconfig del front
import { readFileSync } from 'node:fs'
import mig from '../../../../../supabase/migrations/20261105120000_ux_compras_idempotentes_chat_leido.sql?raw'
import { getRole, getNav } from '../../app/roles'

const cssSrc = readFileSync(new URL('../../styles/shell.css', import.meta.url), 'utf8')
const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')
const fuentes = import.meta.glob(['../../**/*.ts', '../../**/*.tsx', '!../../**/*.test.ts', '!../../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('UX-1 · navegación del doctor', () => {
  it('1 · un solo módulo conversacional: "Habla con Renovacell"; no existe "Asistente IA"', () => {
    const nav = getNav(getRole('doctor'))
    const conversacionales = nav.filter((s) => s.icon === 'chat' || /chat|asist|habla/i.test(s.key))
    expect(conversacionales.map((s) => s.key)).toEqual(['chat_cc'])
    expect(conversacionales[0].label).toBe('Habla con Renovacell')
    expect(nav.some((s) => s.key === 'asist')).toBe(false)
    expect(codigo(rolesSrc)).not.toMatch(/Asistente IA/)
  })
  it('2 · el enlace heredado `asist` resuelve a la conversación canónica (alias, no segunda implementación)', () => {
    const r = codigo(registrySrc)
    expect(r).toMatch(/asist: \(\) => <RedirigirChat \/>/)
    expect(r).toMatch(/setScreen\('chat_cc'\)/)
    expect(r).not.toMatch(/<Asistente|doctor\/Asistente/)
  })
  it('10 · el Asistente legado del doctor desapareció del código; el assistant Edge sigue para la landing', () => {
    const rutas = Object.keys(fuentes)
    expect(rutas.some((p) => /screens\/doctor\/Asistente\.tsx$/.test(p))).toBe(false)
    expect(rutas.some((p) => /data\/assistant\//.test(p))).toBe(false)
    expect(rutas.some((p) => /useAssistant\.ts$/.test(p))).toBe(false)
    for (const [p, src] of Object.entries(fuentes)) if (!/ChatFlotante|guard/.test(p)) expect(src).not.toMatch(/invoke\('assistant'/)
  })
})

describe('UX-1 · lanzador flotante', () => {
  const l = codigo(lanzadorSrc)
  it('3/4/5 · solo doctor, oculto en chat_cc/asist, monta ChatCanonico UNA vez y sin disparadores de handoff', () => {
    expect(l).toMatch(/role === 'doctor'/)
    expect(l).toMatch(/new Set\(\['chat_cc', 'asist'\]\)/)
    expect((l.match(/<ChatCanonico /g) ?? []).length).toBe(1)
    expect(l).not.toMatch(/cc_handoff|solicitarAsesor|enviar\(|\.from\(|\.rpc\(/)
    expect(codigo(shellSrc)).toMatch(/<ChatFlotante \/>/)
  })
  it('12 · sin leer = leido_hasta del servidor; el polling del lanzador solo con el cajón cerrado', () => {
    expect(l).toMatch(/r\.data\.leido_hasta/)
    expect(l).toMatch(/if \(!visible \|\| !convId \|\| abierto\) return/)
    expect(codigo(chatSrc)).toMatch(/onLeido\?\.\(max\)/)
    expect(codigo(mig)).toMatch(/'leido_hasta', coalesce\(\(select p\.last_read_seq from public\.cc_participants p/)
  })
  it('11 · móvil: hoja casi completa con dvh, lanzador sobre la barra inferior y barra oculta con el cajón abierto', () => {
    expect(cssSrc).toMatch(/\.chat-drawer\{[^}]*height:100dvh/)
    expect(cssSrc).toMatch(/@media \(max-width:900px\)\{\n\s+\.chat-fab\{bottom:calc\(96px/)
    expect(cssSrc).toMatch(/\.chat-drawer\{width:100%;height:calc\(100dvh - var\(--rc-kb,0px\)\)/)   // V2-B · pantalla completa; sigue al teclado
    expect(cssSrc).toMatch(/body:has\(\.chat-drawer-wrap\) \.bnav\{display:none\}/)
  })
})
