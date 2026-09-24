// DIRECCIÓN · Configuración de la empresa (emisor). Aquí se capturan los datos fiscales que
// necesita el CFDI (razón social, RFC, régimen SAT, lugar de expedición) y la identidad que
// aparece en recibos/manifiestos. Antes no existía dónde capturar al EMISOR del CFDI.
import React, { useMemo, useState } from 'react'
import { Building2, Save } from 'lucide-react'
import { useCompany } from '../../data/hooks/useCompany'
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
  const clabeOk = !form.clabe || /^\d{18}$/.test(form.clabe.trim())
  const puedeGuardar = dirty && rfcOk && clabeOk && (form.regimen_fiscal === '' || esRegimenValido(form.regimen_fiscal))

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
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 4 }}>
          Configuración <b>operativa</b> de Renovacell: identidad, domicilio (origen de envíos), contacto y datos bancarios.
          Se usa en recibos, manifiestos, <b>transferencias</b> y como <b>remitente de paquetería</b>. La configuración
          <b> fiscal del emisor del CFDI</b> (certificados y timbrado) la administra Facturama, no esta pantalla.
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

        <label style={label}>Dirección</label>
        <input style={input} value={form.direccion} onChange={set('direccion')} placeholder="Calle, número, colonia" />

        {/* Ciudad/Estado/País: origen operativo (remitente de paquetería, p. ej. DHL). */}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div>
            <label style={label}>Ciudad</label>
            <input style={input} value={form.ciudad} onChange={set('ciudad')} placeholder="Culiacán" />
          </div>
          <div>
            <label style={label}>Estado</label>
            <input style={input} value={form.estado} onChange={set('estado')} placeholder="Sinaloa" />
          </div>
          <div>
            <label style={label}>País</label>
            <input style={input} value={form.pais} onChange={set('pais')} placeholder="MX" maxLength={2} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>Ciudad, estado y país (ISO-2, p. ej. MX) del domicilio de origen para envíos.</div>

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

        {/* Datos bancarios: se muestran al doctor en el modal de transferencia (R-58). */}
        <h4 style={{ margin: '26px 0 0', fontSize: 14, fontWeight: 700 }}>Datos bancarios (pago por transferencia)</h4>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>Aparecen en la ventana de pago del doctor. Sin estos datos, no puede transferir.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>Banco</label>
            <input style={input} value={form.banco} onChange={set('banco')} placeholder="BBVA, Banorte, …" />
          </div>
          <div>
            <label style={label}>Beneficiario / titular</label>
            <input style={input} value={form.titular} onChange={set('titular')} placeholder="Razón social del titular de la cuenta" />
          </div>
          <div>
            <label style={label}>CLABE (18 dígitos)</label>
            <input style={{ ...input, borderColor: clabeOk ? 'var(--line)' : 'var(--danger, #be4a3f)' }} value={form.clabe} onChange={set('clabe')} placeholder="000000000000000000" maxLength={18} inputMode="numeric" />
            {!clabeOk && <div style={{ fontSize: 11, color: 'var(--danger, #be4a3f)', marginTop: 4 }}>La CLABE debe tener 18 dígitos.</div>}
          </div>
          <div>
            <label style={label}>Cuenta (opcional)</label>
            <input style={input} value={form.cuenta} onChange={set('cuenta')} placeholder="Número de cuenta" />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
          <button className="btn" type="button" onClick={guardar} disabled={!puedeGuardar} style={!puedeGuardar ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
            <Save size={15} /> Guardar cambios
          </button>
          {saved && !dirty && <span style={{ fontSize: 13, color: 'var(--green-deep, #1e7a4b)' }}>Guardado ✓</span>}
        </div>
      </div>
    </div>
  )
}
