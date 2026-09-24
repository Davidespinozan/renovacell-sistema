// DIRECCIÓN · Configuración de la empresa (emisor). Aquí se capturan los datos fiscales que
// necesita el CFDI (razón social, RFC, régimen SAT, lugar de expedición) y la identidad que
// aparece en recibos/manifiestos. Antes no existía dónde capturar al EMISOR del CFDI.
import React, { useMemo, useState, useEffect } from 'react'
import { Building2, Save, Plus, Star, Trash2, Copy } from 'lucide-react'
import { useCompany } from '../../data/hooks/useCompany'
import { useBankAccounts } from '../../data/hooks/useBankAccounts'
import { clabeValida, type BankAccount } from '../../data/store/companyBankStore'
import { REGIMENES_OPTIONS, esRegimenValido } from '../../data/sat/regimenesFiscales'

const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: 'var(--card, #fff)', color: 'inherit', marginTop: 6 }
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 16 }

export function Configuracion() {
  const { company, saveCompany } = useCompany()
  const [form, setForm] = useState(company)
  const [saved, setSaved] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false)
  }
  const dirty = useMemo(() => (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== company[k]), [form, company])
  const rfcOk = !form.rfc || /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(form.rfc.trim())
  const puedeGuardar = dirty && rfcOk && (form.regimen_fiscal === '' || esRegimenValido(form.regimen_fiscal))

  const guardar = () => {
    if (!puedeGuardar) return
    saveCompany({ ...form, rfc: (form.rfc ?? '').trim().toUpperCase() })
    setSaved(true)
  }

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Building2 size={18} />
        <div className="eyebrow" style={{ margin: 0 }}>Dirección · Configuración de la empresa</div>
      </div>

      <div className="card">
        <h4 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>Datos fiscales / empresa</h4>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 8 }}>
          Identidad de la empresa para recibos y manifiestos. La <b>configuración fiscal efectiva para el timbrado del CFDI</b>
          (certificados y emisor) la administra <b>Facturama</b>; estos datos <b>no</b> determinan automáticamente el origen de
          paquetería (ese se configura abajo en <b>Origen de envíos</b>).
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={label}>Razón social</label>
            <input style={input} value={form.razon_social} onChange={set('razon_social')} placeholder="Nombre legal de la empresa" />
          </div>
          <div>
            <label style={label}>RFC</label>
            <input style={{ ...input, borderColor: rfcOk ? 'var(--line)' : 'var(--danger, #be4a3f)' }} value={form.rfc} onChange={set('rfc')} placeholder="XAXX010101000" maxLength={13} />
            {!rfcOk && <div style={{ fontSize: 11, color: 'var(--danger, #be4a3f)', marginTop: 4 }}>RFC con formato inválido.</div>}
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={label}>Régimen fiscal (SAT)</label>
            <select style={input} value={form.regimen_fiscal} onChange={set('regimen_fiscal')}>
              <option value="">Selecciona…</option>
              {REGIMENES_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Código postal (lugar de expedición)</label>
            <input style={input} value={form.cp} onChange={set('cp')} placeholder="00000" maxLength={5} inputMode="numeric" />
          </div>
        </div>

        <label style={label}>Domicilio fiscal</label>
        <input style={input} value={form.direccion} onChange={set('direccion')} placeholder="Calle, número, colonia, ciudad" />

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <div>
            <label style={label}>Teléfono</label>
            <input style={input} value={form.telefono} onChange={set('telefono')} placeholder="55 0000 0000" />
          </div>
          <div>
            <label style={label}>Correo</label>
            <input style={input} value={form.email} onChange={set('email')} placeholder="contacto@empresa.mx" type="email" />
          </div>
        </div>

        <label style={label}>Logo (URL)</label>
        <input style={input} value={form.logo_url} onChange={set('logo_url')} placeholder="https://…/logo.png (opcional)" />

        {/* ORIGEN DE ENVÍOS: remitente de paquetería (neutral DHL/T1), independiente del fiscal. */}
        <h4 style={{ margin: '26px 0 0', fontSize: 14, fontWeight: 700 }}>Origen de envíos (remitente de paquetería)</h4>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
          Dirección desde donde Renovacell entrega los paquetes a la paquetería. <b>DHL y otros proveedores de envío usarán estos
          datos como remitente.</b> Es independiente del domicilio fiscal (puede diferir, p. ej. por remodelación). Si queda
          incompleto, Empaque <b>bloquea</b> la cotización/guía indicando qué falta.
        </p>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={label}>Nombre / remitente</label>
            <input style={input} value={form.shipping_name} onChange={set('shipping_name')} placeholder="Renovacell · Bodega" />
          </div>
          <div>
            <label style={label}>Teléfono</label>
            <input style={input} value={form.shipping_phone} onChange={set('shipping_phone')} placeholder="667 000 0000" />
          </div>
        </div>
        <label style={label}>Dirección</label>
        <input style={input} value={form.shipping_address} onChange={set('shipping_address')} placeholder="Calle, número, colonia" />
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>CP</label>
            <input style={input} value={form.shipping_cp} onChange={set('shipping_cp')} placeholder="00000" maxLength={5} inputMode="numeric" />
          </div>
          <div>
            <label style={label}>Ciudad</label>
            <input style={input} value={form.shipping_city} onChange={set('shipping_city')} placeholder="Culiacán" />
          </div>
          <div>
            <label style={label}>Estado</label>
            <input style={input} value={form.shipping_state} onChange={set('shipping_state')} placeholder="Sinaloa" />
          </div>
          <div>
            <label style={label}>País</label>
            <input style={input} value={form.shipping_country} onChange={set('shipping_country')} placeholder="MX" maxLength={2} />
          </div>
        </div>
        <label style={label}>Correo</label>
        <input style={input} value={form.shipping_email} onChange={set('shipping_email')} placeholder="envios@renovacell.mx" type="email" />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
          <button className="btn" type="button" onClick={guardar} disabled={!puedeGuardar} style={!puedeGuardar ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
            <Save size={15} /> Guardar cambios
          </button>
          {saved && !dirty && <span style={{ fontSize: 13, color: 'var(--green-deep, #1e7a4b)' }}>Guardado ✓</span>}
        </div>
      </div>

      <BankAccountsEditor />
    </div>
  )
}

// Editor de MÚLTIPLES cuentas bancarias (transferencia). Ver todas, agregar,
// editar, activar/desactivar, marcar principal. Persiste por cuenta (no con el
// "Guardar" del formulario fiscal).
function BankAccountsEditor() {
  const { data: accounts, addBankAccount, updateBankAccount, setDefaultBankAccount, setBankActive } = useBankAccounts()
  const ordered = accounts.slice().sort((a, b) => a.display_order - b.display_order || a.bank_name.localeCompare(b.bank_name))

  const nuevo = () => addBankAccount({ bank_name: 'Nuevo banco', beneficiary_name: 'Renovacell', clabe: '', account_number: '' })

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Datos bancarios · Cuentas para transferencia</h4>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={nuevo}><Plus size={14} /> Agregar cuenta</button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
        Renovacell puede tener <b>varias cuentas</b>. Las <b>activas</b> se le muestran al doctor al pagar por transferencia; la
        <b> principal</b> aparece destacada. Las inactivas no se muestran (se conservan para historial).
      </p>

      {ordered.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '14px 0' }}>Sin cuentas capturadas. Agrega la primera con “Agregar cuenta”.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          {ordered.map((a) => (
            <BankAccountRow key={a.id} a={a} onUpdate={updateBankAccount} onDefault={setDefaultBankAccount} onActive={setBankActive} />
          ))}
        </div>
      )}
    </div>
  )
}

function BankAccountRow({ a, onUpdate, onDefault, onActive }: {
  a: BankAccount
  onUpdate: (id: string, patch: Partial<{ bank_name: string; beneficiary_name: string; clabe: string | null; account_number: string | null }>) => void
  onDefault: (id: string) => void
  onActive: (id: string, active: boolean) => void
}) {
  // Draft local: se edita sin guardar en cada tecla; se PERSISTE al salir del campo
  // (onBlur) y solo si cambió. La CLABE inválida no se guarda (se avisa).
  const [draft, setDraft] = useState({ bank_name: a.bank_name, beneficiary_name: a.beneficiary_name, clabe: a.clabe ?? '', account_number: a.account_number ?? '' })
  const [saved, setSaved] = useState(false)
  // Resincroniza si la fila cambió desde el store (p. ej. tras recargar).
  useEffect(() => { setDraft({ bank_name: a.bank_name, beneficiary_name: a.beneficiary_name, clabe: a.clabe ?? '', account_number: a.account_number ?? '' }) }, [a.id, a.bank_name, a.beneficiary_name, a.clabe, a.account_number])

  const clabeOk = clabeValida(draft.clabe)
  const flashSaved = () => { setSaved(true); setTimeout(() => setSaved(false), 1500) }
  const commit = (field: 'bank_name' | 'beneficiary_name' | 'account_number') => {
    const cur = (a[field] ?? '') as string
    if (draft[field].trim() !== cur.trim()) { onUpdate(a.id, { [field]: draft[field] }); flashSaved() }
  }
  const commitClabe = () => {
    if (!clabeOk) return // no persistir CLABE inválida
    if ((draft.clabe.trim() || null) !== (a.clabe ?? null)) { onUpdate(a.id, { clabe: draft.clabe }); flashSaved() }
  }

  return (
    <div style={{ border: '1px solid ' + (a.is_default ? 'var(--green, #2f9e69)' : 'var(--line)'), borderRadius: 12, padding: 12, background: a.active ? (a.is_default ? 'var(--ok-bg, #f0faf4)' : 'var(--card,#fff)') : 'var(--muted-bg, #f6f6f6)', opacity: a.active ? 1 : 0.7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {a.is_default && <span className="pill p-ok" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Star size={12} /> Principal</span>}
        {!a.active && <span className="pill p-neu">Inactiva</span>}
        {saved && <span style={{ fontSize: 12, color: 'var(--green-deep, #1e7a4b)', fontWeight: 600 }}>Guardado ✓</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {a.active && !a.is_default && <button className="btn ghost sm" type="button" onClick={() => onDefault(a.id)}><Star size={13} /> Marcar principal</button>}
          <button className="btn ghost sm" type="button" onClick={() => onActive(a.id, !a.active)}>{a.active ? <><Trash2 size={13} /> Desactivar</> : 'Reactivar'}</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={label}>Banco</label>
          <input style={input} value={draft.bank_name} onChange={(e) => setDraft({ ...draft, bank_name: e.target.value })} onBlur={() => commit('bank_name')} placeholder="BBVA, Banorte, …" />
        </div>
        <div>
          <label style={label}>Beneficiario / titular</label>
          <input style={input} value={draft.beneficiary_name} onChange={(e) => setDraft({ ...draft, beneficiary_name: e.target.value })} onBlur={() => commit('beneficiary_name')} placeholder="Razón social del titular" />
        </div>
        <div>
          <label style={label}>CLABE (18 dígitos)</label>
          <input style={{ ...input, borderColor: clabeOk ? 'var(--line)' : 'var(--danger, #be4a3f)' }} value={draft.clabe} onChange={(e) => setDraft({ ...draft, clabe: e.target.value })} onBlur={commitClabe} placeholder="000000000000000000" maxLength={18} inputMode="numeric" />
          {!clabeOk && <div style={{ fontSize: 11, color: 'var(--danger, #be4a3f)', marginTop: 4 }}>La CLABE debe tener 18 dígitos (no se guarda hasta corregirla).</div>}
        </div>
        <div>
          <label style={label}>Cuenta (opcional)</label>
          <input style={input} value={draft.account_number} onChange={(e) => setDraft({ ...draft, account_number: e.target.value })} onBlur={() => commit('account_number')} placeholder="Número de cuenta" />
        </div>
      </div>
    </div>
  )
}
