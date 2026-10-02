// ADMIN · REVISIÓN FISCAL DEL CATÁLOGO (W3-C · C3)
//
// Aquí Renovacell revisa, corrige y VALIDA el dato fiscal de cada producto. Tres
// autoridades distintas, deliberadamente separadas en pantalla para que nadie las
// confunda:
//
//   1. VERDAD COMERCIAL   — solo lectura. Es lo que ya se vendió; no se toca desde aquí.
//   2. BORRADOR FISCAL    — editable, pero NO es autoridad hasta que una persona lo valida.
//   3. EVIDENCIA HISTÓRICA — evidencia de PRECIO. Nunca de impuesto.
//
// Dos reglas que gobiernan la pantalla completa:
//   · Validar es un acto humano explícito, producto por producto. No hay "validar
//     todo", ni validación automática porque los campos estén llenos, ni validación
//     derivada de la aritmética de precios o de los candidatos de categoría.
//   · La autoridad vive en el servidor. Que un botón se vea no significa permiso:
//     el comando puede negarse y aquí solo se traduce su respuesta.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BadgeCheck, Check, FileSearch, Info, Layers, Lock, Pencil, Search, Unlink, X } from 'lucide-react'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { ConfirmModal } from '../../app/ConfirmModal'
import { money } from '../../lib/format'
import { useRevisionFiscal, useEvidenciaProducto, useFichaFiscal } from '../../data/hooks/useRevisionFiscal'
import {
  editarFiscal, validarFiscal, invalidarFiscal, aplicarPropuestaCategoria, definirDefaults,
  estadoDeFila, EVIDENCIA, OBJETOS, TRATAMIENTOS, PROCEDENCIA_TEXTO,
  type CambiosFiscales, type EvidenciaClase, type FilaRevisionFiscal,
  type ObservacionEvidencia, type Procedencia, type EstadoFila,
} from '../../data/ops/fiscalCatalogo'

type Tab = 'productos' | 'categorias' | 'huerfanas'
type Aviso = { ok: boolean; text: string } | null

// Cada bloque del detalle se separa visualmente según QUIÉN manda en él.
const BLOQUE: React.CSSProperties = { marginTop: 16, padding: '12px 14px', borderRadius: 12 }

// El sistema de diseño no tiene clase de input: se estilan en línea, como en Precios.
const INP: React.CSSProperties = {
  padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 10,
  fontFamily: 'inherit', fontSize: 13, outline: 'none', background: '#fff', width: '100%',
}

const ESTADO: Record<EstadoFila, { label: string; cls: string }> = {
  validado: { label: 'Validado', cls: 'p-ok' },
  pendiente: { label: 'Completo · sin validar', cls: 'p-warn' },
  incompleto: { label: 'Incompleto', cls: 'p-dang' },
}

const FALTANTE_TEXTO: Record<string, string> = {
  clave_prod_serv: 'Clave de producto/servicio del SAT',
  clave_unidad: 'Clave de unidad del SAT',
  objeto_imp: 'Objeto de impuesto',
  tratamiento_iva: 'Tratamiento de IVA',
  descripcion_fiscal: 'Descripción fiscal',
}
const faltanteTexto = (k: string) => FALTANTE_TEXTO[k] ?? k

export function RevisionFiscal() {
  const { data, defaults, huerfanas, avance, categorias, loading, reload } = useRevisionFiscal()
  const [tab, setTab] = useState<Tab>('productos')

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Revisión fiscal del catálogo">
        Cada producto necesita su dato fiscal <b>revisado y validado por una persona</b> antes de poder
        facturarse. Un producto sin validar no se factura: el sistema rechaza la factura completa en
        lugar de inventar un valor.
      </PageHead>

      <Avance a={avance} loading={loading} />

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {([['productos', `Productos (${avance.total})`],
           ['categorias', `Candidatos por categoría (${defaults.length})`],
           ['huerfanas', `Evidencia sin producto (${huerfanas.length})`]] as const).map(([k, lbl]) => (
          <button key={k} type="button" className={tab === k ? 'active' : undefined} onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {tab === 'productos' && <TabProductos filas={data} categorias={categorias} loading={loading} reload={reload} />}
      {tab === 'categorias' && <TabCategorias defaults={defaults} categorias={categorias} reload={reload} />}
      {tab === 'huerfanas' && <TabHuerfanas filas={huerfanas} />}
    </div>
  )
}

// ============================== AVANCE ==============================
function Avance({ a, loading }: { a: ReturnType<typeof useRevisionFiscal>['avance']; loading: boolean }) {
  const pct = a.total ? Math.round((a.validados / a.total) * 100) : 0
  return (
    <div className="card" style={{ padding: 16, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
      <div>
        <div className="eyebrow" style={{ margin: 0 }}>Avance de validación</div>
        <div style={{ fontSize: 26, fontWeight: 700 }}>
          {loading ? '…' : <>{a.validados} <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--muted)' }}>de {a.total} · {pct}%</span></>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span className="pill p-ok">{a.validados} validados</span>
        <span className="pill p-warn">{a.pendientes} completos sin validar</span>
        <span className="pill p-dang">{a.incompletos} incompletos</span>
      </div>
      {a.total > 0 && a.validados < a.total && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', maxWidth: 420 }}>
          Mientras falte un producto por validar, solo se pueden facturar pedidos cuyos productos
          <b> ya estén validados</b>. No hay facturación parcial ni valores por omisión.
        </p>
      )}
    </div>
  )
}

// ============================== PRODUCTOS ==============================
function TabProductos({ filas, categorias, loading, reload }: {
  filas: FilaRevisionFiscal[]; categorias: string[]; loading: boolean; reload: () => Promise<void>
}) {
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState<'todos' | EstadoFila>('todos')
  const [cat, setCat] = useState('')
  // Filtro por evidencia histórica. 'con'/'sin' y además por clasificación, para
  // poder revisar en bloque los casos que más cuidado piden (MISMATCH, EQUALS_FINAL).
  const [ev, setEv] = useState<'todas' | 'con' | 'sin' | EvidenciaClase>('todas')
  const [abierto, setAbierto] = useState<string | null>(null)

  const lista = useMemo(() => {
    const s = q.trim().toLowerCase()
    return filas.filter((f) => {
      if (estado !== 'todos' && estadoDeFila(f) !== estado) return false
      if (cat && f.categoria !== cat) return false
      if (ev === 'con' && !f.evidencia_historica) return false
      if (ev === 'sin' && f.evidencia_historica) return false
      if (ev !== 'todas' && ev !== 'con' && ev !== 'sin' && f.evidencia_historica !== ev) return false
      if (s && !`${f.sku ?? ''} ${f.nombre}`.toLowerCase().includes(s)) return false
      return true
    })
  }, [filas, q, estado, cat, ev])

  const sel = useMemo(() => filas.find((f) => f.product_id === abierto) ?? null, [filas, abierto])

  // El detalle se abre DEBAJO de la lista: sin esto, pulsar "Revisar" no parece
  // hacer nada en una pantalla alta. Lo llevamos a la vista.
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (abierto) panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [abierto])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card" style={{ padding: 0, minWidth: 0 }}>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="eyebrow" style={{ margin: 0 }}><FileSearch size={13} /> Productos vendibles · {lista.length}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <Search size={13} style={{ position: 'absolute', left: 9, color: 'var(--muted)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU o producto" aria-label="Buscar producto"
                style={{ padding: '8px 11px 8px 27px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
            </span>
            <select value={estado} onChange={(e) => setEstado(e.target.value as 'todos' | EstadoFila)} aria-label="Filtrar por estado"
              style={{ padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13 }}>
              <option value="todos">Todos los estados</option>
              <option value="incompleto">Incompletos</option>
              <option value="pendiente">Completos sin validar</option>
              <option value="validado">Validados</option>
            </select>
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrar por categoría"
              style={{ padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13 }}>
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={ev} onChange={(e) => setEv(e.target.value as typeof ev)} aria-label="Filtrar por evidencia histórica"
              style={{ padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13 }}>
              <option value="todas">Toda la evidencia</option>
              <option value="con">Con evidencia histórica</option>
              <option value="sin">Sin evidencia histórica</option>
              {(Object.keys(EVIDENCIA) as EvidenciaClase[]).map((k) => (
                <option key={k} value={k}>{EVIDENCIA[k].etiqueta}</option>
              ))}
            </select>
            <ExportButton name="revision-fiscal" title="Revisión fiscal del catálogo" rows={lista} columns={[
              { key: 'sku', label: 'SKU' },
              { key: 'nombre', label: 'Producto' },
              { key: 'categoria', label: 'Categoría' },
              { key: 'clave_prod_serv', label: 'Clave SAT' },
              { key: 'clave_unidad', label: 'Unidad SAT' },
              { key: 'objeto_imp', label: 'Objeto imp.' },
              { key: 'tratamiento_iva', label: 'Tratamiento IVA' },
              { key: 'iva_tasa', label: 'Tasa' },
              { key: 'validado', label: 'Validado', format: (v) => (v === true ? 'sí' : 'no') },
              { key: 'validado_por_nombre', label: 'Validado por' },
              { key: 'faltantes', label: 'Falta capturar', format: (v) => ((v as string[]) ?? []).map(faltanteTexto).join(' · ') },
            ]} />
          </div>
        </div>
        <div className="tbl-scroll">
          <table className="tbl-cards">
            <thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th>Precio final</th><th>Fiscal</th><th>Evidencia</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ color: 'var(--muted)' }}>Cargando el catálogo fiscal…</td></tr>}
              {!loading && lista.length === 0 && (
                <tr><td colSpan={8} style={{ color: 'var(--muted)' }}>
                  {filas.length === 0
                    ? 'Todavía no hay productos vendibles con ficha fiscal. Revisa que el catálogo comercial esté cargado.'
                    : 'Ningún producto coincide con los filtros.'}
                </td></tr>
              )}
              {lista.map((f) => {
                const e = estadoDeFila(f)
                return (
                  <tr key={f.product_id} style={{ cursor: 'pointer' }} onClick={() => setAbierto(f.product_id)}>
                    <td data-label="SKU" className="mono" style={{ fontSize: 12 }}>{f.sku ?? '—'}</td>
                    <td data-label="Producto">{f.nombre}</td>
                    <td data-label="Categoría">{f.categoria ?? '—'}</td>
                    <td data-label="Precio final">{f.precio_final != null ? money(f.precio_final) : '—'}</td>
                    <td data-label="Fiscal">
                      <span className="mono" style={{ fontSize: 12 }}>
                        {f.clave_prod_serv ?? '—'} · {f.clave_unidad ?? '—'} · {f.objeto_imp ?? '—'} · {f.tratamiento_iva ?? '—'}
                        {f.iva_tasa != null ? ` · ${f.iva_tasa}` : ''}
                      </span>
                      {f.descripcion_fiscal && (
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{f.descripcion_fiscal}</div>
                      )}
                    </td>
                    <td data-label="Evidencia">
                      {f.evidencia_historica
                        ? <EtiquetaEvidencia clase={f.evidencia_historica as EvidenciaClase} />
                        : <span style={{ fontSize: 12, color: 'var(--muted)' }}>sin evidencia</span>}
                    </td>
                    <td data-label="Estado">
                      <span className={`pill ${ESTADO[e].cls}`}>{ESTADO[e].label}</span>
                      {f.validado && (f.validado_por_nombre || f.validado_at) && (
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                          {f.validado_por_nombre ?? 'validado'}
                          {f.validado_at ? ` · ${new Date(f.validado_at).toLocaleDateString('es-MX')}` : ''}
                        </div>
                      )}
                      {e === 'incompleto' && (
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                          Falta: {f.faltantes.map(faltanteTexto).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td data-label=""><button type="button" className="btn ghost sm" onClick={(ev) => { ev.stopPropagation(); setAbierto(f.product_id) }}>Revisar</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div ref={panel}>
        {sel && <DetalleProducto f={sel} onClose={() => setAbierto(null)} reload={reload} />}
      </div>
    </div>
  )
}

// ============================== DETALLE ==============================
const vacio = (v: string | null | undefined) => (v == null ? '' : String(v))

function DetalleProducto({ f, onClose, reload }: { f: FilaRevisionFiscal; onClose: () => void; reload: () => Promise<void> }) {
  const { data: evidencia, loading: cargandoEv } = useEvidenciaProducto(f.product_id)
  const [version, setVersion] = useState(0)
  const ficha = useFichaFiscal(f.product_id, version)
  const [form, setForm] = useState({
    clave_prod_serv: vacio(f.clave_prod_serv), clave_unidad: vacio(f.clave_unidad),
    objeto_imp: vacio(f.objeto_imp), tratamiento_iva: vacio(f.tratamiento_iva),
    iva_tasa: f.iva_tasa == null ? '' : String(f.iva_tasa),
    descripcion_fiscal: vacio(f.descripcion_fiscal),
    fuente: '', notas: '',
  })
  const [motivo, setMotivo] = useState('')
  const [fuenteVal, setFuenteVal] = useState('')
  const [notasVal, setNotasVal] = useState('')
  const [aviso, setAviso] = useState<Aviso>(null)
  const [guardando, setGuardando] = useState(false)
  const [confirmar, setConfirmar] = useState<'validar' | 'invalidar' | null>(null)

  // La ficha llega después de la primera pintada: en cuanto está, se siembran
  // `fuente` y `notas` para que el borrador muestre lo vigente y no un hueco falso.
  useEffect(() => {
    if (!ficha) return
    setForm((v) => ({ ...v, fuente: vacio(ficha.fuente), notas: vacio(ficha.notas) }))
    setFuenteVal((v) => (v === '' ? vacio(ficha.fuente) : v))
  }, [ficha])

  const trat = TRATAMIENTOS.find((t) => t.valor === form.tratamiento_iva)
  const llevaTasa = trat?.llevaTasa ?? false

  // Solo viajan los campos que el operador cambió: así "no lo toques" y "ponlo en
  // nulo" siguen siendo cosas distintas para el comando.
  const cambios = useMemo<CambiosFiscales>(() => {
    const c: CambiosFiscales = {}
    const orig: Record<string, string> = {
      clave_prod_serv: vacio(f.clave_prod_serv), clave_unidad: vacio(f.clave_unidad),
      objeto_imp: vacio(f.objeto_imp), tratamiento_iva: vacio(f.tratamiento_iva),
      iva_tasa: f.iva_tasa == null ? '' : String(f.iva_tasa),
      descripcion_fiscal: vacio(f.descripcion_fiscal),
      fuente: vacio(ficha?.fuente), notas: vacio(ficha?.notas),
    }
    for (const [k, v] of Object.entries(form)) {
      if (v.trim() === orig[k].trim()) continue
      ;(c as Record<string, string | null>)[k] = v.trim() === '' ? null : v.trim()
    }
    return c
  }, [form, f, ficha])
  const sucio = Object.keys(cambios).length > 0

  // Un cambio en un dato MATERIAL de un producto validado tumba la validación. Lo
  // avisamos ANTES de guardar; la base lo hace de todas formas.
  const MATERIALES = ['clave_prod_serv', 'clave_unidad', 'objeto_imp', 'tratamiento_iva', 'iva_tasa', 'descripcion_fiscal']
  const tumbaValidacion = f.validado && Object.keys(cambios).some((k) => MATERIALES.includes(k))

  const guardar = async () => {
    setGuardando(true); setAviso(null)
    const r = await editarFiscal(f.product_id, cambios, motivo.trim() || undefined)
    setGuardando(false)
    if (!r.ok) { setAviso({ ok: false, text: r.error }); return }
    setMotivo('')
    setAviso({ ok: true, text: r.data.invalidado_por_el_cambio
      ? 'Cambios guardados. La validación anterior quedó sin efecto porque cambió un dato fiscal material: hay que volver a validar.'
      : 'Cambios guardados. Siguen siendo un borrador: todavía no están validados.' })
    setVersion((v) => v + 1)
    await reload()
  }

  const validar = async () => {
    setGuardando(true); setAviso(null)
    const r = await validarFiscal(f.product_id, fuenteVal.trim(), notasVal.trim() || undefined)
    setGuardando(false); setConfirmar(null)
    if (!r.ok) { setAviso({ ok: false, text: r.error }); return }
    setNotasVal('')
    setAviso({ ok: true, text: 'Producto validado. Queda registrado quién validó, cuándo y en qué se basó.' })
    setVersion((v) => v + 1)
    await reload()
  }

  const invalidar = async () => {
    setGuardando(true); setAviso(null)
    const r = await invalidarFiscal(f.product_id, motivo.trim())
    setGuardando(false); setConfirmar(null)
    if (!r.ok) { setAviso({ ok: false, text: r.error }); return }
    setMotivo('')
    setAviso({ ok: true, text: 'Validación retirada. El producto no se puede facturar hasta volver a validarlo.' })
    setVersion((v) => v + 1)
    await reload()
  }

  const est = estadoDeFila(f)
  const puedeValidar = !f.validado && f.faltantes.length === 0 && !sucio && fuenteVal.trim().length > 0

  return (
    <>
    <div className="card" style={{ padding: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow" style={{ margin: 0 }}>Revisión · {f.sku ?? 's/SKU'}</div>
          <h2 style={{ margin: '2px 0 0', fontSize: 19 }}>{f.nombre}</h2>
        </div>
        <span className={`pill ${ESTADO[est].cls}`} style={{ marginTop: 4 }}>{ESTADO[est].label}</span>
        <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Cerrar revisión"><X size={14} /> Cerrar</button>
      </div>

      {aviso && (
        <p role="status" style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 10, fontSize: 13,
          background: aviso.ok ? 'var(--ok-bg)' : 'var(--danger-bg)' }}>
          {aviso.text}
        </p>
      )}

      {f.validado && (
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          <Lock size={12} /> Validado{f.validado_por_nombre ? ` por ${f.validado_por_nombre}` : ''}
          {f.validado_at ? ` el ${new Date(f.validado_at).toLocaleString('es-MX')}` : ''}.
        </p>
      )}

      {/* ---------- 1. VERDAD COMERCIAL ---------- */}
      <section style={{ ...BLOQUE, background: '#F4F6F3', borderLeft: '3px solid var(--ink-3)' }}>
        <div className="eyebrow" style={{ marginTop: 0 }}>
          <Lock size={12} /> 1 · Verdad comercial
          <span style={{ fontWeight: 400, textTransform: 'none' }}> — solo lectura, no se edita aquí</span>
        </div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 13 }}>
          <Dato k="Categoría" v={f.categoria ?? '—'} />
          <Dato k="Unidad comercial" v={f.unidad_comercial ?? 'sin unidad'} />
          <Dato k="Precio final" v={f.precio_final != null ? money(f.precio_final) : '—'} />
        </div>
        {!f.unidad_comercial && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
            Este producto no tiene unidad comercial registrada. No impide validarlo, pero conviene elegir
            la clave de unidad del SAT con más cuidado.
          </p>
        )}
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          El precio es final: así se cobró. Desde esta pantalla no se modifica ningún precio.
        </p>
      </section>

      {/* ---------- 2. BORRADOR FISCAL ---------- */}
      <section style={{ ...BLOQUE, background: '#fff', borderLeft: '3px solid var(--green-deep)' }}>
        <div className="eyebrow" style={{ marginTop: 0 }}>
          <Pencil size={12} /> 2 · Borrador fiscal
          <span style={{ fontWeight: 400, textTransform: 'none' }}> — editable, aún SIN autoridad fiscal</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          <Campo label="Clave de producto/servicio (SAT)" hint="8 dígitos">
            <input value={form.clave_prod_serv} onChange={(e) => setForm({ ...form, clave_prod_serv: e.target.value })} inputMode="numeric" style={INP} />
          </Campo>
          <Campo label="Clave de unidad (SAT)" hint="hasta 3 caracteres, p. ej. H87">
            <input value={form.clave_unidad} onChange={(e) => setForm({ ...form, clave_unidad: e.target.value.toUpperCase() })} style={INP} />
          </Campo>
          <Campo label="Objeto de impuesto">
            <select value={form.objeto_imp} onChange={(e) => setForm({ ...form, objeto_imp: e.target.value })} style={INP}>
              <option value="">Sin definir</option>
              {OBJETOS.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
            </select>
          </Campo>
          <Campo label="Tratamiento de IVA">
            <select value={form.tratamiento_iva} onChange={(e) => {
              const v = e.target.value
              const t = TRATAMIENTOS.find((x) => x.valor === v)
              // Si el tratamiento no lleva tasa, se limpia: la base rechaza la mezcla.
              setForm({ ...form, tratamiento_iva: v, iva_tasa: t?.llevaTasa ? form.iva_tasa : '' })
            }} style={INP}>
              <option value="">Sin definir</option>
              {TRATAMIENTOS.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
            </select>
          </Campo>
          <Campo label="Tasa de IVA" hint={llevaTasa ? 'gravado: 0.16 · tasa cero: 0' : 'no aplica a este tratamiento'}>
            <input value={form.iva_tasa} onChange={(e) => setForm({ ...form, iva_tasa: e.target.value })} inputMode="decimal"
              disabled={!llevaTasa} style={INP} />
          </Campo>
          <Campo label="Descripción fiscal" hint="lo que verá el cliente en la factura">
            <input value={form.descripcion_fiscal} onChange={(e) => setForm({ ...form, descripcion_fiscal: e.target.value })} style={INP} />
          </Campo>
          <Campo label="Fuente" hint="en qué se basa esta configuración">
            <input value={form.fuente} onChange={(e) => setForm({ ...form, fuente: e.target.value })} style={INP} />
          </Campo>
          <Campo label="Notas" hint="contexto para quien revise después">
            <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} style={INP} />
          </Campo>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          Cambiar <b>fuente</b> o <b>notas</b> no retira la validación: no son datos que viajen al CFDI.
        </p>

        {f.advertencias?.length > 0 && (
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)' }}>
            {f.advertencias.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}

        {tumbaValidacion && (
          <p style={{ margin: '10px 0 0', padding: '9px 12px', borderRadius: 10, fontSize: 12.5, background: 'var(--warn-bg)' }}>
            <AlertTriangle size={13} /> Estás cambiando un dato fiscal material de un producto ya validado.
            Al guardar, la validación se retira y habrá que validarlo de nuevo.
          </p>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Campo label="Motivo del cambio" hint="opcional, queda en la bitácora">
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...INP, minWidth: 240 }} />
          </Campo>
          <button type="button" className="btn" disabled={!sucio || guardando} onClick={() => void guardar()}>
            <Check size={14} /> {guardando ? 'Guardando…' : 'Guardar borrador'}
          </button>
          {sucio && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Guardar no valida nada.</span>}
        </div>
      </section>

      {/* ---------- 3. EVIDENCIA HISTÓRICA ---------- */}
      <section style={{ ...BLOQUE, background: 'var(--warn-bg)', borderLeft: '3px solid var(--warn)' }}>
        <div className="eyebrow" style={{ marginTop: 0 }}>3 · Evidencia histórica comercial</div>
        {/* El aviso que impide el malentendido más caro de esta pantalla: va en
            grande, no escondido en un encabezado pequeño. */}
        <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <AlertTriangle size={16} /> EVIDENCIA HISTÓRICA COMERCIAL — NO ES AUTORIDAD FISCAL
        </p>
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-2)' }}>
          Lo que sigue son observaciones de <b>PRECIO</b> tomadas de la conciliación histórica. Sirven para
          orientar la revisión. <b>Ninguna determina el tratamiento de IVA ni la clave del SAT</b>, y nada de
          esto valida un producto.
        </p>
        {cargandoEv && <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Buscando evidencia…</p>}
        {!cargandoEv && evidencia.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            Sin evidencia histórica para este producto. No es un problema: solo significa que no apareció en
            la conciliación. Decide con criterio fiscal, no con el histórico.
          </p>
        )}
        {evidencia.map((o) => <Observacion key={o.id} o={o} />)}
      </section>

      {/* ---------- VALIDACIÓN ---------- */}
      <section style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <div className="eyebrow"><BadgeCheck size={13} /> Validación fiscal</div>
        {f.validado ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Campo label="Motivo para retirar la validación" hint="obligatorio">
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...INP, minWidth: 260 }} />
            </Campo>
            <button type="button" className="btn ghost sm" disabled={guardando || motivo.trim() === ''} onClick={() => setConfirmar('invalidar')}>
              <Unlink size={14} /> Retirar validación
            </button>
          </div>
        ) : (
          <>
            <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--muted)' }}>
              Validar es tu decisión, producto por producto. Quedará registrado tu nombre, la fecha y en qué
              te basaste. No existe "validar todo".
            </p>
            {f.faltantes.length > 0 && (
              <p style={{ margin: '0 0 10px', padding: '9px 12px', borderRadius: 10, fontSize: 12.5, background: 'var(--danger-bg)' }}>
                Falta completar: <b>{f.faltantes.map(faltanteTexto).join(' · ')}</b>. No se puede validar un
                producto incompleto.
              </p>
            )}
            {sucio && (
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--muted)' }}>
                Tienes cambios sin guardar. Guarda el borrador antes de validar, para que valides exactamente
                lo que quedó registrado.
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Campo label="¿En qué te basas?" hint="criterio del contador, oficio, catálogo del SAT…">
                <input value={fuenteVal} onChange={(e) => setFuenteVal(e.target.value)} style={{ ...INP, minWidth: 260 }} />
              </Campo>
              <Campo label="Notas" hint="opcional">
                <input value={notasVal} onChange={(e) => setNotasVal(e.target.value)} style={{ ...INP, minWidth: 200 }} />
              </Campo>
              <button type="button" className="btn" disabled={!puedeValidar || guardando} onClick={() => setConfirmar('validar')}>
                <BadgeCheck size={14} /> Validar este producto
              </button>
            </div>
          </>
        )}
      </section>

    </div>

      {confirmar === 'validar' && (
        <ConfirmModal
          title="Validar el dato fiscal"
          message={
            <span>
              Vas a declarar correcto el dato fiscal de <b>{f.nombre}</b>. A partir de aquí este producto
              puede facturarse con <b>exactamente</b> esta configuración, y tu nombre queda asociado a la decisión.
              <span style={{ display: 'block', marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--ok-bg)', fontSize: 12.5 }}>
                <b>Esto es lo que estás aprobando:</b>
                <span style={{ display: 'block' }}>Clave producto/servicio: <b className="mono">{f.clave_prod_serv ?? '—'}</b></span>
                <span style={{ display: 'block' }}>Clave de unidad: <b className="mono">{f.clave_unidad ?? '—'}</b></span>
                <span style={{ display: 'block' }}>Objeto de impuesto: <b>{OBJETOS.find((o) => o.valor === f.objeto_imp)?.etiqueta ?? f.objeto_imp ?? '—'}</b></span>
                <span style={{ display: 'block' }}>Tratamiento de IVA: <b>{TRATAMIENTOS.find((t) => t.valor === f.tratamiento_iva)?.etiqueta ?? f.tratamiento_iva ?? '—'}</b>{f.iva_tasa != null ? <> · tasa <b>{f.iva_tasa}</b></> : null}</span>
                <span style={{ display: 'block' }}>Descripción fiscal: <b>{f.descripcion_fiscal ?? '—'}</b></span>
                <span style={{ display: 'block', marginTop: 6 }}>Te basas en: <b>{fuenteVal.trim()}</b></span>
              </span>
            </span>
          }
          confirmLabel="Sí, validar"
          onClose={() => setConfirmar(null)}
          onConfirm={() => void validar()}
        />
      )}
      {confirmar === 'invalidar' && (
        <ConfirmModal
          title="Retirar la validación"
          message={`"${f.nombre}" dejará de poder facturarse hasta que alguien lo valide de nuevo. Los pedidos ya facturados no se tocan.`}
          confirmLabel="Sí, retirar"
          onClose={() => setConfirmar(null)}
          onConfirm={() => void invalidar()}
        />
      )}
    </>
  )
}

function Observacion({ o }: { o: ObservacionEvidencia }) {
  const meta = EVIDENCIA[o.clasificacion as EvidenciaClase]
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', marginBottom: 8, background: '#fff' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <span className={`pill ${meta?.tono === 'dang' ? 'p-dang' : meta?.tono === 'warn' ? 'p-warn' : 'p-neu'}`}>
          {meta?.etiqueta ?? o.clasificacion}
        </span>
        <span className="mono" style={{ fontSize: 12 }}>{o.source_ref}</span>
        <span>{o.source_nombre}</span>
        {o.precio_historico != null && <span>histórico {money(o.precio_historico)}</span>}
        {o.precio_publicado != null && <span>publicado {money(o.precio_publicado)}</span>}
      </div>
      {meta && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{meta.advertencia}</p>}
      {o.procedencia && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
          {PROCEDENCIA_TEXTO[o.procedencia as Procedencia]}
          {o.familia_publicada ? ` · familia: ${o.familia_publicada}` : ''}
        </p>
      )}
      {/* Cómo se asoció esta fila al producto: es parte de la evidencia, no un detalle técnico. */}
      {o.mapeo_metodo && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
          Asociada al producto por: {o.mapeo_metodo}
        </p>
      )}
      {o.mapeo_motivo && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>{o.mapeo_motivo}</p>
      )}
    </div>
  )
}

// ============================== CATEGORÍAS ==============================
function TabCategorias({ defaults, categorias, reload }: {
  defaults: ReturnType<typeof useRevisionFiscal>['defaults']; categorias: string[]; reload: () => Promise<void>
}) {
  const [aviso, setAviso] = useState<Aviso>(null)
  const [aplicando, setAplicando] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<string | null>(null)

  const aplicar = async (categoria: string) => {
    setAplicando(categoria); setAviso(null); setConfirmar(null)
    const r = await aplicarPropuestaCategoria(categoria)
    setAplicando(null)
    if (!r.ok) { setAviso({ ok: false, text: r.error }); return }
    setAviso({ ok: true, text: `Propuesta aplicada a ${categoria}: ${r.data.prellenados} producto(s) pre-llenado(s) y ${r.data.validados} validado(s). Siguen requiriendo validación una por una.` })
    await reload()
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <div className="eyebrow" style={{ marginTop: 0 }}><Layers size={13} /> Candidatos por categoría</div>
        <p style={{ margin: 0, fontSize: 13 }}>
          Son <b>propuestas</b> para no teclear lo mismo muchas veces. Aplicarlas solo rellena los huecos de
          los productos <b>no validados</b>: nunca pisa un valor ya capturado, nunca toca un producto validado
          y <b>nunca valida nada</b>. La validación sigue siendo producto por producto.
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          <Info size={12} /> Definir los candidatos de una categoría es facultad de Dirección. Si no tienes
          ese permiso, el servidor rechazará el cambio.
        </p>
      </div>

      {aviso && (
        <p role="status" style={{ margin: 0, padding: '10px 12px', borderRadius: 10, fontSize: 13,
          background: aviso.ok ? 'var(--ok-bg)' : 'var(--danger-bg)' }}>{aviso.text}</p>
      )}

      <div className="card" style={{ padding: 0, minWidth: 0 }}>
        <div className="tbl-scroll">
          <table className="tbl-cards">
            <thead><tr><th>Categoría</th><th>Clave SAT</th><th>Unidad</th><th>Objeto</th><th>IVA</th><th /></tr></thead>
            <tbody>
              {defaults.length === 0 && (
                <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>
                  Aún no hay candidatos definidos por categoría. Puedes trabajar producto por producto sin ellos.
                </td></tr>
              )}
              {defaults.map((d) => (
                <tr key={d.categoria}>
                  <td data-label="Categoría">{d.categoria}</td>
                  <td data-label="Clave SAT" className="mono" style={{ fontSize: 12 }}>{d.clave_prod_serv ?? '—'}</td>
                  <td data-label="Unidad" className="mono" style={{ fontSize: 12 }}>{d.clave_unidad ?? '—'}</td>
                  <td data-label="Objeto">{d.objeto_imp ?? '—'}</td>
                  <td data-label="IVA">{d.tratamiento_iva ?? '—'}{d.iva_tasa != null ? ` · ${d.iva_tasa}` : ''}</td>
                  <td data-label="">
                    <button type="button" className="btn ghost sm" disabled={aplicando === d.categoria} onClick={() => setConfirmar(d.categoria)}>
                      {aplicando === d.categoria ? 'Aplicando…' : 'Aplicar propuesta'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <DefinirCandidatos categorias={categorias} onDone={async (msg, ok) => { setAviso({ ok, text: msg }); if (ok) await reload() }} />

      {confirmar && (
        <ConfirmModal
          title="Aplicar la propuesta de la categoría"
          message={`Se rellenarán los huecos de los productos no validados de "${confirmar}". No se validará ningún producto y no se sobrescribirá ningún valor existente.`}
          confirmLabel="Aplicar propuesta"
          onClose={() => setConfirmar(null)}
          onConfirm={() => void aplicar(confirmar)}
        />
      )}
    </div>
  )
}

function DefinirCandidatos({ categorias, onDone }: { categorias: string[]; onDone: (msg: string, ok: boolean) => Promise<void> }) {
  const [cat, setCat] = useState('')
  const [form, setForm] = useState({ clave_prod_serv: '', clave_unidad: '', objeto_imp: '', tratamiento_iva: '', iva_tasa: '', notas: '' })
  const [guardando, setGuardando] = useState(false)
  const trat = TRATAMIENTOS.find((t) => t.valor === form.tratamiento_iva)

  const guardar = async () => {
    setGuardando(true)
    const cambios: CambiosFiscales = {}
    for (const [k, v] of Object.entries(form)) if (v.trim() !== '') (cambios as Record<string, string>)[k] = v.trim()
    const r = await definirDefaults(cat, cambios)
    setGuardando(false)
    await onDone(r.ok ? `Candidatos de ${cat} guardados. No validan ningún producto.` : r.error, r.ok)
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="eyebrow" style={{ marginTop: 0 }}>Definir candidatos de una categoría</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Campo label="Categoría">
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={INP}>
            <option value="">Elegir…</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
        <Campo label="Clave de producto/servicio">
          <input value={form.clave_prod_serv} onChange={(e) => setForm({ ...form, clave_prod_serv: e.target.value })} style={INP} inputMode="numeric" />
        </Campo>
        <Campo label="Clave de unidad">
          <input value={form.clave_unidad} onChange={(e) => setForm({ ...form, clave_unidad: e.target.value.toUpperCase() })} style={INP} />
        </Campo>
        <Campo label="Objeto de impuesto">
          <select value={form.objeto_imp} onChange={(e) => setForm({ ...form, objeto_imp: e.target.value })} style={INP}>
            <option value="">Sin definir</option>
            {OBJETOS.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
          </select>
        </Campo>
        <Campo label="Tratamiento de IVA">
          <select value={form.tratamiento_iva} onChange={(e) => {
            const v = e.target.value
            const t = TRATAMIENTOS.find((x) => x.valor === v)
            setForm({ ...form, tratamiento_iva: v, iva_tasa: t?.llevaTasa ? form.iva_tasa : '' })
          }} style={INP}>
            <option value="">Sin definir</option>
            {TRATAMIENTOS.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
          </select>
        </Campo>
        <Campo label="Tasa de IVA" hint={trat?.llevaTasa ? 'gravado: 0.16 · tasa cero: 0' : 'no aplica'}>
          <input value={form.iva_tasa} onChange={(e) => setForm({ ...form, iva_tasa: e.target.value })} style={INP} inputMode="decimal" disabled={!trat?.llevaTasa} />
        </Campo>
      </div>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn" disabled={!cat || guardando} onClick={() => void guardar()}>
          {guardando ? 'Guardando…' : 'Guardar candidatos'}
        </button>
      </div>
    </div>
  )
}

// ============================== EVIDENCIA SIN PRODUCTO ==============================
function TabHuerfanas({ filas }: { filas: ObservacionEvidencia[] }) {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <div className="eyebrow" style={{ marginTop: 0 }}><Unlink size={13} /> Observaciones históricas sin producto · solo lectura</div>
        <p style={{ margin: 0, fontSize: 13 }}>
          Filas de la conciliación histórica que <b>no se pudieron asociar a un producto del catálogo con
          certeza</b>. Se conservan como evidencia; no se adivinó a qué producto pertenecen.
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          Desde aquí <b>no</b> se crean productos ni se asocian observaciones: asociar una fila es un cambio de
          evidencia fiscal y solo ocurre con una importación autorizada por Dirección, que agrega una
          observación nueva sin borrar la anterior.
        </p>
      </div>
      <div className="card" style={{ padding: 0, minWidth: 0 }}>
        <div className="tbl-scroll">
          <table className="tbl-cards">
            <thead><tr><th>Origen</th><th>Nombre en el archivo</th><th>Referencia</th><th>Precios</th><th>Clasificación</th><th>Por qué no se asoció</th></tr></thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No hay observaciones sin asociar.</td></tr>}
              {filas.map((o) => (
                <tr key={o.id}>
                  <td data-label="Origen" className="mono" style={{ fontSize: 12 }}>{o.source_ref}</td>
                  <td data-label="Nombre en el archivo">{o.source_nombre}</td>
                  <td data-label="Referencia" className="mono" style={{ fontSize: 12 }}>{o.source_referencia ?? '—'}</td>
                  <td data-label="Precios">
                    {o.precio_historico != null ? money(o.precio_historico) : '—'}
                    {o.precio_publicado != null ? ` → ${money(o.precio_publicado)}` : ''}
                  </td>
                  <td data-label="Clasificación">{EVIDENCIA[o.clasificacion as EvidenciaClase]?.etiqueta ?? o.clasificacion}</td>
                  <td data-label="Por qué no se asoció" style={{ fontSize: 12.5, color: 'var(--muted)' }}>{o.mapeo_motivo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============================== ÁTOMOS ==============================
/** Etiqueta de clasificación. Nunca dice ni insinúa una tasa de IVA. */
function EtiquetaEvidencia({ clase }: { clase: EvidenciaClase }) {
  const meta = EVIDENCIA[clase]
  if (!meta) return <span style={{ fontSize: 12 }}>{clase}</span>
  const tono = meta.tono === 'dang' ? 'p-dang' : meta.tono === 'warn' ? 'p-warn' : 'p-neu'
  return <span className={`pill ${tono}`} title={meta.advertencia}>{meta.etiqueta}</span>
}

function Dato({ k, v }: { k: string; v: string }) {
  return <span><span style={{ color: 'var(--muted)' }}>{k}: </span><b>{v}</b></span>
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{hint}</span>}
    </label>
  )
}
