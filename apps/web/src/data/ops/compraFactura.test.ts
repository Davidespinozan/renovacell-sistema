// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { leerXmlCfdi, sugerirProducto } from './compraFactura'
import { normalizarFactura } from '../../../../../supabase/functions/_shared/facturaProveedor'
import mig from '../../../../../supabase/migrations/20270408040000_compras_con_factura.sql?raw'

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="A" Folio="1520" Fecha="2026-11-20T10:11:12" SubTotal="21000.00" Total="24360.00">
  <cfdi:Emisor Rfc="DME010101AB1" Nombre="DISTRIBUIDORA MEDICA SA DE CV" RegimenFiscal="601"/>
  <cfdi:Conceptos>
    <cfdi:Concepto NoIdentificacion="NAB100" Descripcion="NABOTA 100 UI" Cantidad="20" ValorUnitario="900.00" Importe="18000.00"><cfdi:Impuestos/></cfdi:Concepto>
    <cfdi:Concepto Descripcion="Xeomeen 100 U" Cantidad="1" ValorUnitario="3000" Importe="3000"/>
  </cfdi:Conceptos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="6f0a1c2e-1111-2222-3333-444455556666"/></cfdi:Complemento>
</cfdi:Comprobante>`

describe('compra con factura de proveedor', () => {
  it('lee el XML del CFDI: proveedor, folio, UUID, fecha y renglones', () => {
    const f = leerXmlCfdi(XML)!
    expect(f.proveedor).toBe('DISTRIBUIDORA MEDICA SA DE CV'); expect(f.rfc).toBe('DME010101AB1')
    expect(f.folio).toBe('A-1520'); expect(f.uuid).toBe('6F0A1C2E-1111-2222-3333-444455556666'); expect(f.fecha).toBe('2026-11-20')
    expect(f.renglones).toEqual([
      { clave: 'NAB100', descripcion: 'NABOTA 100 UI', cantidad: 20, costo_unitario: 900, importe: 18000 },
      { clave: null, descripcion: 'Xeomeen 100 U', cantidad: 1, costo_unitario: 3000, importe: 3000 },
    ])
    expect(leerXmlCfdi('<hola/>')).toBeNull()
  })
  it('sugiere el producto: equivalencia guardada primero, luego el nombre parecido', () => {
    const productos = [{ id: 'p-nab', name: 'NABOTA 100 UI', sku: 'TOX-007' }, { id: 'p-xeo', name: 'Xeomeen 100 UI', sku: 'TOX-002' }, { id: 'p-nab200', name: 'NABOTA 200 UI', sku: 'TOX-008' }]
    const r = (descripcion: string, clave: string | null = null) => ({ clave, descripcion, cantidad: 1, costo_unitario: 1, importe: null })
    expect(sugerirProducto(r('cualquier cosa', 'NAB100'), 'DME010101AB1', productos, [{ proveedor_rfc: 'DME010101AB1', clave: 'NAB100', product_id: 'p-nab200' }])).toBe('p-nab200')
    expect(sugerirProducto(r('NABOTA 100 UI caja'), null, productos, [])).toBe('p-nab')
    expect(sugerirProducto(r('Guantes de nitrilo'), null, productos, [])).toBeNull()
  })
  it('la lectura de la IA se limpia: sin cantidad se descarta, el costo sale del importe', () => {
    const f = normalizarFactura({ proveedor: ' X ', renglones: [{ descripcion: 'A', cantidad: 2, importe: 100 }, { descripcion: 'B', cantidad: 0 }] })
    expect(f.renglones).toEqual([{ clave: null, descripcion: 'A', cantidad: 2, costo_unitario: 50, importe: 100 }])
  })
  it('servidor: factura única por UUID, solo Dirección/Facturación, renglones como órdenes por recibir', () => {
    expect(mig).toMatch(/create unique index uq_compras_factura_uuid/)
    expect(mig).toMatch(/if v_role not in \('admin', 'billing'\) then raise exception 'NO_AUTORIZADO/)
    expect(mig).toMatch(/insert into public\.replenishments \(.*compra_id\)/)
  })
})
