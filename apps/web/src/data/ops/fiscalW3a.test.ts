// W3-A · El camino peligroso de CFDI ya no existe, y la configuración del PAC es fail-closed.
//
// Estas pruebas leen el CÓDIGO FUENTE (?raw) además de ejercitar las funciones puras: lo que
// se está protegiendo es la AUSENCIA de ciertas construcciones, y eso no se puede comprobar
// llamando a nada. Si alguien vuelve a introducir el POST al PAC o el borrado de evidencia
// desde el cliente, estas pruebas fallan.
import { describe, it, expect } from 'vitest'
import { resolverFacturama } from '../../../../../supabase/functions/_shared/facturama'
import { normFiscal, fiscalFaltantes, puedeTimbrar, cfdiYaTimbrado, lugarDeExpedicion } from '../../../../../supabase/functions/cfdi/rules'
import cfdiSrc from '../../../../../supabase/functions/cfdi/index.ts?raw'
import cancelSrc from '../../../../../supabase/functions/cfdi-cancel/index.ts?raw'
import cancelStatusSrc from '../../../../../supabase/functions/cfdi-cancel-status/index.ts?raw'
import downloadSrc from '../../../../../supabase/functions/cfdi-download/index.ts?raw'
import sendSrc from '../../../../../supabase/functions/cfdi-send/index.ts?raw'
import storeSrc from '../store/ordersStore.ts?raw'
import f1Src from '../../../../../supabase/migrations/20261016120000_w3a_f1_schema.sql?raw'
import f2Src from '../../../../../supabase/migrations/20261016120100_w3a_f2_constraints.sql?raw'
import f3Src from '../../../../../supabase/migrations/20261016120200_w3a_f3_commands.sql?raw'
import f4Src from '../../../../../supabase/migrations/20261016120300_w3a_f4_authority.sql?raw'

// Las aserciones de AUSENCIA deben mirar CÓDIGO, no prosa: los comentarios de W3-A citan a
// propósito el patrón que se eliminó (`invoice_meta = null`, `status:'timbrada'`) para que
// quien lea el archivo entienda qué se cerró. Sin esto, la documentación rompería la prueba.
const soloCodigo = (src: string): string =>
  src.split('\n').filter((l) => !/^\s*(\/\/|--|\*|\/\*)/.test(l)).join('\n')

const CFDI_FNS: [string, string][] = [
  ['cfdi-cancel', cancelSrc], ['cfdi-cancel-status', cancelStatusSrc],
  ['cfdi-download', downloadSrc], ['cfdi-send', sendSrc],
]

describe('P0 · el cliente ya no puede destruir evidencia fiscal', () => {
  it('ordersStore NO escribe invoice_meta: null en ninguna rama', () => {
    expect(soloCodigo(storeSrc)).not.toMatch(/invoice_meta:\s*null/)
  })
  it('ordersStore NO escribe invoice_meta hacia la base', () => {
    // Cualquier .update({... invoice_meta ...}) sobre orders desde el cliente está prohibido.
    const updates = storeSrc.match(/\.update\(\{[^}]*\}\)/g) ?? []
    expect(updates.filter((u) => /invoice_meta|invoice_requested/.test(u))).toEqual([])
  })
  it('ordersStore NO invoca la Edge Function de timbrado', () => {
    expect(storeSrc).not.toMatch(/functions\.invoke\('cfdi'/)
  })
  it('markInvoiced pasa por el comando del servidor', () => {
    expect(storeSrc).toMatch(/solicitarCFDI\(orderId\)/)
  })
  it('la guarda del pedido bloquea los campos fiscales con el código canónico', () => {
    expect(f4Src).toMatch(/NEW\.invoice_meta IS DISTINCT FROM OLD\.invoice_meta/)
    expect(f4Src).toMatch(/NEW\.invoice_requested IS DISTINCT FROM OLD\.invoice_requested/)
    expect(f4Src).toMatch(/FISCAL_SOLO_POR_COMANDO/)
  })
  it('el bloqueo fiscal ocurre ANTES del escape por rol admin', () => {
    const fiscal = f4Src.indexOf('FISCAL_SOLO_POR_COMANDO')
    const admin = f4Src.indexOf("IF r = 'admin' THEN RETURN NEW")
    expect(fiscal).toBeGreaterThan(-1)
    expect(admin).toBeGreaterThan(fiscal)
  })
  it('la guarda conserva verbatim los bloqueos de W2 (dinero) y W1 (transiciones)', () => {
    expect(f4Src).toMatch(/PAGO_SOLO_POR_COMANDO/)
    expect(f4Src).toMatch(/TRANSICION_SOLO_POR_COMANDO/)
    expect(f4Src).toMatch(/TRANSICION_REGRESIVA/)
  })
})

describe('CONTENCIÓN · la función cfdi no puede llegar al PAC', () => {
  it('no contiene ninguna salida de red', () => {
    expect(cfdiSrc).not.toMatch(/fetch\s*\(/)
  })
  it('no lee credenciales de Facturama', () => {
    expect(cfdiSrc).not.toMatch(/FACTURAMA_/)
  })
  it('no escribe nada sobre el pedido', () => {
    expect(cfdiSrc).not.toMatch(/\.update\(/)
  })
  it('responde bloqueado con un código explícito', () => {
    expect(cfdiSrc).toMatch(/423/)
    expect(cfdiSrc).toMatch(/w3_contencion/)
  })
  it('conserva el control de acceso (no es un endpoint abierto)', () => {
    expect(cfdiSrc).toMatch(/tieneRol\(q\.quien, \['admin', 'billing'\]\)/)
    // W6-A1: 401 (sin sesión) y 403 (suspendido) los responde resolverQuien; el 403 de rol sigue aquí.
    expect(cfdiSrc).toMatch(/if \(!q\.ok\) return json\(q\.status, q\.body\)/)
    expect(cfdiSrc).toMatch(/403/)
  })
  it('no persiste un timbre: la construcción del stamp desapareció', () => {
    expect(soloCodigo(cfdiSrc)).not.toMatch(/status:\s*'timbrada'/)
    expect(soloCodigo(cfdiSrc)).not.toMatch(/TaxStamp/)
  })
})

describe('FAIL-CLOSED · ninguna función del PAC cae a producción por defecto', () => {
  it.each(CFDI_FNS)('%s no tiene URL de producción por defecto', (_n, src) => {
    expect(src).not.toMatch(/\?\?\s*'https:\/\/api\.facturama\.mx'/)
    expect(src).not.toMatch(/FACTURAMA_URL/)
  })
  it.each(CFDI_FNS)('%s deriva la base del entorno declarado', (_n, src) => {
    expect(src).toMatch(/resolverFacturama\(Deno\.env\.get\('FACTURAMA_ENV'\)\)/)
    expect(src).toMatch(/if \(!fac\.ok\) return json\(501/)
  })
  it('FACTURAMA_ENV ausente ⇒ bloqueado, sin asumir producción', () => {
    for (const v of [undefined, null, '', '   ']) {
      const r = resolverFacturama(v)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe('config_incompleta')
        expect(r.message).toMatch(/no se asume producción/)
      }
    }
  })
  it('FACTURAMA_ENV inválido ⇒ bloqueado', () => {
    for (const v of ['staging', 'prod', 'produccion ', 'PRODUCTION', 'sandbox1']) {
      expect(resolverFacturama(v).ok).toBe(v === 'produccion ')
    }
  })
  it('sandbox deriva sandbox y produccion deriva producción', () => {
    const s = resolverFacturama('sandbox'); const p = resolverFacturama('PRODUCCION')
    expect(s).toEqual({ ok: true, entorno: 'sandbox', base: 'https://apisandbox.facturama.mx' })
    expect(p).toEqual({ ok: true, entorno: 'produccion', base: 'https://api.facturama.mx' })
  })
  it('la base NO se puede apuntar a un host arbitrario desde el entorno', () => {
    expect(resolverFacturama('https://evil.example.com').ok).toBe(false)
  })
})

describe('REGLAS PRESERVADAS · receptor canónico y gate de pago (entrada de W3-B)', () => {
  it('normaliza la forma nueva y la legacy, sin inventar nada', () => {
    expect(normFiscal({ rfc: ' xaxx010101000 ', razon_social: 'ACME', regimen: '601', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'A@B.COM' }))
      .toEqual({ rfc: 'XAXX010101000', razon_social: 'ACME', regimen: '601', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'a@b.com' })
    expect(normFiscal({ rfc: 'X', name: 'Legacy SA', taxRegime: '612', taxZip: '81000', cfdiUse: 'G01', email: 'L@x.com' }))
      .toEqual({ rfc: 'X', razon_social: 'Legacy SA', regimen: '612', cp: '81000', uso_cfdi: 'G01', email_facturacion: 'l@x.com' })
    expect(normFiscal(null).rfc).toBe('')
  })
  it('enumera lo que falta en lugar de rellenarlo', () => {
    expect(fiscalFaltantes(normFiscal({}))).toHaveLength(6)
    expect(fiscalFaltantes(normFiscal({ rfc: 'XAXX010101000' }))).not.toContain('RFC')
  })
  it('el gate de pago sigue existiendo como regla probada', () => {
    expect(puedeTimbrar({ payment_status: 'paid' })).toEqual({ ok: true })
    expect(puedeTimbrar({ payment_status: 'pending' })).toMatchObject({ ok: false, error: 'unpaid' })
    expect(puedeTimbrar(null)).toMatchObject({ ok: false, error: 'unpaid' })
  })
  it('la idempotencia del timbre exige UUID, no solo el estado', () => {
    expect(cfdiYaTimbrado({ status: 'timbrada', uuid: 'U-1' })).toEqual({ uuid: 'U-1', facturama_id: null })
    expect(cfdiYaTimbrado({ status: 'timbrada' })).toBeNull()
    expect(cfdiYaTimbrado({ status: 'timbrada', uuid: '' })).toBeNull()
    expect(cfdiYaTimbrado({ status: 'emitida', uuid: 'U-2' })).toBeNull()
  })
  it('el lugar de expedición nunca cae al CP del receptor', () => {
    expect(lugarDeExpedicion({ cp: '80000' })).toEqual({ ok: true, cp: '80000' })
    expect(lugarDeExpedicion({ cp: '  ' })).toMatchObject({ ok: false, error: 'missing_emisor' })
    expect(lugarDeExpedicion(null)).toMatchObject({ ok: false, error: 'missing_emisor' })
  })
})

describe('ESQUEMA · lo que hace imposible el P0 está en las migraciones', () => {
  it('timbrado ⇔ UUID, por constraint', () => {
    expect(f2Src).toMatch(/ck_fiscal_uuid_estado check \(\(uuid is not null\) = \(status in \('timbrado','cancelado'\)\)\)/)
  })
  it('el UUID tiene forma de folio fiscal y no acepta ceros', () => {
    expect(f2Src).toMatch(/ck_fiscal_uuid_formato/)
    expect(f2Src).toMatch(/0\{8\}-0\{4\}-0\{4\}-0\{4\}-0\{12\}/)
  })
  it('un solo documento VIVO por pedido', () => {
    expect(f2Src).toMatch(/create unique index uq_fiscal_doc_vivo/)
    expect(f2Src).toMatch(/where status in \('pendiente','en_proceso','timbrado','incierto'\)/)
  })
  it('un UUID no puede existir dos veces', () => {
    expect(f2Src).toMatch(/create unique index uq_fiscal_doc_uuid/)
  })
  it('todo comprobante con folio declara su entorno', () => {
    expect(f2Src).toMatch(/ck_fiscal_env_presente/)
    expect(f2Src).toMatch(/provider_env is null or provider_env in \('sandbox','produccion'\)/)
  })
  it('incierto no vuelve a en_proceso', () => {
    expect(f1Src).toMatch(/\('incierto',\s+'timbrado'\)/)
    expect(f1Src).toMatch(/\('incierto',\s+'fallido'\)/)
    expect(f1Src).not.toMatch(/\('incierto',\s*'en_proceso'\)/)
  })
  it('el reclamo es un UPDATE condicional (no un SELECT y luego escribir)', () => {
    expect(f3Src).toMatch(/where d\.id = p_doc and d\.status = v_from/)
    expect(f3Src).toMatch(/p_from_expected is not null and v_from <> p_from_expected/)
  })
  it('la proyección jamás declara timbrada sin UUID', () => {
    expect(f3Src).toMatch(/if d\.status in \('timbrado','cancelado'\) and d\.uuid is not null then/)
  })
  it('W3-A no llama a ningún proveedor desde la base', () => {
    // El nombre del proveedor SÍ aparece como dato (provider default 'facturama' y la clave
    // legacy facturama_id). Lo que no puede existir es una salida de red: ni URLs, ni las
    // extensiones con las que Postgres podría hacer peticiones.
    for (const src of [f1Src, f2Src, f3Src, f4Src]) {
      expect(src.toLowerCase()).not.toMatch(/https?:\/\//)
      expect(src).not.toMatch(/\bhttp_(get|post|delete|put)\b|\bpg_net\b|\bnet\.http/i)
    }
  })
  it('no se inventa política fiscal: IVA, ClaveProdServ ni serie quedan abiertos', () => {
    for (const src of [f1Src, f2Src, f3Src, f4Src]) {
      expect(src).not.toMatch(/0\.16/)
      expect(src).not.toMatch(/51241100/)
      expect(src).not.toMatch(/'PUE'|'PPD'/)
    }
    expect(f3Src).toMatch(/D-W3-1…4|D-W3-1…6/)
  })
  it('la huella material está versionada', () => {
    expect(f1Src).toMatch(/'w3a-1:' \|\| md5\(/)
  })
})
