import { describe, it, expect } from 'vitest'
import {
  clabeValida, addBankAccount, activeBankAccounts, allBankAccounts,
  setDefaultBankAccount, setBankActive, defaultBankAccount,
} from './companyBankStore'

// En pruebas hasSupabase=false → el store opera sobre el cache local (setLocal).
// El cache es de módulo (persiste entre tests), por eso las aserciones son
// relativas/invariantes, no dependen de un estado inicial vacío.
describe('clabeValida', () => {
  it('18 dígitos válida; vacía válida; otras no', () => {
    expect(clabeValida('044730116039539474')).toBe(true)
    expect(clabeValida('')).toBe(true)
    expect(clabeValida('123')).toBe(false)
    expect(clabeValida('04473011603953947X')).toBe(false)
  })
})

describe('company_bank_accounts (mock)', () => {
  it('agrega cuenta activa y la deja consultable', () => {
    const before = allBankAccounts().length
    addBankAccount({ bank_name: 'Scotiabank-T', beneficiary_name: 'Renovacell', clabe: '044730116039539474' })
    const all = allBankAccounts()
    expect(all.length).toBe(before + 1)
    const nueva = all.find((a) => a.bank_name === 'Scotiabank-T')!
    expect(nueva.active).toBe(true)
    expect(nueva.clabe).toBe('044730116039539474')
  })

  it('INVARIANTE: como máximo una cuenta default; setDefault la reasigna', () => {
    addBankAccount({ bank_name: 'BBVA-T', beneficiary_name: 'Renovacell', clabe: '012180001234567895' })
    addBankAccount({ bank_name: 'Banorte-T', beneficiary_name: 'Renovacell', clabe: '072000001234567890' })
    const banorte = allBankAccounts().find((a) => a.bank_name === 'Banorte-T')!
    setDefaultBankAccount(banorte.id)
    expect(allBankAccounts().filter((a) => a.is_default).length).toBe(1)
    expect(allBankAccounts().find((a) => a.is_default)!.id).toBe(banorte.id)
    expect(defaultBankAccount()?.id).toBe(banorte.id) // la default activa es la principal
  })

  it('desactivar oculta de activas pero conserva el historial', () => {
    addBankAccount({ bank_name: 'HSBC-T', beneficiary_name: 'Renovacell', clabe: '021180001234567897' })
    const hsbc = allBankAccounts().find((a) => a.bank_name === 'HSBC-T')!
    setBankActive(hsbc.id, false)
    expect(activeBankAccounts().some((a) => a.id === hsbc.id)).toBe(false)
    expect(allBankAccounts().some((a) => a.id === hsbc.id)).toBe(true)
  })
})
