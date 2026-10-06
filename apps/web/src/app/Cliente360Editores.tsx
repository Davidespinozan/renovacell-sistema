// C360-F3 · Editores del Customer 360 (reutilizables en la ficha de Dirección/vendedor, en Mi perfil del
// doctor y en el checkout). La autoridad es el servidor: estos componentes solo llaman comandos
// (cliente_*) y recargan; si el servidor niega, se muestra su motivo. Divulgación progresiva: lista
// compacta, y el formulario solo al agregar o editar.
import React, { useState } from 'react'
import { Plus, Star, Archive, Pencil } from 'lucide-react'
import { FiscalFields } from './FiscalFields'
import { emptyFiscalProfile, normalizeFiscalProfile, validateFiscalProfile, type FiscalProfile } from '../data/ops/fiscal'
import { ETIQUETAS_TELEFONO, lineaDomicilio, type ClienteC360, type EtiquetaTelefono, type PerfilFiscal, type Telefono, type Nota } from '../data/ops/customer360'
import { TIPOS_DOMICILIO, type DoctorLocation } from '../data/ops/doctorLocation'
import { nombreRegimen } from '../data/sat/regimenesFiscales'
import { nombreUsoCfdi } from '../data/sat/usosCfdi'

const campo: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13.5, width: '100%' }
const fila: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, flexWrap: 'wrap' }
const etiq = (k: string) => ETIQUETAS_TELEFONO.find((e) => e.key === k)?.label ?? k

function Aviso({ texto }: { texto: string | null }) {
  return texto ? <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', margin: '6px 0' }}>{texto}</div> : null
}
async function correr(fn: () => Promise<{ ok: boolean; error?: string }>, setError: (e: string | null) => void, despues: () => void | Promise<void>) {
  setError(null)
  const r = await fn()
  if (!r.ok) { setError(r.error ?? 'No se pudo completar.'); return false }
  await despues(); return true
}

// ── Teléfonos ───────────────────────────────────────────────────────────────
export function TelefonosEditor({ customerId, telefonos, editable, cliente, onCambio }: { customerId: string | null; telefonos: Telefono[]; editable: boolean; cliente: ClienteC360; onCambio: () => void | Promise<void> }) {
  const [form, setForm] = useState<{ id: string | null; numero: string; etiqueta: EtiquetaTelefono; principal: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const guardar = async () => {
    if (!form) return
    const ok = await correr(() => cliente.guardarTelefono(customerId, form.id, form.numero, form.etiqueta, form.principal), setError, onCambio)
    if (ok) setForm(null)
  }
  return (
    <div data-testid="telefonos">
      {telefonos.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Sin teléfonos registrados.</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {telefonos.map((t) => (
          <div key={t.id} style={fila} data-testid="telefono">
            <b className="mono" style={{ fontSize: 13.5 }}>{t.numero}</b>
            <span className="pill p-neu">{etiq(t.etiqueta)}</span>
            {t.es_principal && <span className="pill p-ok">Principal</span>}
            {t.origen !== 'manual' && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t.origen === 'migracion' ? 'importado' : 'del registro'}</span>}
            {editable && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {!t.es_principal && <button type="button" className="btn ghost sm" title="Hacer principal" onClick={() => correr(() => cliente.telefonoPrincipal(t.id), setError, onCambio)}><Star size={13} /></button>}
                <button type="button" className="btn ghost sm" title="Editar" onClick={() => setForm({ id: t.id, numero: t.numero, etiqueta: t.etiqueta, principal: t.es_principal })}><Pencil size={13} /></button>
                <button type="button" className="btn ghost sm" title="Archivar" onClick={() => correr(() => cliente.archivarTelefono(t.id), setError, onCambio)} data-testid="telefono-archivar"><Archive size={13} /></button>
              </span>
            )}
          </div>
        ))}
      </div>
      <Aviso texto={error} />
      {editable && !form && <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setForm({ id: null, numero: '', etiqueta: 'celular', principal: telefonos.length === 0 })} data-testid="telefono-agregar"><Plus size={13} /> Agregar teléfono</button>}
      {form && (
        <div style={{ ...fila, marginTop: 8, alignItems: 'flex-end' }} data-testid="telefono-form">
          <label style={{ flex: 2, minWidth: 160, fontSize: 12 }}>Número<input style={campo} value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="669 123 4567" inputMode="tel" aria-label="Número" /></label>
          <label style={{ flex: 1, minWidth: 120, fontSize: 12 }}>Etiqueta
            <select style={campo} value={form.etiqueta} onChange={(e) => setForm({ ...form, etiqueta: e.target.value as EtiquetaTelefono })} aria-label="Etiqueta">{ETIQUETAS_TELEFONO.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select>
          </label>
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.checked })} /> Principal</label>
          <button type="button" className="btn btn-primary sm" onClick={guardar} data-testid="telefono-guardar">Guardar</button>
          <button type="button" className="btn ghost sm" onClick={() => setForm(null)}>Cancelar</button>
        </div>
      )}
    </div>
  )
}

// ── Domicilios ──────────────────────────────────────────────────────────────
type DatosDomicilio = { tipo: string; name: string; line1: string; exterior_number: string; interior_number: string; neighborhood: string; postal_code: string; municipio: string; city: string; state: string; country: string; reference_notes: string; contact_name: string; contact_phone: string }
const VACIO: DatosDomicilio = { tipo: 'CONSULTORIO', name: '', line1: '', exterior_number: '', interior_number: '', neighborhood: '', postal_code: '', municipio: '', city: '', state: '', country: 'México', reference_notes: '', contact_name: '', contact_phone: '' }
const deUbicacion = (l: DoctorLocation): DatosDomicilio => Object.fromEntries(Object.keys(VACIO).map((k) => [k, ((l as Record<string, unknown>)[k] ?? (k === 'tipo' ? 'OTRO' : '')) as string])) as DatosDomicilio
const etiquetaTipo = (t: string | null | undefined) => TIPOS_DOMICILIO.find((x) => x.key === t)?.label ?? 'Sin tipo'

export function DomiciliosEditor({ customerId, lista, archivados = 0, alta, editable, puedeAdoptar, cliente, onCambio }: {
  customerId: string | null; lista: DoctorLocation[]; archivados?: number; alta?: { line1?: string; colonia?: string; cp?: string; city?: string; state?: string } | null
  editable: boolean; puedeAdoptar?: boolean; cliente: ClienteC360; onCambio: () => void | Promise<void>
}) {
  const [form, setForm] = useState<{ id: string | null; d: DatosDomicilio; predeterminado: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof DatosDomicilio) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => form && setForm({ ...form, d: { ...form.d, [k]: e.target.value } })
  const guardar = async () => { if (form && await correr(() => cliente.guardarDomicilio(customerId, form.id, form.d, form.predeterminado), setError, onCambio)) setForm(null) }
  const altaPendiente = alta?.line1 && !lista.some((l) => (l.line1 ?? '').trim().toLowerCase() === alta.line1!.trim().toLowerCase() && l.postal_code === alta.cp)
  return (
    <div data-testid="domicilios">
      {lista.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Sin domicilios registrados.</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {lista.map((l) => (
          <div key={l.id} style={fila} data-testid="domicilio">
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{l.name} <span className="pill p-neu" style={{ marginLeft: 4 }}>{etiquetaTipo(l.tipo)}</span>{l.is_default && <span className="pill p-ok" style={{ marginLeft: 4 }}>Predeterminado</span>}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{lineaDomicilio(l)}</div>
              {(l.contact_name || l.contact_phone || l.reference_notes) && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{[l.contact_name, l.contact_phone, l.reference_notes].filter(Boolean).join(' · ')}</div>}
            </div>
            {editable && (
              <span style={{ display: 'flex', gap: 4 }}>
                {!l.is_default && <button type="button" className="btn ghost sm" title="Predeterminado" onClick={() => correr(() => cliente.domicilioPredeterminado(l.id), setError, onCambio)}><Star size={13} /></button>}
                <button type="button" className="btn ghost sm" title="Editar" onClick={() => setForm({ id: l.id, d: deUbicacion(l), predeterminado: l.is_default })}><Pencil size={13} /></button>
                <button type="button" className="btn ghost sm" title="Archivar" onClick={() => correr(() => cliente.archivarDomicilio(l.id), setError, onCambio)} data-testid="domicilio-archivar"><Archive size={13} /></button>
              </span>
            )}
          </div>
        ))}
      </div>
      {archivados > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>{archivados} domicilio(s) archivado(s): se conservan para el historial de pedidos.</div>}
      {altaPendiente && (
        <div style={{ ...fila, marginTop: 8, background: 'var(--surface-2, #fafafa)' }} data-testid="domicilio-alta">
          <div style={{ flex: 1, fontSize: 12.5 }}><b>Domicilio del registro</b> (aún no es un domicilio de entrega): {[alta!.line1, alta!.colonia, alta!.cp && `C.P. ${alta!.cp}`, alta!.city, alta!.state].filter(Boolean).join(', ')}</div>
          {puedeAdoptar && <button type="button" className="btn sm" onClick={() => correr(async () => { const r = await cliente.adoptarAlta(customerId); return r.ok && !r.data.adoptado ? { ok: false, error: r.data.motivo === 'incompleto' ? 'El domicilio del registro está incompleto (faltan CP, ciudad o estado): captúralo a mano.' : 'Ya existe un domicilio igual.' } : r }, setError, onCambio)} data-testid="domicilio-adoptar">Usarlo como domicilio</button>}
        </div>
      )}
      <Aviso texto={error} />
      {editable && !form && <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setForm({ id: null, d: { ...VACIO }, predeterminado: lista.length === 0 })} data-testid="domicilio-agregar"><Plus size={13} /> Agregar domicilio</button>}
      {form && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 8, display: 'grid', gap: 8 }} data-testid="domicilio-form">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
            <label style={{ fontSize: 12 }}>Tipo<select style={campo} value={form.d.tipo} onChange={set('tipo')} aria-label="Tipo">{TIPOS_DOMICILIO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
            <label style={{ fontSize: 12 }}>Alias<input style={campo} value={form.d.name} onChange={set('name')} placeholder="Consultorio Chapultepec" aria-label="Alias" /></label>
            <label style={{ fontSize: 12, gridColumn: 'span 2' }}>Calle<input style={campo} value={form.d.line1} onChange={set('line1')} aria-label="Calle" /></label>
            <label style={{ fontSize: 12 }}>Núm. exterior<input style={campo} value={form.d.exterior_number} onChange={set('exterior_number')} /></label>
            <label style={{ fontSize: 12 }}>Núm. interior<input style={campo} value={form.d.interior_number} onChange={set('interior_number')} /></label>
            <label style={{ fontSize: 12 }}>Colonia<input style={campo} value={form.d.neighborhood} onChange={set('neighborhood')} /></label>
            <label style={{ fontSize: 12 }}>C.P.<input style={campo} value={form.d.postal_code} onChange={set('postal_code')} inputMode="numeric" maxLength={5} aria-label="CP" /></label>
            <label style={{ fontSize: 12 }}>Municipio / alcaldía<input style={campo} value={form.d.municipio} onChange={set('municipio')} aria-label="Municipio" /></label>
            <label style={{ fontSize: 12 }}>Ciudad / localidad<input style={campo} value={form.d.city} onChange={set('city')} aria-label="Ciudad" /></label>
            <label style={{ fontSize: 12 }}>Estado<input style={campo} value={form.d.state} onChange={set('state')} aria-label="Estado" /></label>
            <label style={{ fontSize: 12 }}>País<input style={campo} value={form.d.country} onChange={set('country')} /></label>
            <label style={{ fontSize: 12 }}>Contacto<input style={campo} value={form.d.contact_name} onChange={set('contact_name')} /></label>
            <label style={{ fontSize: 12 }}>Tel. de entrega<input style={campo} value={form.d.contact_phone} onChange={set('contact_phone')} inputMode="tel" /></label>
            <label style={{ fontSize: 12, gridColumn: '1 / -1' }}>Referencias<textarea style={{ ...campo, minHeight: 50 }} value={form.d.reference_notes} onChange={set('reference_notes')} /></label>
          </div>
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.predeterminado} onChange={(e) => setForm({ ...form, predeterminado: e.target.checked })} /> Predeterminado</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-primary sm" onClick={guardar} data-testid="domicilio-guardar">Guardar domicilio</button>
            <button type="button" className="btn ghost sm" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Perfiles fiscales (0..N) ────────────────────────────────────────────────
export function PerfilesFiscalesEditor({ customerId, perfiles, editable, cliente, onCambio, seleccion }: {
  customerId: string | null; perfiles: PerfilFiscal[]; editable: boolean; cliente: ClienteC360; onCambio: () => void | Promise<void>
  seleccion?: { valor: string | null; onElegir: (id: string) => void }   // modo checkout: elegir el receptor del pedido
}) {
  const [form, setForm] = useState<{ id: string | null; alias: string; f: FiscalProfile; predeterminado: boolean } | null>(null)
  const [mostrarErr, setMostrarErr] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guardar = async () => {
    if (!form) return
    if (!validateFiscalProfile(form.f).ok) { setMostrarErr(true); return }
    const r = await cliente.guardarFiscal(customerId, form.id, { ...form.f, alias: form.alias || form.f.razon_social }, form.predeterminado)
    if (!r.ok) { setError(r.error); return }
    setError(null); setForm(null); setMostrarErr(false); await onCambio()
    if (seleccion && r.data?.id) seleccion.onElegir(r.data.id)
  }
  return (
    <div data-testid="perfiles-fiscales">
      {perfiles.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Sin perfiles fiscales.</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {perfiles.map((p) => (
          <label key={p.id} style={{ ...fila, cursor: seleccion ? 'pointer' : undefined, borderColor: seleccion?.valor === p.id ? 'var(--green-deep)' : undefined }} data-testid="perfil-fiscal">
            {seleccion && <input type="radio" name="perfil-fiscal" checked={seleccion.valor === p.id} onChange={() => seleccion.onElegir(p.id)} aria-label={p.alias} />}
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.alias} {p.es_predeterminado && <span className="pill p-ok" style={{ marginLeft: 4 }}>Predeterminado</span>}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }} className="mono">{p.rfc}{p.razon_social ? ` · ${p.razon_social}` : ''}</div>
              {p.regimen && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{nombreRegimen(p.regimen)} · C.P. {p.cp} · {nombreUsoCfdi(p.uso_cfdi ?? '')} · {p.email_facturacion}</div>}
            </div>
            {editable && !seleccion && (
              <span style={{ display: 'flex', gap: 4 }}>
                {!p.es_predeterminado && <button type="button" className="btn ghost sm" title="Predeterminado" onClick={() => correr(() => cliente.fiscalPredeterminado(p.id), setError, onCambio)}><Star size={13} /></button>}
                <button type="button" className="btn ghost sm" title="Editar" onClick={() => setForm({ id: p.id, alias: p.alias, f: normalizeFiscalProfile(p), predeterminado: p.es_predeterminado })}><Pencil size={13} /></button>
                <button type="button" className="btn ghost sm" title="Archivar" onClick={() => correr(() => cliente.archivarFiscal(p.id), setError, onCambio)} data-testid="fiscal-archivar"><Archive size={13} /></button>
              </span>
            )}
          </label>
        ))}
      </div>
      <Aviso texto={error} />
      {editable && !form && <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setForm({ id: null, alias: '', f: emptyFiscalProfile(), predeterminado: perfiles.length === 0 })} data-testid="fiscal-agregar"><Plus size={13} /> Agregar perfil fiscal</button>}
      {form && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 8 }} data-testid="fiscal-form">
          <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Alias (para identificarlo)<input style={campo} value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} placeholder="Clínica, Persona física…" maxLength={80} aria-label="Alias fiscal" /></label>
          <FiscalFields value={form.f} onChange={(f) => setForm({ ...form, f })} showErrors={mostrarErr} />
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}><input type="checkbox" checked={form.predeterminado} onChange={(e) => setForm({ ...form, predeterminado: e.target.checked })} /> Predeterminado</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="btn btn-primary sm" onClick={guardar} data-testid="fiscal-guardar">Guardar perfil</button>
            <button type="button" className="btn ghost sm" onClick={() => { setForm(null); setMostrarErr(false) }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Contacto (solo los campos que el servidor permite a este rol) ────────────
const ETIQUETA_CAMPO: Record<string, string> = { full_name: 'Nombre', email: 'Correo', city: 'Ciudad', country: 'País' }
export function ContactoEditor({ customerId, valores, permitidos, cliente, onCambio }: { customerId: string | null; valores: Record<string, string | null>; permitidos: string[]; cliente: ClienteC360; onCambio: () => void | Promise<void> }) {
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (permitidos.length === 0) return null
  if (!form) return <button type="button" className="btn sm" onClick={() => setForm(Object.fromEntries(permitidos.map((k) => [k, valores[k] ?? ''])))} data-testid="contacto-editar"><Pencil size={13} /> Editar contacto</button>
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }} data-testid="contacto-form">
      {permitidos.map((k) => <label key={k} style={{ fontSize: 12 }}>{ETIQUETA_CAMPO[k] ?? k}<input style={campo} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-label={ETIQUETA_CAMPO[k] ?? k} /></label>)}
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6 }}>
        <button type="button" className="btn btn-primary sm" onClick={async () => { if (await correr(() => cliente.guardarContacto(customerId, form), setError, onCambio)) setForm(null) }} data-testid="contacto-guardar">Guardar</button>
        <button type="button" className="btn ghost sm" onClick={() => setForm(null)}>Cancelar</button>
      </div>
      <Aviso texto={error} />
    </div>
  )
}

// ── Notas internas (Dirección y el vendedor de su cartera; append-only) ──────
export function NotasPanel({ customerId, notas, legada, editable, cliente, onCambio }: { customerId: string; notas: Nota[]; legada?: string | null; editable: boolean; cliente: ClienteC360; onCambio: () => void | Promise<void> }) {
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div data-testid="notas">
      {legada && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 6 }}><b>Nota importada:</b> {legada}</div>}
      {notas.map((n) => <div key={n.id} style={{ fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>{n.texto}<div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{n.autor ?? n.autor_rol} · {new Date(n.at).toLocaleString('es-MX')}</div></div>)}
      {notas.length === 0 && !legada && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Sin notas.</div>}
      {editable && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input style={campo} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} placeholder="Agregar nota interna…" aria-label="Nota" />
          <button type="button" className="btn sm" disabled={!texto.trim()} onClick={async () => { if (await correr(() => cliente.agregarNota(customerId, texto.trim()), setError, onCambio)) setTexto('') }} data-testid="nota-agregar">Agregar</button>
        </div>
      )}
      <Aviso texto={error} />
    </div>
  )
}
