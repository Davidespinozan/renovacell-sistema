// CS-DEPLOY-03B-FIX · guardas de esquema y de configuración de las Edges CyberSource:
//   1) toda columna que una Edge cs-* lee con .from('tabla').select('…') existe en el contrato de tipos del esquema (database.types.ts,
//      cuyas entradas CyberSource se tomaron del esquema remoto regenerado). Detecta referencias a columnas inexistentes como la que
//      hubo con profiles.phone.
//   2) supabase/config.toml declara cs-3ds-return sin JWT y NO declara ninguna otra función cs-* (conservan la verificación por defecto).
import { describe, it, expect } from 'vitest'
import tipos from '../database.types.ts?raw'
import config from '../../../../../supabase/config.toml?raw'
import ccIndex from '../../../../../supabase/functions/cs-capture-context/index.ts?raw'
import ccContrato from '../../../../../supabase/functions/cs-capture-context/contrato.ts?raw'
import tdsIndex from '../../../../../supabase/functions/cs-3ds/index.ts?raw'
import tdsContrato from '../../../../../supabase/functions/cs-3ds/contrato.ts?raw'
import retIndex from '../../../../../supabase/functions/cs-3ds-return/index.ts?raw'
import pagoIndex from '../../../../../supabase/functions/cs-pago/index.ts?raw'
import pagoContrato from '../../../../../supabase/functions/cs-pago/contrato.ts?raw'
import concIndex from '../../../../../supabase/functions/cs-conciliar/index.ts?raw'
import concContrato from '../../../../../supabase/functions/cs-conciliar/contrato.ts?raw'

const EDGES: Record<string, string> = { 'cs-capture-context': ccIndex + ccContrato, 'cs-3ds': tdsIndex + tdsContrato, 'cs-3ds-return': retIndex, 'cs-pago': pagoIndex + pagoContrato, 'cs-conciliar': concIndex + concContrato }

/** Columnas del Row de una tabla o vista en database.types.ts (Tables y Views comparten la forma `nombre: { Row: { col: tipo … } }`). */
function columnasRow(tabla: string): string[] {
  const m = new RegExp(`^      ${tabla}: \\{\\n        Row: \\{\\n([\\s\\S]*?)^        \\}`, 'm').exec(tipos)
  if (!m) throw new Error(`tabla/vista ${tabla} no está en database.types.ts`)
  return [...m[1].matchAll(/^          ([A-Za-z_0-9]+)\??:/gm)].map((x) => x[1])
}
/** Lecturas de cada Edge: `.from('tabla').select('a, b, c')` con columnas simples (sin embebidos). */
function lecturas(src: string): Array<{ tabla: string; columnas: string[] }> {
  return [...src.matchAll(/\.from\('([a-z_]+)'\)\s*\.select\('([^']+)'\)/g)].map((m) => ({ tabla: m[1], columnas: m[2].split(',').map((c) => c.trim()).filter(Boolean) }))
}

describe('CS · esquema: las Edges solo leen columnas que existen', () => {
  for (const [edge, src] of Object.entries(EDGES)) {
    it(`${edge}: columnas leídas presentes en el contrato de tipos`, () => {
      const ls = lecturas(src)
      for (const l of ls) {
        const cols = columnasRow(l.tabla)
        for (const c of l.columnas) {
          expect(c, `${edge} lee ${l.tabla}.${c}`).not.toMatch(/[()*]/)   // sin embebidos ni comodines: cada columna se verifica
          expect(cols, `${edge}: ${l.tabla}.${c} no existe`).toContain(c)
        }
      }
    })
  }
  it('cs-3ds y cs-pago leen del perfil solo nombre y correo (profiles no tiene teléfono); el teléfono sale del domicilio o del cliente', () => {
    expect(columnasRow('profiles')).not.toContain('phone')
    expect(columnasRow('customers')).toContain('phone')
    for (const src of [tdsIndex, pagoIndex]) {
      const l = lecturas(src).find((x) => x.tabla === 'profiles')
      expect(l?.columnas).toEqual(['full_name', 'email'])
      expect(src).toMatch(/phone: String\(address\?\.phone \?\? cliente\.phone \?\? ''\)/)
      expect(src).not.toMatch(/perfil\.phone/)
    }
  })
  it('las tablas y RPC CyberSource del contrato de tipos coinciden con las migraciones 184–187', () => {
    for (const t of ['card_payment_attempts', 'card_payment_attempt_events', 'v_order_disponible']) expect(columnasRow(t).length).toBeGreaterThan(5)
    for (const f of ['cs_intento_abrir', 'cs_intento_avanzar', 'cs_intento_contabilizar', 'cs_intento_cerrar_manual', 'cs_reservas_activas', 'cs_intentos_expirar', 'saldo_disponible']) expect(tipos, f).toMatch(new RegExp(`^      ${f}: \\{`, 'm'))
    // y las Edges no invocan ninguna RPC cs_* que no esté en el contrato
    const rpcs = new Set(Object.values(EDGES).flatMap((s) => [...s.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1])))
    for (const r of rpcs) expect(tipos, `RPC ${r}`).toMatch(new RegExp(`^      ${r}: \\{`, 'm'))
  })
})

describe('CS · config.toml: JWT por función', () => {
  it('cs-3ds-return declarada sin JWT; ninguna otra cs-* declarada (JWT por defecto)', () => {
    expect(config).toMatch(/^\[functions\.cs-3ds-return\]\nverify_jwt = false$/m)
    const declaradas = [...config.matchAll(/^\[functions\.([a-z0-9-]+)\]/gm)].map((m) => m[1])
    expect(declaradas.filter((d) => d.startsWith('cs-'))).toEqual(['cs-3ds-return'])
    for (const f of ['cs-capture-context', 'cs-3ds', 'cs-pago', 'cs-conciliar']) expect(declaradas).not.toContain(f)
  })
})
