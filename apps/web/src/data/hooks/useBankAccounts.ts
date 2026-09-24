import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, addBankAccount, updateBankAccount, setDefaultBankAccount, setBankActive } from '../store/companyBankStore'
import type { BankAccount } from '../store/companyBankStore'

export function useBankAccounts(): {
  data: BankAccount[]
  addBankAccount: typeof addBankAccount
  updateBankAccount: typeof updateBankAccount
  setDefaultBankAccount: typeof setDefaultBankAccount
  setBankActive: typeof setBankActive
} {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, addBankAccount, updateBankAccount, setDefaultBankAccount, setBankActive }
}
