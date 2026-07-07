// Lógica de doctores (gate de cédula), prospectos y envíos (modo mock).
import { describe, it, expect } from 'vitest'
import * as doctors from './doctorsStore'
import * as prospects from './prospectsStore'
import * as ship from './shipmentsStore'

describe('doctorsStore — verificación con cédula', () => {
  it('NO verifica a un doctor sin cédula', () => {
    const d = doctors.addDoctor({ full_name: 'Dra. Sin Cédula', email: 'sincedula@x.mx', organization: null })
    expect(doctors.setVerified(d.id, true)).toBe(false)
    expect(doctors.getSnapshot().find((x) => x.id === d.id)?.verified).toBe(false)
  })
  it('verifica una vez que se captura la cédula', () => {
    const d = doctors.addDoctor({ full_name: 'Dra. Con Cédula', email: 'concedula@x.mx', organization: null })
    doctors.setCedula(d.id, '1234567')
    expect(doctors.setVerified(d.id, true)).toBe(true)
    expect(doctors.getSnapshot().find((x) => x.id === d.id)?.verified).toBe(true)
  })
})

describe('prospectsStore', () => {
  it('addProspect lo agrega al pipeline', () => {
    const p = prospects.addProspect({ name: 'Dr. Prospecto QA', email: 'prosp@x.mx', phone: null, clinic: null, interest: null, source: 'landing' } as never)
    expect(prospects.getSnapshot().some((x) => x.id === p.id)).toBe(true)
  })
  it('setStatus cambia el estatus del prospecto', () => {
    const p = prospects.addProspect({ name: 'Dr. Estatus QA', email: 'est@x.mx', phone: null, clinic: null, interest: null, source: 'landing' } as never)
    prospects.setStatus(p.id, 'contactado')
    expect(prospects.getSnapshot().find((x) => x.id === p.id)?.status).toBe('contactado')
  })
})

describe('shipmentsStore', () => {
  it('createShipment crea un envío', () => {
    const s = ship.createShipment({ order_id: 'o-x', carrier: 'Estafeta', tracking_number: 'T1', driver_id: null, estimated_delivery_at: null, status: 'assigned' })
    expect(ship.getSnapshot().some((x) => x.id === s.id)).toBe(true)
  })
  it('dispatchShipment lo pasa a despachado', () => {
    const s = ship.createShipment({ order_id: 'o-y', carrier: null, tracking_number: null, driver_id: null, estimated_delivery_at: null, status: 'assigned' })
    ship.dispatchShipment(s.id, 'Empaque', 'S-Y')
    expect(ship.getSnapshot().find((x) => x.id === s.id)?.status).toBe('despachado')
  })
  it('markDelivered marca entregado con la prueba', () => {
    const s = ship.createShipment({ order_id: 'o-z', carrier: null, tracking_number: null, driver_id: null, estimated_delivery_at: null, status: 'out_for_delivery' })
    ship.markDelivered(s.id, 'http://x/proof.png', 'Recepción')
    const got = ship.getSnapshot().find((x) => x.id === s.id)
    expect(got?.status).toBe('delivered')
    expect(got?.proof_image_url).toBe('http://x/proof.png')
  })
})
