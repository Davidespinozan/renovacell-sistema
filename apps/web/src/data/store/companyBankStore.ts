// Cuentas bancarias de Renovacell (varias). Reemplaza el modelo 1:1 de
// company_settings. Con backend lee/escribe company_bank_accounts (RLS: staff ve
// activas, admin muta). Sin backend, opera sobre un mock local. Alimenta el modal
// de transferencia del doctor y el editor de Configuración.
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'
import { confirmar, type Escritura } from './escritura'

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

// W4: a estas cuentas transfiere el cliente. Una cuenta que Dirección cree haber
// cambiado y que el servidor rechazó significa dinero enviado al lugar equivocado.
export async function addBankAccount(input: BankAccountInput): Promise<Escritura> {
  const list = live.current()
  const row: BankAccount = {
    id: uuid(), bank_name: input.bank_name.trim(), beneficiary_name: input.beneficiary_name.trim(),
    clabe: (input.clabe ?? '').trim() || null, account_number: (input.account_number ?? '').trim() || null,
    active: input.active ?? true, is_default: input.is_default ?? list.length === 0,
    display_order: input.display_order ?? list.length,
  }
  if (hasSupabase) {
    if (row.is_default) {
      const d = await confirmar('quitar la cuenta principal anterior',
        supabase.from('company_bank_accounts').update({ is_default: false }).eq('is_default', true))
      if (!d.ok) return d
    }
    const r = await confirmar(`agregar la cuenta de ${row.bank_name}`,
      supabase.from('company_bank_accounts').insert({
        id: row.id, bank_name: row.bank_name, beneficiary_name: row.beneficiary_name, clabe: row.clabe,
        account_number: row.account_number, active: row.active, is_default: row.is_default, display_order: row.display_order,
      }))
    // Pase lo que pase se relee: si la inserción falló tras quitar la principal
    // anterior, la pantalla debe mostrar el estado REAL, no el que se quería.
    await live.reload()
    if (!r.ok) return r
  } else {
    live.setLocal([...list, row])
  }
  logAudit({ actor: 'Administración', action: 'Cuenta bancaria agregada', resource: row.bank_name })
  return { ok: true }
}

export async function updateBankAccount(id: string, patch: Partial<BankAccountInput>): Promise<Escritura> {
  const clean: Partial<BankAccount> = { ...patch } as Partial<BankAccount>
  if (patch.clabe !== undefined) clean.clabe = (patch.clabe ?? '').trim() || null
  if (patch.account_number !== undefined) clean.account_number = (patch.account_number ?? '').trim() || null
  if (hasSupabase) {
    const r = await confirmar('guardar la cuenta bancaria',
      supabase.from('company_bank_accounts').update({ ...clean, updated_at: new Date().toISOString() } as never).eq('id', id))
    if (!r.ok) { void live.reload(); return r }
  }
  live.setLocal(live.current().map((a) => (a.id === id ? { ...a, ...clean } : a)))
  logAudit({ actor: 'Administración', action: 'Cuenta bancaria actualizada', resource: id })
  return { ok: true }
}

// Marca una cuenta como principal (desmarca la anterior). Solo activas.
export async function setDefaultBankAccount(id: string): Promise<Escritura> {
  if (hasSupabase) {
    const a = await confirmar('quitar la cuenta principal anterior',
      supabase.from('company_bank_accounts').update({ is_default: false }).eq('is_default', true))
    if (!a.ok) { void live.reload(); return a }
    const b = await confirmar('marcar la cuenta como principal',
      supabase.from('company_bank_accounts').update({ is_default: true, updated_at: new Date().toISOString() }).eq('id', id))
    await live.reload()
    if (!b.ok) return b
  } else {
    live.setLocal(live.current().map((x) => ({ ...x, is_default: x.id === id })))
  }
  logAudit({ actor: 'Administración', action: 'Cuenta principal actualizada', resource: id })
  return { ok: true }
}

// Activar/desactivar (las inactivas no se muestran al doctor; no se borra historial).
export function setBankActive(id: string, active: boolean): Promise<Escritura> {
  return updateBankAccount(id, { active })
}
