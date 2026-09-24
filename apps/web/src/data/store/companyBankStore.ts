// Cuentas bancarias de Renovacell (varias). Reemplaza el modelo 1:1 de
// company_settings. Con backend lee/escribe company_bank_accounts (RLS: staff ve
// activas, admin muta). Sin backend, opera sobre un mock local. Alimenta el modal
// de transferencia del doctor y el editor de Configuración.
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'

export interface BankAccount {
  id: string
  bank_name: string
  beneficiary_name: string
  clabe: string | null
  account_number: string | null
  active: boolean
  is_default: boolean
  display_order: number
}

// Mock: vacío (sin backend no hay cuentas capturadas; el modal cae a "contáctanos").
const MOCK: BankAccount[] = []

const SELECT = 'id, bank_name, beneficiary_name, clabe, account_number, active, is_default, display_order'
const order = (a: BankAccount, b: BankAccount) =>
  a.display_order - b.display_order || a.bank_name.localeCompare(b.bank_name)

const live = makeLive<BankAccount>(async () => {
  const { data, error } = await supabase.from('company_bank_accounts').select(SELECT)
  if (error) throw error
  return (data as BankAccount[]).slice().sort(order)
}, MOCK)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot
export const bankReady = live.ready

// CLABE válida: 18 dígitos (o vacía).
export const clabeValida = (clabe: string): boolean => clabe.trim() === '' || /^\d{18}$/.test(clabe.trim())

// Cuentas ACTIVAS, principal primero, para mostrar al doctor.
export function activeBankAccounts(): BankAccount[] {
  return live.current().filter((a) => a.active).sort((a, b) => Number(b.is_default) - Number(a.is_default) || order(a, b))
}
export function allBankAccounts(): BankAccount[] { return live.current().slice().sort(order) }
export function defaultBankAccount(): BankAccount | null {
  return activeBankAccounts()[0] ?? null
}

const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : `ba-${Math.random().toString(36).slice(2)}`)

export interface BankAccountInput {
  bank_name: string
  beneficiary_name: string
  clabe?: string | null
  account_number?: string | null
  active?: boolean
  is_default?: boolean
  display_order?: number
}

export function addBankAccount(input: BankAccountInput): void {
  const list = live.current()
  const row: BankAccount = {
    id: uuid(), bank_name: input.bank_name.trim(), beneficiary_name: input.beneficiary_name.trim(),
    clabe: (input.clabe ?? '').trim() || null, account_number: (input.account_number ?? '').trim() || null,
    active: input.active ?? true, is_default: input.is_default ?? list.length === 0,
    display_order: input.display_order ?? list.length,
  }
  live.setLocal([...list, row])
  logAudit({ actor: 'Administración', action: 'Cuenta bancaria agregada', resource: row.bank_name })
  if (hasSupabase) {
    const persist = async () => {
      if (row.is_default) await supabase.from('company_bank_accounts').update({ is_default: false }).eq('is_default', true)
      const { error } = await supabase.from('company_bank_accounts').insert({
        id: row.id, bank_name: row.bank_name, beneficiary_name: row.beneficiary_name, clabe: row.clabe,
        account_number: row.account_number, active: row.active, is_default: row.is_default, display_order: row.display_order,
      })
      if (error) console.warn('[bank] insert', error.message)
      live.reload()
    }
    void persist()
  }
}

export function updateBankAccount(id: string, patch: Partial<BankAccountInput>): void {
  const clean: Partial<BankAccount> = { ...patch } as Partial<BankAccount>
  if (patch.clabe !== undefined) clean.clabe = (patch.clabe ?? '').trim() || null
  if (patch.account_number !== undefined) clean.account_number = (patch.account_number ?? '').trim() || null
  live.setLocal(live.current().map((a) => (a.id === id ? { ...a, ...clean } : a)))
  logAudit({ actor: 'Administración', action: 'Cuenta bancaria actualizada', resource: id })
  if (hasSupabase) {
    supabase.from('company_bank_accounts').update({ ...clean, updated_at: new Date().toISOString() } as never).eq('id', id)
      .then(({ error }) => { if (error) console.warn('[bank] update', error.message); live.reload() })
  }
}

// Marca una cuenta como principal (desmarca la anterior). Solo activas.
export function setDefaultBankAccount(id: string): void {
  live.setLocal(live.current().map((a) => ({ ...a, is_default: a.id === id })))
  logAudit({ actor: 'Administración', action: 'Cuenta principal actualizada', resource: id })
  if (hasSupabase) {
    const run = async () => {
      await supabase.from('company_bank_accounts').update({ is_default: false }).eq('is_default', true)
      const { error } = await supabase.from('company_bank_accounts').update({ is_default: true, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) console.warn('[bank] setDefault', error.message)
      live.reload()
    }
    void run()
  }
}

// Activar/desactivar (las inactivas no se muestran al doctor; no se borra historial).
export function setBankActive(id: string, active: boolean): void {
  updateBankAccount(id, { active })
}
