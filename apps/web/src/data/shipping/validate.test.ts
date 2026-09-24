import { describe, it, expect } from 'vitest'
import { validatePackage, validateReceiver, validateShipper, missingForShipment } from './validate'
import { shipperFromCompany } from './shipper'
import { EMPTY_COMPANY } from '../store/companyStore'
import type { LogisticsPackage, Receiver, ShipperConfig } from './model'

const okPkg: LogisticsPackage = { weightKg: 2.5, lengthCm: 30, widthCm: 20, heightCm: 15, pieces: 1 }
const okReceiver: Receiver = { name: 'Dra. Ana', address: { line1: 'Calle 1 #23', cp: '06700', city: 'CDMX', state: 'CDMX', phone: '5551234567' } }
const okShipper: ShipperConfig = { name: 'Renovacell', addressLine1: 'Blvd 1', cp: '80020', city: 'Culiacán', state: 'Sinaloa', country: 'MX', phone: '6671002000', email: 'ops@renovacell.mx' }

describe('validatePackage — sin defaults silenciosos', () => {
  it('paquete completo → 0 faltantes', () => { expect(validatePackage(okPkg)).toEqual([]) })
  it('vacío → reporta peso/dims/piezas', () => {
    const m = validatePackage({})
    expect(m).toContain('peso (kg)'); expect(m).toContain('largo (cm)'); expect(m).toContain('ancho (cm)')
    expect(m).toContain('alto (cm)'); expect(m).toContain('número de piezas')
  })
  it('peso 0 o negativo → inválido', () => {
    expect(validatePackage({ ...okPkg, weightKg: 0 })).toContain('peso (kg)')
    expect(validatePackage({ ...okPkg, weightKg: -1 })).toContain('peso (kg)')
  })
  it('piezas no entero → inválido', () => { expect(validatePackage({ ...okPkg, pieces: 1.5 })).toContain('número de piezas') })
})

describe('validateReceiver — sale del snapshot del pedido', () => {
  it('completo → 0 faltantes', () => { expect(validateReceiver(okReceiver)).toEqual([]) })
  it('sin CP → bloquea con CP exacto (nunca 80000)', () => {
    const m = validateReceiver({ ...okReceiver, address: { ...okReceiver.address, cp: '' } })
    expect(m).toContain('código postal (CP) de entrega')
  })
  it('sin nombre/calle/ciudad/teléfono → los reporta', () => {
    const m = validateReceiver({ name: '', address: { line1: '' } })
    expect(m).toContain('nombre del destinatario')
    expect(m).toContain('calle/dirección de entrega')
    expect(m).toContain('ciudad de entrega')
    expect(m).toContain('teléfono de entrega')
  })
})

describe('validateShipper / shipperFromCompany', () => {
  it('shipper completo → 0 faltantes', () => { expect(validateShipper(okShipper)).toEqual([]) })
  it('company vacía → reporta todos los campos del remitente', () => {
    const { config, missing } = shipperFromCompany(EMPTY_COMPANY)
    expect(config.country).toBe('MX') // país por defecto de config (no por-envío)
    expect(missing).toContain('remitente: razón social')
    expect(missing).toContain('remitente: CP')
    expect(missing).toContain('remitente: ciudad')
    expect(missing).toContain('remitente: email')
  })
  it('shipper sale del ORIGEN DE ENVÍOS (shipping_*), NO del fiscal', () => {
    // Solo datos FISCALES cargados → el shipper sigue incompleto (sin fallback).
    const soloFiscal = { ...EMPTY_COMPANY, razon_social: 'Renovacell', direccion: 'Blvd Fiscal', cp: '80000' }
    expect(shipperFromCompany(soloFiscal).missing.length).toBeGreaterThan(0)
    // Origen de envíos capturado → shipper válido.
    const conOrigen = { ...EMPTY_COMPANY,
      shipping_name: 'Renovacell Bodega', shipping_address: 'Blvd 1', shipping_cp: '80020',
      shipping_city: 'Culiacán', shipping_state: 'Sinaloa', shipping_country: 'MX',
      shipping_phone: '6671002000', shipping_email: 'ops@renovacell.mx' }
    const { config, missing } = shipperFromCompany(conOrigen)
    expect(missing).toEqual([])
    expect(config.addressLine1).toBe('Blvd 1') // usó shipping_address, no direccion fiscal
  })
})

describe('missingForShipment — combina todo', () => {
  it('todo OK → 0 faltantes', () => {
    expect(missingForShipment({ shipper: okShipper, receiver: okReceiver, pkg: okPkg })).toEqual([])
  })
  it('faltan datos en varias secciones → los lista todos', () => {
    const m = missingForShipment({ shipper: { ...okShipper, cp: '' }, receiver: { ...okReceiver, address: { ...okReceiver.address, cp: '' } }, pkg: { ...okPkg, weightKg: 0 } })
    expect(m).toContain('remitente: CP')
    expect(m).toContain('código postal (CP) de entrega')
    expect(m).toContain('peso (kg)')
  })
})
