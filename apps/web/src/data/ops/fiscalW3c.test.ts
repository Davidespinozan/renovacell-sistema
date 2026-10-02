// W3-C · C1 — Invariantes del catálogo fiscal, leídos del fuente SQL.
//
// Lo que se protege: que la autoridad fiscal sea HUMANA y por producto. El catálogo real
// de Renovacell es heterogéneo —Medicamentos, Toxinas y Anestésicos conviven con Sérum,
// Peeling y Aparatología—, así que cualquier valor de respaldo sería un error fiscal
// esperando ocurrir. Aquí se verifica que no exista ninguno.
import { describe, it, expect } from 'vitest'
import { w1Message } from './w1Command'
import c1Src from '../../../../../supabase/migrations/20261018120000_w3c_c1_catalogo_fiscal.sql?raw'
import cmdSrc from '../../../../../supabase/migrations/20261018120100_w3c_c1_comandos.sql?raw'
import downSrc from '../../../../../supabase/rollback/w3c/99_down.sql?raw'
import c2Src from '../../../../../supabase/migrations/20261019120000_w3c_c2_evidencia.sql?raw'

const soloCodigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('la autoridad fiscal es humana y por producto', () => {
  it('solo validar_fiscal_producto pone validado = true', () => {
    // La forma de ASIGNACIÓN, para no contar la mención dentro de un comment on.
    const asignaciones = soloCodigo(cmdSrc).match(/set validado = true/g) ?? []
    expect(asignaciones).toHaveLength(1)
    const i = cmdSrc.indexOf('create function public.validar_fiscal_producto')
    const j = cmdSrc.indexOf('create function public.invalidar_fiscal_producto')
    expect(cmdSrc.slice(i, j)).toMatch(/validado = true/)
  })
  it('no existe validación en lote', () => {
    expect(cmdSrc).not.toMatch(/validar_todos|validate_all|validar_lote/i)
  })
  it('un producto validado tiene siempre configuración completa y firma humana', () => {
    expect(c1Src).toMatch(/ck_pf_validado_completo/)
    expect(c1Src).toMatch(/validado_por is not null and validado_at is not null/)
  })
  it('aplicar candidatos jamás valida, y lo declara en su resultado', () => {
    expect(cmdSrc).toMatch(/'validados_por_esta_operacion', 0/)
    const i = cmdSrc.indexOf('create function public.aplicar_defaults_categoria')
    expect(cmdSrc.slice(i)).not.toMatch(/validado = true/)
  })
  it('los candidatos solo rellenan huecos de productos NO validados', () => {
    expect(cmdSrc).toMatch(/where pf\.product_id = r\.id and not pf\.validado/)
    expect(cmdSrc).toMatch(/coalesce\(pf\.clave_prod_serv, d\.clave_prod_serv\)/)
  })
})

describe('invalidación automática por cambio material', () => {
  it('vive en el trigger, no en el comando: ningún comando futuro puede olvidarla', () => {
    expect(c1Src).toMatch(/create function public\.product_fiscal_guard/)
    expect(c1Src).toMatch(/if v_material and old\.validado and new\.validado then/)
    expect(c1Src).toMatch(/new\.validado\s*:=\s*false/)
    expect(c1Src).toMatch(/new\.validado_por := null/)
  })
  it('los seis campos materiales están enumerados', () => {
    for (const f of ['clave_prod_serv', 'clave_unidad', 'objeto_imp',
                     'tratamiento_iva', 'iva_tasa', 'descripcion_fiscal']) {
      expect(c1Src).toMatch(new RegExp(`new\\.${f}\\s+is distinct from old\\.${f}`))
    }
  })
  it('notas y fuente NO son materiales: documentan, no deciden', () => {
    const i = c1Src.indexOf('v_material :=')
    const j = c1Src.indexOf(';', i)
    const expr = c1Src.slice(i, j)
    expect(expr).not.toMatch(/notas/)
    expect(expr).not.toMatch(/fuente/)
  })
})

describe('no hay valores de respaldo ni supuestos fiscales', () => {
  it('ninguna migración de C1 contiene una tasa, una clave SAT o un método de pago', () => {
    for (const src of [c1Src, cmdSrc]) {
      expect(soloCodigo(src)).not.toMatch(/0\.16(?!0)/)
      expect(soloCodigo(src)).not.toMatch(/51241100/)
      expect(soloCodigo(src)).not.toMatch(/'PUE'|'PPD'/)
      expect(soloCodigo(src)).not.toMatch(/'H87'/)
    }
  })
  it('NO existe un interruptor que cambie el significado económico del catálogo', () => {
    // Corrección 2 del dueño: el precio final es invariante del negocio.
    for (const src of [c1Src, cmdSrc]) {
      expect(src).not.toMatch(/precio_es_final|precio_incluye_iva|precio_incluye_impuesto/)
    }
  })
  it('tasa cero y exento no se confunden, por constraint', () => {
    expect(c1Src).toMatch(/tratamiento_iva = 'tasa_cero' and iva_tasa is not null and iva_tasa = 0/)
    expect(c1Src).toMatch(/tratamiento_iva in \('exento','no_objeto'\) and iva_tasa is null/)
  })
  it('la evidencia histórica se documenta como evidencia de PRECIO, no de impuesto', () => {
    expect(c1Src).toMatch(/HISTORICAL_EQUALS_FINAL no (significa|autoriza)/)
    expect(c1Src).toMatch(/evidencia de PRECIO/)
  })
  it('un campo desconocido se rechaza en vez de ignorarse', () => {
    expect(cmdSrc).toMatch(/CAMPO_FISCAL_DESCONOCIDO/)
    expect(cmdSrc).toMatch(/k <> all \(public\._pf_campos_editables\(\)\)/)
  })
})

describe('C1 no interfiere con W3-A/W3-B', () => {
  it('no toca precios comerciales ni el maestro de productos', () => {
    for (const src of [c1Src, cmdSrc]) {
      expect(soloCodigo(src)).not.toMatch(/update public\.products\b/)
      expect(soloCodigo(src)).not.toMatch(/update public\.product_prices/)
      expect(soloCodigo(src)).not.toMatch(/update public\.product_volume_prices/)
    }
  })
  it('no crea ni modifica documentos fiscales, ni asigna folio', () => {
    for (const src of [c1Src, cmdSrc]) {
      expect(soloCodigo(src)).not.toMatch(/insert into public\.fiscal_documents/)
      expect(soloCodigo(src)).not.toMatch(/update public\.fiscal_documents/)
      expect(soloCodigo(src)).not.toMatch(/_w3_asignar_folio|fiscal_folio_domains/)
      expect(soloCodigo(src)).not.toMatch(/solicitar_cfdi|reclamar_cfdi|registrar_resultado_cfdi/)
    }
  })
  it('no sale a la red ni menciona al proveedor', () => {
    for (const src of [c1Src, cmdSrc]) {
      expect(soloCodigo(src).toLowerCase()).not.toMatch(/https?:\/\/|facturama/)
    }
  })
  it('reutiliza el registro de idempotencia de W3 en vez de duplicarlo', () => {
    expect(cmdSrc).toMatch(/_w3_op_begin\(p_op_id, 'pf_/)
    expect(cmdSrc).toMatch(/_w3_op_finish\(p_op_id, 'pf_/)
    expect(c1Src).toMatch(/alter table public\.fiscal_operations add constraint ck_fiscal_op_kind/)
  })
  it('documenta el invariante que C4 deberá respetar: el renglón, no la unidad', () => {
    expect(c1Src).toMatch(/importe_final_renglon = cantidad × precio_unitario/)
    expect(c1Src).toMatch(/nunca contra una sola\s*\n--\s*unidad/)
    expect(c1Src).toMatch(/NO se recalcula desde el catálogo/)
    expect(c1Src).toMatch(/falla cerrado/)
  })
})

describe('rollback y mensajes de operador', () => {
  it('el rollback aborta si existe validación humana', () => {
    expect(downSrc).toMatch(/ROLLBACK_ABORTADO/)
    expect(downSrc).toMatch(/No se borra el trabajo del contador/)
  })
  it('todo código alcanzable por el operador tiene mensaje en español', () => {
    const codigos = ['FISCAL_PRODUCTO_SOLO_POR_COMANDO', 'FISCAL_PRODUCTO_SIN_CONFIGURAR',
                     'FISCAL_CONFIGURACION_INCOMPLETA', 'FUENTE_REQUERIDA',
                     'CAMPO_FISCAL_DESCONOCIDO', 'DEFAULTS_CATEGORIA_INEXISTENTES']
    const constraints = ['ck_pf_tasa', 'ck_pf_clave_prod', 'ck_pf_tratamiento',
                         'ck_pf_objeto', 'ck_pf_clave_unidad', 'ck_pf_validado_completo']
    for (const c of codigos.concat(constraints)) {
      const m = c.startsWith('ck_')
        ? w1Message(`new row for relation "product_fiscal" violates check constraint "${c}"`)
        : w1Message(`${c}: detalle del servidor`)
      expect(m.length).toBeGreaterThan(20)
      expect(m).not.toMatch(new RegExp(c))
      expect(m).not.toMatch(/product_fiscal|public\.|jsonb/)
    }
  })
  it('el mensaje de tasa explica la diferencia entre tasa cero y exento', () => {
    // Forma REAL del mensaje de Postgres, que es la que llega del servidor.
    const m = w1Message('new row for relation "product_fiscal" violates check constraint "ck_pf_tasa"')
    expect(m).toMatch(/tasa cero/)
    expect(m).toMatch(/exento/)
    expect(m).not.toMatch(/product_fiscal|constraint/)
  })
})

// ── W3-C · C2 — la evidencia de precio no autoriza nada fiscal ───────────────────────────
describe('C2 · evidencia histórica de PRECIO, nunca de impuesto', () => {
  it('declara explícitamente lo que las clasificaciones NO significan', () => {
    expect(c2Src).toMatch(/HISTORICAL_EQUALS_FINAL\s+≠\s+exento/)
    expect(c2Src).toMatch(/HISTORICAL_BASE_PLUS_16\s+≠\s+tratamiento de IVA al 16% autorizado/)
    expect(c2Src).toMatch(/NUNCA se deduce ObjetoImp, gravado, tasa cero, exento, no objeto, tasa de IVA/)
  })
  it('el importador no escribe NINGÚN campo fiscal', () => {
    const i = c2Src.indexOf('create function public.importar_evidencia_precios')
    const cuerpo = soloCodigo(c2Src.slice(i))
    for (const campo of ['clave_prod_serv', 'clave_unidad', 'objeto_imp', 'tratamiento_iva', 'iva_tasa']) {
      expect(cuerpo).not.toMatch(new RegExp(`${campo}\\s*=`))
    }
    expect(cuerpo).not.toMatch(/validado\s*=\s*true/)
  })
  it('declara el invariante duro en su propio resultado', () => {
    expect(c2Src).toMatch(/'validados_por_esta_importacion', 0/)
    expect(c2Src).toMatch(/count\(product_fiscal where validado\) = 0/)
  })
  it('no empareja productos en tiempo de ejecución: recibe el mapeo revisado', () => {
    expect(c2Src).toMatch(/Nada de emparejamiento difuso/)
    const i = c2Src.indexOf('create function public.importar_evidencia_precios')
    const cuerpo = soloCodigo(c2Src.slice(i))
    expect(cuerpo).not.toMatch(/similarity|levenshtein|ilike|~\*/)
  })
  it('una fila sin mapeo conserva su evidencia y no inventa producto', () => {
    expect(c2Src).toMatch(/ck_fpe_mapeo_coherente/)
    expect(c2Src).toMatch(/'NO_MAPEADO' and product_id is null/)
    expect(c2Src).toMatch(/ck_fpe_motivo/)
  })
  it('preserva coincidencia DIRECTA vs a nivel de FAMILIA', () => {
    expect(c2Src).toMatch(/DIRECT_MATCH','FAMILY_LEVEL_MATCH/)
    expect(c2Src).toMatch(/ck_fpe_familia/)
    expect(c2Src).toMatch(/Hidrolizados, \n?--\s*Implantes|Hidrolizados/)
  })
  it('la evidencia es append-only y subordinada a la autoridad humana', () => {
    expect(c2Src).toMatch(/trg_fpe_append_only/)
    expect(c2Src).toMatch(/La evidencia es SUBORDINADA a la autoridad humana/)
  })
  it('no toca precios comerciales ni lo fiscal de W3-A\/B', () => {
    const cuerpo = soloCodigo(c2Src)
    expect(cuerpo).not.toMatch(/update public\.products\b/)
    expect(cuerpo).not.toMatch(/update public\.product_volume_prices|precio_de/)
    expect(cuerpo).not.toMatch(/insert into public\.fiscal_documents|_w3_asignar_folio/)
    expect(cuerpo.toLowerCase()).not.toMatch(/https?:\/\/|facturama/)
  })
  it('las excepciones de mayor revisión traen su advertencia', () => {
    expect(c2Src).toMatch(/NO significa exento, tasa cero ni no objeto/)
    expect(c2Src).toMatch(/no una autorización de tratamiento fiscal/)
  })
})
