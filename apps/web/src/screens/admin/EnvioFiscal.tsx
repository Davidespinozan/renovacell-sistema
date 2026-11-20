// ENVÍO · CONCEPTO FISCAL (BLOQUE1, 20 nov 2026). Un pedido con costo de envío lleva un renglón «Envío» en la factura.
// Ese renglón necesita su clave SAT validada por una persona (igual que cada producto); sin ella, NINGÚN pedido con envío
// se puede facturar. La base ya lo tenía (fiscal_envio_ver / _guardar / _validar) pero no había pantalla.
import React, { useEffect, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { supabase, hasSupabase } from '../../lib/supabase'
import { OBJETOS, TRATAMIENTOS } from '../../data/ops/fiscalCatalogo'
import { avisar, confirmar } from '../../app/dialogos'

interface Envio { clave_prod_serv: string | null; clave_unidad: string | null; objeto_imp: string | null; tratamiento_iva: string | null; iva_tasa: number | null; descripcion_fiscal: string | null; validado: boolean; validado_at: string | null; fuente: string | null }
type Form = { clave_prod_serv: string; clave_unidad: string; objeto_imp: string; tratamiento_iva: string; iva_tasa: string; descripcion_fiscal: string }

// Sugerencia de partida (la persona la revisa con su contador antes de validar).
const SUGERIDO: Form = { clave_prod_serv: '78102203', clave_unidad: 'E48', objeto_imp: '02', tratamiento_iva: 'gravado', iva_tasa: '0.16', descripcion_fiscal: 'Servicio de envío' }
const limpiar = (m?: string) => (m ?? '').replace(/^[A-Z_]+:\s*/, '') || 'No se pudo guardar.'
const rpc = (fn: string, args?: Record<string, unknown>) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>

export function EnvioFiscal() {
  const [actual, setActual] = useState<Envio | null>(null)
  const [cargado, setCargado] = useState(false)
  const [form, setForm] = useState<Form>(SUGERIDO)
  const [ocupado, setOcupado] = useState(false)

  const cargar = async () => {
    if (!hasSupabase) { setCargado(true); return }
    const { data, error } = await rpc('fiscal_envio_ver')
    if (error) { void avisar(limpiar(error.message)); setCargado(true); return }
    const e = data as Envio | null
    setActual(e)
    if (e) setForm({
      clave_prod_serv: e.clave_prod_serv ?? '', clave_unidad: e.clave_unidad ?? '', objeto_imp: e.objeto_imp ?? '',
      tratamiento_iva: e.tratamiento_iva ?? '', iva_tasa: e.iva_tasa == null ? '' : String(e.iva_tasa), descripcion_fiscal: e.descripcion_fiscal ?? '',
    })
    setCargado(true)
  }
  useEffect(() => { void cargar() }, [])

  const llevaTasa = TRATAMIENTOS.find((t) => t.valor === form.tratamiento_iva)?.llevaTasa ?? false
  const cambios = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    const prev = actual
    const set = (k: keyof Form, v: unknown, p: unknown) => { if (v !== p) c[k] = v }
    set('clave_prod_serv', form.clave_prod_serv.trim() || null, prev?.clave_prod_serv ?? null)
    set('clave_unidad', form.clave_unidad.trim().toUpperCase() || null, prev?.clave_unidad ?? null)
    set('objeto_imp', form.objeto_imp || null, prev?.objeto_imp ?? null)
    set('tratamiento_iva', form.tratamiento_iva || null, prev?.tratamiento_iva ?? null)
    set('iva_tasa', llevaTasa && form.iva_tasa !== '' ? Number(form.iva_tasa) : null, prev?.iva_tasa == null ? null : Number(prev.iva_tasa))
    set('descripcion_fiscal', form.descripcion_fiscal.trim() || null, prev?.descripcion_fiscal ?? null)
    return c
  }

  const guardar = async (): Promise<boolean> => {
    const c = cambios()
    if (Object.keys(c).length === 0) return true
    if (actual?.validado && !(await confirmar('Al cambiar el concepto de envío deja de estar validado y hay que validarlo otra vez. ¿Seguir?'))) return false
    const { error } = await rpc('fiscal_envio_guardar', { p_cambios: c })
    if (error) { void avisar(limpiar(error.message)); return false }
    return true
  }

  const onGuardar = async () => { setOcupado(true); if (await guardar()) { await cargar(); void avisar('Guardado. Falta validarlo para poder facturar envíos.') } setOcupado(false) }
  const onValidar = async () => {
    if (!(await confirmar('¿Validar el concepto de envío? Confirmas que la clave SAT, la unidad y el IVA son correctos (revisados con el contador).', { aceptar: 'Validar' }))) return
    setOcupado(true)
    if (await guardar()) {
      const { error } = await rpc('fiscal_envio_validar', { p_fuente: 'Revisión fiscal · concepto Envío' })
      if (error) void avisar(limpiar(error.message))
      await cargar()
    }
    setOcupado(false)
  }

  if (!cargado) return <div className="card">Cargando…</div>
  return (
    <div className="card" data-testid="envio-fiscal">
      <div className="eyebrow" style={{ marginTop: 0 }}>Concepto «Envío» en la factura</div>
      <p className="lt" style={{ marginTop: 0 }}>
        Cuando un pedido cobra envío, la factura lleva un renglón «Envío». Sin este concepto <b>validado</b>, los pedidos con envío no se pueden facturar.
        {!actual && <> Te dejamos una sugerencia; revísala con tu contador antes de validar.</>}
      </p>
      <div className="pill-row" style={{ marginBottom: 12 }}>
        {actual?.validado
          ? <span className="pill p-ok"><BadgeCheck size={12} /> Validado</span>
          : <span className="pill p-warn">{actual ? 'Guardado · sin validar' : 'Sin configurar'}</span>}
      </div>
      <div className="envio-fiscal-grid">
        <label className="ef-campo"><span>Clave de producto/servicio (SAT)</span>
          <input value={form.clave_prod_serv} inputMode="numeric" onChange={(e) => setForm({ ...form, clave_prod_serv: e.target.value })} /></label>
        <label className="ef-campo"><span>Clave de unidad (SAT)</span>
          <input value={form.clave_unidad} onChange={(e) => setForm({ ...form, clave_unidad: e.target.value.toUpperCase() })} /></label>
        <label className="ef-campo"><span>Objeto de impuesto</span>
          <select value={form.objeto_imp} onChange={(e) => setForm({ ...form, objeto_imp: e.target.value })}>
            <option value="">Sin definir</option>
            {OBJETOS.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
          </select></label>
        <label className="ef-campo"><span>Tratamiento de IVA</span>
          <select value={form.tratamiento_iva} onChange={(e) => { const v = e.target.value; const t = TRATAMIENTOS.find((x) => x.valor === v); setForm({ ...form, tratamiento_iva: v, iva_tasa: t?.llevaTasa ? form.iva_tasa : '' }) }}>
            <option value="">Sin definir</option>
            {TRATAMIENTOS.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
          </select></label>
        <label className="ef-campo"><span>Tasa de IVA</span>
          <input value={form.iva_tasa} inputMode="decimal" disabled={!llevaTasa} onChange={(e) => setForm({ ...form, iva_tasa: e.target.value })} /></label>
        <label className="ef-campo"><span>Descripción en la factura</span>
          <input value={form.descripcion_fiscal} onChange={(e) => setForm({ ...form, descripcion_fiscal: e.target.value })} /></label>
      </div>
      <div className="ef-acciones">
        <button className="btn ghost" type="button" disabled={ocupado} onClick={() => void onGuardar()}>Guardar</button>
        {!actual?.validado && <button className="btn" type="button" disabled={ocupado} onClick={() => void onValidar()} data-testid="envio-validar"><BadgeCheck size={15} /> Validar</button>}
      </div>
    </div>
  )
}
