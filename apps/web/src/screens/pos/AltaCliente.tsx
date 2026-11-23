// ALTA COMPLETA (23 nov 2026, dueño: «esto es información demasiado pobre, no cubre todo lo que el sistema es capaz de
// recabar del cliente»). Una sola pantalla para dar de alta a un cliente con todo lo que guarda su ficha:
//   obligatorio  · doctor/clínica, nombre, celular (WhatsApp)
//   opcional     · especialidad, correo, ciudad · cédula · otro teléfono · domicilio de entrega · facturación (solo
//                  Dirección: el vendedor no edita datos fiscales) · vendedora asignada (solo Dirección) · nota interna
// Primero se crea el cliente (cliente_prospecto_crear: misma regla de duplicados por celular) y luego cada parte se guarda
// con el MISMO comando que usa la ficha (con sus validaciones). Todo se valida antes de crear; si algo opcional no se pudo
// guardar, el cliente queda registrado y se dice exactamente qué faltó. Si el celular ya existía, no se toca su ficha.
import React, { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRole } from '../../auth/RoleContext'
import { crearProspecto, type ProspectoCreado } from './NuevoProspecto'
import { cliente360 as c360PorDefecto, ETIQUETAS_TELEFONO, type ClienteC360, type EtiquetaTelefono } from '../../data/ops/customer360'
import { perfilComercial as perfilPorDefecto, type ClientePerfilComercial } from '../../data/ops/perfilComercial'
import { atencion as atencionPorDefecto, type ClienteAtencion, type Vendedor } from '../../data/ops/atencion'
import { useEspecialidades } from '../../app/PerfilComercialEditor'
import { FiscalFields } from '../../app/FiscalFields'
import { emptyFiscalProfile, validateFiscalProfile, type FiscalProfile } from '../../data/ops/fiscal'
import { TIPOS_DOMICILIO } from '../../data/ops/doctorLocation'

type Rpc = Parameters<typeof crearProspecto>[1]
export interface AltaResultado extends ProspectoCreado { faltas: string[] }

const DOM_VACIO = { tipo: 'CONSULTORIO', line1: '', exterior_number: '', interior_number: '', neighborhood: '', postal_code: '', city: '', state: '', reference_notes: '' }
type Dom = typeof DOM_VACIO
const digitos = (s: string) => s.replace(/\D/g, '')
const hayDom = (d: Dom) => [d.line1, d.exterior_number, d.neighborhood, d.postal_code, d.state, d.reference_notes].some((x) => x.trim())

/** Lo que está mal ANTES de crear al cliente (lista vacía = se puede registrar). */
export function erroresAlta(f: { nombre: string; celular: string; correo: string; cedula: string; tel2: string; dom: Dom; fiscal: FiscalProfile | null }): string[] {
  const e: string[] = []
  if (f.nombre.trim().length < 3) e.push('Escribe el nombre completo.')
  if (digitos(f.celular).length < 10) e.push('El celular necesita 10 dígitos (o su lada si es del extranjero).')
  if (f.correo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.correo.trim())) e.push('Revisa el correo.')
  if (f.cedula.trim() && !/^[0-9]{7,8}$/.test(digitos(f.cedula))) e.push('La cédula profesional tiene 7 u 8 dígitos.')
  if (f.tel2.trim() && (digitos(f.tel2).length < 10 || digitos(f.tel2).length > 15)) e.push('El otro teléfono debe tener de 10 a 15 dígitos.')
  if (hayDom(f.dom)) {
    if (!f.dom.line1.trim()) e.push('Domicilio: falta la calle.')
    if (!/^\d{5}$/.test(f.dom.postal_code.trim())) e.push('Domicilio: el código postal tiene 5 dígitos.')
    if (!f.dom.state.trim()) e.push('Domicilio: falta el estado.')
  }
  if (f.fiscal && f.fiscal.rfc.trim() && !validateFiscalProfile(f.fiscal).ok) e.push('Facturación: revisa los datos fiscales marcados.')
  return e
}

export function AltaClienteForm({ onListo, onCancelar, rpc, c360 = c360PorDefecto, perfil = perfilPorDefecto, atencion = atencionPorDefecto }: {
  onListo: (r: AltaResultado) => void; onCancelar: () => void; rpc?: Rpc; c360?: ClienteC360; perfil?: ClientePerfilComercial; atencion?: ClienteAtencion
}) {
  const { role } = useRole()
  const esDireccion = role === 'admin'
  const especialidades = useEspecialidades(perfil)
  const [f, setF] = useState({ nombre: '', celular: '', tipo: 'doctor' as 'doctor' | 'clinica', ciudad: '', correo: '' })
  const [esp, setEsp] = useState(''); const [espOtra, setEspOtra] = useState('')
  const [cedula, setCedula] = useState('')
  const [tel2, setTel2] = useState(''); const [tel2Etq, setTel2Etq] = useState<EtiquetaTelefono>('consultorio')
  const [dom, setDom] = useState<Dom>(DOM_VACIO)
  const [fiscal, setFiscal] = useState<FiscalProfile>(emptyFiscalProfile()); const [verErrFiscal, setVerErrFiscal] = useState(false)
  const [vendedores, setVendedores] = useState<Vendedor[] | null>(null); const [vendedor, setVendedor] = useState('')
  const [nota, setNota] = useState('')
  const [errores, setErrores] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { if (esDireccion) void atencion.vendedores().then((r) => { if (r.ok) setVendedores(r.data) }) }, [esDireccion, atencion])
  const elegibles = useMemo(() => (vendedores ?? []).filter((v) => v.activo && v.elegible_nuevos), [vendedores])
  const campoDom = (k: keyof Dom) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDom((d) => ({ ...d, [k]: e.target.value }))

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (ocupado) return
    const pre = erroresAlta({ ...f, cedula, tel2, dom, fiscal: esDireccion ? fiscal : null })
    if (pre.length) { setErrores(pre); setVerErrFiscal(true); return }
    setOcupado(true); setErrores([])
    const r = await crearProspecto(f, rpc)
    if (!r.ok) { setOcupado(false); setErrores([r.error]); return }
    const p = r.data
    // Ya existía (mismo celular): no se toca su ficha; quien lo atiende la completa desde ahí.
    if (p.status === 'existente') { setOcupado(false); onListo({ ...p, faltas: [] }); return }
    const id = p.customer_id
    const faltas: string[] = []
    const paso = async (que: string, hacer: () => PromiseLike<{ ok: boolean; error?: string; mensaje?: string }>) => {
      try { const x = await hacer(); if (!x.ok) faltas.push(`${que}: ${x.error ?? x.mensaje ?? 'no se pudo guardar'}`) } catch { faltas.push(`${que}: sin conexión`) }
    }
    if (esp) await paso('Especialidad', () => perfil.guardar(id, f.tipo, esp, esp === 'otra' ? (espOtra.trim() || null) : null))
    if (cedula.trim()) await paso('Cédula', () => c360.guardarCedula(id, digitos(cedula)))
    if (tel2.trim()) await paso('Otro teléfono', () => c360.guardarTelefono(id, null, tel2.trim(), tel2Etq, false))
    if (hayDom(dom)) await paso('Domicilio', () => c360.guardarDomicilio(id, null, { ...dom, name: '', municipio: '', country: 'México', contact_name: '', contact_phone: '' }, true))
    if (esDireccion && fiscal.rfc.trim()) await paso('Facturación', () => c360.guardarFiscal(id, null, { ...fiscal, alias: fiscal.razon_social || f.nombre }, true))
    if (esDireccion && vendedor) await paso('Vendedora', () => c360.asignarVendedor(id, vendedor, 'Asignada al darlo de alta'))
    if (nota.trim()) await paso('Nota', () => c360.agregarNota(id, nota.trim()))
    setOcupado(false)
    onListo({ ...p, faltas })
  }

  return (
    <form className="prospecto-form alta-cliente" onSubmit={(e) => void enviar(e)} data-testid="prospecto-form" noValidate>
      <div className="prospecto-tipo">
        {(['doctor', 'clinica'] as const).map((t) => (
          <button key={t} type="button" className={'pc-chip' + (f.tipo === t ? ' on' : '')} aria-pressed={f.tipo === t} onClick={() => setF({ ...f, tipo: t })}>{t === 'doctor' ? 'Doctor(a)' : 'Clínica'}</button>
        ))}
      </div>
      <label>Nombre completo<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={120} autoComplete="off" placeholder={f.tipo === 'doctor' ? 'Dra. Ana López Pérez' : 'Clínica Estética del Valle'} data-testid="prospecto-nombre" /></label>
      <label>Celular (WhatsApp)<input value={f.celular} onChange={(e) => setF({ ...f, celular: e.target.value })} inputMode="tel" autoComplete="off" placeholder="667 123 4567" data-testid="prospecto-celular" /></label>
      <div className="alta-fila">
        <label>Especialidad <small>(opcional)</small>
          <select value={esp} onChange={(e) => setEsp(e.target.value)} data-testid="alta-especialidad">
            <option value="">—</option>
            {especialidades.map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}
          </select>
        </label>
        {esp === 'otra' && <label>¿Cuál?<input value={espOtra} onChange={(e) => setEspOtra(e.target.value)} maxLength={60} /></label>}
      </div>
      <div className="alta-fila">
        <label>Correo <small>(opcional)</small><input value={f.correo} onChange={(e) => setF({ ...f, correo: e.target.value })} inputMode="email" autoComplete="off" data-testid="alta-correo" /></label>
        <label>Ciudad <small>(opcional)</small><input value={f.ciudad} onChange={(e) => setF({ ...f, ciudad: e.target.value })} maxLength={80} autoComplete="off" /></label>
      </div>

      <details className="alta-seccion">
        <summary>Profesional y contacto <small>cédula · otro teléfono</small></summary>
        <div className="alta-fila">
          <label>Cédula profesional<input value={cedula} onChange={(e) => setCedula(e.target.value)} inputMode="numeric" maxLength={12} placeholder="7 u 8 dígitos" data-testid="alta-cedula" /></label>
        </div>
        <div className="alta-fila">
          <label>Otro teléfono<input value={tel2} onChange={(e) => setTel2(e.target.value)} inputMode="tel" placeholder="Consultorio, recepción…" data-testid="alta-tel2" /></label>
          <label>Es de<select value={tel2Etq} onChange={(e) => setTel2Etq(e.target.value as EtiquetaTelefono)}>{ETIQUETAS_TELEFONO.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
        </div>
        <div className="alta-nota">La cédula queda en su ficha; verificarlo sigue siendo decisión de una persona.</div>
      </details>

      <details className="alta-seccion">
        <summary>Domicilio de entrega <small>para sus envíos</small></summary>
        <div className="alta-fila">
          <label>Tipo<select value={dom.tipo} onChange={campoDom('tipo')}>{TIPOS_DOMICILIO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
          <label className="alta-ancho">Calle<input value={dom.line1} onChange={campoDom('line1')} maxLength={160} data-testid="alta-calle" /></label>
        </div>
        <div className="alta-fila">
          <label>Núm. ext.<input value={dom.exterior_number} onChange={campoDom('exterior_number')} maxLength={20} /></label>
          <label>Núm. int.<input value={dom.interior_number} onChange={campoDom('interior_number')} maxLength={20} /></label>
          <label>Colonia<input value={dom.neighborhood} onChange={campoDom('neighborhood')} maxLength={80} /></label>
        </div>
        <div className="alta-fila">
          <label>C.P.<input value={dom.postal_code} onChange={campoDom('postal_code')} inputMode="numeric" maxLength={5} data-testid="alta-cp" /></label>
          <label>Ciudad<input value={dom.city} onChange={campoDom('city')} maxLength={80} /></label>
          <label>Estado<input value={dom.state} onChange={campoDom('state')} maxLength={80} data-testid="alta-estado" /></label>
        </div>
        <label>Referencias <small>(cómo llegar, horario)</small><input value={dom.reference_notes} onChange={campoDom('reference_notes')} maxLength={200} /></label>
      </details>

      {esDireccion ? (
        <details className="alta-seccion">
          <summary>Facturación <small>RFC, razón social, régimen</small></summary>
          <FiscalFields value={fiscal} onChange={setFiscal} showErrors={verErrFiscal && !!fiscal.rfc.trim()} />
        </details>
      ) : (
        <div className="alta-nota">Los datos de facturación los captura Dirección o el cliente en su portal.</div>
      )}

      <details className="alta-seccion">
        <summary>{esDireccion ? 'Vendedora y nota' : 'Nota interna'}</summary>
        {esDireccion && (
          <label>Vendedora que lo atiende <small>(opcional)</small>
            <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} data-testid="alta-vendedora">
              <option value="">Sin asignar</option>
              {elegibles.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </label>
        )}
        <label>Nota interna <small>(solo la ve el equipo)</small><input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} placeholder="Ej. prefiere entregas por la mañana; lo conocimos en el congreso" data-testid="alta-nota" /></label>
      </details>

      {errores.length > 0 && <div className="sysnote" role="alert" data-testid="prospecto-error">{errores.map((x) => <div key={x}>{x}</div>)}</div>}
      <div className="prospecto-acciones">
        <button type="button" className="btn ghost" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn" disabled={ocupado || f.nombre.trim().length < 3 || digitos(f.celular).length < 10} data-testid="prospecto-guardar">{ocupado ? 'Guardando…' : 'Registrar'}</button>
      </div>
    </form>
  )
}

/** Mensaje al terminar: qué pasó y, si algo opcional no se guardó, qué fue. */
export function avisoAlta(r: AltaResultado, quien: 'vendedora' | 'direccion'): string {
  const base = r.status === 'existente'
    ? `${r.nombre} ya estaba registrado (mismo celular). No se cambiaron sus datos: complétalos desde su ficha.`
    : quien === 'direccion'
      ? `${r.nombre} quedó registrado${r.faltas.length ? '' : ' con todos sus datos'}.`
      : r.status === 'asignado' ? `${r.nombre} ya existía sin vendedora: ahora es de tu cartera.` : `${r.nombre} quedó en tu cartera.`
  return r.faltas.length ? `${base} No se pudo guardar: ${r.faltas.join(' · ')}. Complétalo desde su ficha.` : base
}
