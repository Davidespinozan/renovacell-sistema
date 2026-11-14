// WA-PLANTILLAS (3 nov 2026) + WA-PLANTILLAS-META (14 nov 2026, dueño: «en Leadsales hacían plantillas y las mandaban a
// verificación; deberían poder hacer eso desde adentro»). Dirección crea las plantillas para retomar clientes de WhatsApp
// fuera de las 24 h, las manda a revisión de Meta y ve su estado aquí; al aprobarse se encienden solas para los vendedores.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { plantillasWA as plantillasPorDefecto, type PlantillaWA } from '../../data/ops/plantillasWA'
import { ESTADO_META, ETIQUETA_VARIABLE, VARIABLES, aLegibles, editable, validar, type Categoria, type Variable } from '../../../../../supabase/functions/_shared/plantillasMeta'
import { confirmar } from '../../app/dialogos'

type Form = { nombre: string | null; etiqueta: string; categoria: Categoria; texto: string; botones: string[] }
const VACIO: Form = { nombre: null, etiqueta: '', categoria: 'MARKETING', texto: '', botones: [] }
const legible = (texto: string) => texto.replace(/\{\{(cliente|vendedor|promocion|promocion_hasta)\}\}/g, (_m, v: Variable) => `[${ETIQUETA_VARIABLE[v]}]`)

export function PlantillasMeta({ cliente = plantillasPorDefecto() }: { cliente?: ReturnType<typeof plantillasPorDefecto> }) {
  const [lista, setLista] = useState<PlantillaWA[] | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const cargar = useCallback(async () => { setLista(await cliente.lista()) }, [cliente])
  const sincronizar = useCallback(async (aviso = false) => {
    setOcupado('sync'); const e = await cliente.sincronizar(); setOcupado(null)
    if (e) setMsg({ ok: false, texto: e }); else if (aviso) setMsg({ ok: true, texto: 'Estado actualizado con Meta.' })
    await cargar()
  }, [cliente, cargar])
  useEffect(() => { void cargar().then(() => sincronizar()) }, [cargar, sincronizar])

  const mandar = async (p: Pick<PlantillaWA, 'nombre' | 'etiqueta'>) => {
    setMsg(null); setOcupado(p.nombre)
    const r = await cliente.mandarAMeta(p.nombre); setOcupado(null)
    setMsg(r.ok ? { ok: true, texto: r.estado === 'APPROVED' ? `«${p.etiqueta}» ya está aprobada.` : `«${p.etiqueta}» se mandó a Meta. La revisión tarda de minutos a 2 días; aquí verás cuando quede aprobada.` } : { ok: false, texto: r.mensaje })
    await cargar()
  }
  const borrar = async (p: PlantillaWA) => {
    if (!(await confirmar(`¿Borrar la plantilla «${p.etiqueta}»?`))) return
    const e = await cliente.borrar(p.nombre); setMsg(e ? { ok: false, texto: e } : { ok: true, texto: 'Plantilla borrada.' }); await cargar()
  }
  const activar = async (p: PlantillaWA) => {
    if (!p.activa && !(await confirmar(`¿Meta ya aprobó «${p.etiqueta}»? Si no está aprobada, los envíos van a fallar.`))) return
    const e = await cliente.activar(p.nombre, !p.activa); if (e) setMsg({ ok: false, texto: e }); await cargar()
  }
  const editar = (p: PlantillaWA) => { setMsg(null); setForm({ nombre: p.nombre, etiqueta: p.etiqueta, categoria: p.categoria, texto: aLegibles(p.cuerpo, p.variables), botones: p.botones ?? [] }) }
  const insertar = (v: Variable) => {
    if (!form) return
    const el = area.current; const ini = el?.selectionStart ?? form.texto.length; const fin = el?.selectionEnd ?? ini
    setForm({ ...form, texto: form.texto.slice(0, ini) + `{{${v}}}` + form.texto.slice(fin) })
    requestAnimationFrame(() => { el?.focus(); const pos = ini + v.length + 4; el?.setSelectionRange(pos, pos) })
  }
  const guardar = async (yMandar: boolean) => {
    if (!form) return
    const v = validar({ etiqueta: form.etiqueta, categoria: form.categoria, texto: form.texto, botones: form.botones })
    if (!v.ok) { setMsg({ ok: false, texto: v.error }); return }
    const nombre = form.nombre ?? v.plantilla.nombre
    if (!form.nombre && lista?.some((x) => x.nombre === nombre)) { setMsg({ ok: false, texto: 'Ya hay una plantilla con ese nombre; usa otro.' }); return }
    setOcupado('guardar')
    const etiqueta = form.etiqueta.trim()
    const e = await cliente.guardar({ nombre, etiqueta, categoria: v.plantilla.categoria, cuerpo: v.plantilla.cuerpo, variables: v.plantilla.variables, botones: v.plantilla.botones })
    setOcupado(null)
    if (e) { setMsg({ ok: false, texto: e }); return }
    setForm(null); await cargar()
    if (yMandar) await mandar({ nombre, etiqueta })
    else setMsg({ ok: true, texto: 'Plantilla guardada. Cuando esté lista, tócale «Mandar a Meta».' })
  }

  const activas = lista?.filter((p) => p.activa).length ?? 0
  return (
    <details className="card wa-tpl" data-testid="plantillas-meta" open>
      <summary>Plantillas de WhatsApp <span className="pill p-neu">{activas} {activas === 1 ? 'aprobada' : 'aprobadas'}</span></summary>
      <p className="wa-tpl-ayuda">Pasadas 24 horas del último mensaje del cliente, WhatsApp solo deja mandar mensajes que Meta aprobó. Créalos aquí, mándalos a revisión y, cuando Meta los apruebe, tus vendedores los usan con «Retomar por WhatsApp» en el chat.</p>
      <div className="wa-tpl-barra">
        <button type="button" className="btn sm" onClick={() => { setMsg(null); setForm({ ...VACIO }) }} disabled={!!form} data-testid="plantilla-nueva">Nueva plantilla</button>
        <button type="button" className="btn ghost sm" onClick={() => void sincronizar(true)} disabled={ocupado === 'sync'} data-testid="plantillas-sync">{ocupado === 'sync' ? 'Consultando a Meta…' : 'Actualizar estado'}</button>
      </div>
      {msg && <div role={msg.ok ? 'status' : 'alert'} className={'wa-tpl-msg' + (msg.ok ? ' ok' : '')} data-testid="plantillas-msg">{msg.texto}</div>}

      {form && (
        <form className="wa-tpl-form" onSubmit={(e) => { e.preventDefault(); void guardar(true) }} data-testid="plantilla-form">
          <label>Nombre (para ustedes)<input value={form.etiqueta} onChange={(e) => setForm({ ...form, etiqueta: e.target.value })} disabled={!!form.nombre} maxLength={60} placeholder="p. ej. Recordatorio de pedido" data-testid="plantilla-etiqueta" /></label>
          <div className="wa-tpl-tipo" role="radiogroup" aria-label="Tipo">
            {(['MARKETING', 'UTILITY'] as Categoria[]).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={form.categoria === c} className={form.categoria === c ? 'on' : ''} onClick={() => setForm({ ...form, categoria: c })}>
                <b>{c === 'MARKETING' ? 'Marketing' : 'Utilidad'}</b><small>{c === 'MARKETING' ? 'Seguimiento, ofertas, promociones' : 'Avisos de su cuenta o pedido (Meta la revisa más estricto)'}</small>
              </button>
            ))}
          </div>
          <label>Mensaje
            <textarea ref={area} rows={4} value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} maxLength={1024} placeholder="Hola {{cliente}}, le saluda {{vendedor}} de Renovacell…" data-testid="plantilla-texto" />
          </label>
          <div className="wa-tpl-datos"><small>Agregar dato:</small>{VARIABLES.map((v) => <button key={v} type="button" className="pc-chip" onClick={() => insertar(v)} data-testid={`plantilla-dato-${v}`}>{ETIQUETA_VARIABLE[v]}</button>)}</div>
          <div className="wa-tpl-botones">
            <small>Botones de respuesta (opcional, máximo 3):</small>
            {form.botones.map((b, i) => (
              <span key={i} className="wa-tpl-boton"><input value={b} maxLength={25} onChange={(e) => setForm({ ...form, botones: form.botones.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Botón ${i + 1}`} />
                <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, botones: form.botones.filter((_, j) => j !== i) })}>Quitar</button></span>
            ))}
            {form.botones.length < 3 && <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, botones: [...form.botones, ''] })} data-testid="plantilla-boton-mas">+ Botón</button>}
          </div>
          {form.texto.trim() && (
            <div className="wa-tpl-vista" data-testid="plantilla-vista"><small>Así le llega al cliente:</small>
              <div className="rc-wa-vista">{legible(form.texto)}</div>
              {form.botones.filter(Boolean).length > 0 && <div className="wa-tpl-vbotones">{form.botones.filter(Boolean).map((b) => <span key={b}>{b}</span>)}</div>}
            </div>
          )}
          <div className="wa-tpl-acciones">
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button type="button" className="btn ghost" onClick={() => void guardar(false)} disabled={ocupado === 'guardar'}>Guardar sin mandar</button>
            <button type="submit" className="btn" disabled={ocupado === 'guardar'} data-testid="plantilla-guardar-mandar">Guardar y mandar a Meta</button>
          </div>
        </form>
      )}

      {lista === null ? <small>Cargando…</small> : lista.length === 0 ? <small>Aún no hay plantillas.</small> : (
        <ul className="wa-tpl-lista">
          {lista.map((p) => {
            const est = ESTADO_META[p.estado_meta ?? 'sin_enviar'] ?? { texto: p.estado_meta ?? '', tono: 'p-neu' as const }
            return (
              <li key={p.nombre} data-testid="plantilla-meta">
                <div className="wa-tpl-cab">
                  <b>{p.etiqueta}</b>
                  <span className="pill p-neu">{p.categoria === 'MARKETING' ? 'Marketing' : 'Utilidad'}</span>
                  <span className={'pill ' + est.tono} data-testid={`plantilla-estado-${p.nombre}`}>{est.texto}</span>
                </div>
                <div className="rc-wa-vista">{legible(aLegibles(p.cuerpo, p.variables))}</div>
                {p.botones && p.botones.length > 0 && <div className="wa-tpl-vbotones">{p.botones.map((b) => <span key={b}>{b}</span>)}</div>}
                {p.estado_meta === 'REJECTED' && <small className="wa-tpl-rech">Meta la rechazó{p.motivo_meta ? ` (${p.motivo_meta.replace(/_/g, ' ').toLowerCase()})` : ''}. Corrígela y vuelve a mandarla.</small>}
                <div className="wa-tpl-acc">
                  {editable(p.estado_meta) && <button type="button" className="btn sm" onClick={() => void mandar(p)} disabled={ocupado === p.nombre} data-testid={`plantilla-mandar-${p.nombre}`}>{ocupado === p.nombre ? 'Mandando…' : p.estado_meta === 'REJECTED' ? 'Volver a mandar' : 'Mandar a Meta'}</button>}
                  {editable(p.estado_meta) && <button type="button" className="btn ghost sm" onClick={() => editar(p)}>Editar</button>}
                  {editable(p.estado_meta) && !p.usada && <button type="button" className="btn ghost sm" onClick={() => void borrar(p)}>Borrar</button>}
                  {(p.estado_meta ?? 'sin_enviar') === 'sin_enviar' && (
                    // respaldo: si alguien la dio de alta a mano en WhatsApp Manager y «Actualizar estado» no la encuentra
                    <label className="wa-tpl-manual"><input type="checkbox" checked={p.activa} onChange={() => void activar(p)} data-testid={`plantilla-activa-${p.nombre}`} /> Ya la aprobó Meta (manual)</label>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}
