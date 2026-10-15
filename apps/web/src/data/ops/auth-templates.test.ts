// CORREOS DE SUPABASE AUTH · las plantillas de supabase/templates/auth/*.html son las de PLANTILLAS_AUTH (mismo diseño de
// marca) y llevan la variable que llena Supabase. Si cambian, se regeneran con: GENERAR=1 npx vitest run auth-templates
import { describe, it, expect } from 'vitest'
// @ts-expect-error tipos de node no incluidos en el tsconfig del front (vitest corre en Node)
import { readFileSync, writeFileSync } from 'node:fs'
import { PLANTILLAS_AUTH } from '../../../../../supabase/functions/_shared/plantillas'

const dir = new URL('../../../../../supabase/templates/auth/', import.meta.url)
describe('Plantillas de los correos de Supabase Auth', () => {
  for (const [clave, p] of Object.entries(PLANTILLAS_AUTH)) {
    it(`${clave}: marca, español y el enlace de Supabase`, () => {
      const f = new URL(`${clave}.html`, dir)
      // @ts-expect-error process existe en Node (vitest)
      if (process.env.GENERAR) writeFileSync(f, p.html)
      const html = readFileSync(f, 'utf8')
      expect(html).toBe(p.html)
      expect(html).toMatch(/\{\{ \.ConfirmationURL \}\}/); expect(html).toMatch(/Tecnologías Antiedad/); expect(html).toMatch(/brand\/logo\.png/)
      expect(html).not.toMatch(/&#123;|&amp;#|Reset your password/)
    })
  }
})
