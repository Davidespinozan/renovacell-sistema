// ADMIN · Importar / Migración — trae los datos del sistema anterior (Odoo).
//
// Cuatro cargas, cada una con sus columnas: catálogo, clientes, inventario por
// lote y costos. Todas siguen el mismo camino: pegar/subir CSV → PREVISUALIZAR →
// confirmar. Y todas son IDEMPOTENTES: volver a correr el mismo archivo no
// duplica, así se puede migrar por partes y reintentar tras corregir.
import React, { useState } from 'react'
import { Upload, FileUp, Check, AlertTriangle, Table } from 'lucide-react'
import { PageHead } from '../../app/PageHead'
import { money } from '../../lib/format'
import { importCatalog } from '../../data/store/productsStore'
import { importDoctores, importLotes, importCostos, type MigrationResult } from '../../data/store/migrationStore'

type Tipo = 'catalogo' | 'clientes' | 'inventario' | 'costos'

// Sinónimos aceptados por columna: el archivo del cliente no tiene por qué usar
// nuestros nombres. Se reconocen variantes en español e inglés.
type Campo = { key: string; label: string; alias: string[]; num?: boolean }

interface Def {
  tipo: Tipo
  titulo: string
  ayuda: string
  campos: Campo[]
  ejemplo: string
}

const DEFS: Def[] = [
  {
    tipo: 'catalogo', titulo: 'Catálogo', ayuda: 'Los productos que venden, con su precio de lista.',
    campos: [
      { key: 'sku', label: 'SKU', alias: ['sku', 'clave', 'codigo', 'código'] },
      { key: 'name', label: 'Nombre', alias: ['name', 'nombre', 'producto', 'descripcion', 'descripción'] },
      { key: 'line', label: 'Línea', alias: ['line', 'linea', 'línea'] },
      { key: 'category', label: 'Categoría', alias: ['category', 'categoria', 'categoría', 'familia'] },
      { key: 'price', label: 'Precio', alias: ['price', 'precio', 'precio venta', 'pvp'], num: true },
      { key: 'cost', label: 'Costo', alias: ['cost', 'costo'], num: true },
    ],
    ejemplo: 'sku,nombre,linea,categoria,precio,costo\nPEP-001,Golden Placenta,prof,Péptidos,15000,',
  },
  {
    tipo: 'clientes', titulo: 'Clientes / doctores', ayuda: 'Crea su cuenta. Quedan POR VERIFICAR: migrar no equivale a comprobar la cédula.',
    campos: [
      { key: 'name', label: 'Nombre', alias: ['name', 'nombre', 'cliente', 'doctor'] },
      { key: 'email', label: 'Correo', alias: ['email', 'correo', 'e-mail', 'mail'] },
      { key: 'phone', label: 'Teléfono', alias: ['phone', 'telefono', 'teléfono', 'celular', 'movil', 'móvil'] },
      { key: 'organization', label: 'Consultorio', alias: ['organization', 'consultorio', 'clinica', 'clínica', 'empresa'] },
      { key: 'cedula', label: 'Cédula', alias: ['cedula', 'cédula', 'cedula profesional'] },
      { key: 'rfc', label: 'RFC', alias: ['rfc'] },
      { key: 'razonSocial', label: 'Razón social', alias: ['razon social', 'razón social', 'razonsocial', 'nombre fiscal'] },
    ],
    ejemplo: 'nombre,correo,telefono,consultorio,cedula,rfc,razon social\nDra. Laura Méndez,laura@clinica.mx,6671234567,Clínica Derma,12345678,MELA800101AAA,Laura Méndez',
  },
  {
    tipo: 'inventario', titulo: 'Inventario por lote', ayuda: 'Existencias iniciales. El lote y la caducidad sostienen el FEFO y la trazabilidad.',
    campos: [
      { key: 'sku', label: 'SKU', alias: ['sku', 'clave', 'codigo', 'código', 'producto'] },
      { key: 'lote', label: 'Lote', alias: ['lote', 'lot', 'lot_code', 'batch'] },
      { key: 'caducidad', label: 'Caducidad', alias: ['caducidad', 'expiry', 'vence', 'vencimiento', 'expiracion', 'expiración'] },
      { key: 'cantidad', label: 'Cantidad', alias: ['cantidad', 'qty', 'existencia', 'stock', 'unidades'], num: true },
      { key: 'ubicacion', label: 'Ubicación', alias: ['ubicacion', 'ubicación', 'almacen', 'almacén', 'location'] },
    ],
    ejemplo: 'sku,lote,caducidad,cantidad,ubicacion\nPEP-001,RC-2601-A,2027-06-30,12,Bodega central',
  },
  {
    tipo: 'costos', titulo: 'Costos', ayuda: 'Habilita el margen en Finanzas. Solo Dirección ve los costos.',
    campos: [
      { key: 'sku', label: 'SKU', alias: ['sku', 'clave', 'codigo', 'código'] },
      { key: 'costo', label: 'Costo', alias: ['costo', 'cost', 'costo unitario'], num: true },
    ],
    ejemplo: 'sku,costo\nPEP-001,7200',
  },
]

const num = (v: string): number => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isNaN(n) ? 0 : n }

// Parser tolerante: coma o punto y coma, comillas, y encabezado por sinónimos.
function parse(text: string, def: Def): Record<string, string | number>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const split = (l: string) => l.split(l.includes(';') && !l.includes(',') ? ';' : ',').map((c) => c.replace(/^"|"$/g, '').trim())
  const head = split(lines[0]).map((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
  const idx: Record<string, number> = {}
  def.campos.forEach((c) => {
    idx[c.key] = head.findIndex((h) => c.alias.some((a) => h === a.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  })
  const hayEncabezado = Object.values(idx).some((i) => i >= 0)
  const cuerpo = (hayEncabezado ? lines.slice(1) : lines).map(split)
  return cuerpo.map((cols) => {
    const row: Record<string, string | number> = {}
    def.campos.forEach((c, i) => {
      const at = hayEncabezado ? idx[c.key] : i
      const raw = at >= 0 ? (cols[at] ?? '') : ''
      row[c.key] = c.num ? num(raw) : raw
    })
    return row
  }).filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== '' && v !== 0))
}

export function Importar() {
  const [tipo, setTipo] = useState<Tipo>('catalogo')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Record<string, string | number>[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MigrationResult | null>(null)

  const def = DEFS.find((d) => d.tipo === tipo)!
  const cambiarTipo = (t: Tipo) => { setTipo(t); setRows(null); setResult(null); setText('') }
  const preview = () => { setResult(null); setRows(parse(text, def)) }
  const onFile = (f: File | undefined) => { if (!f) return; f.text().then((t) => { setText(t); setRows(parse(t, def)); setResult(null) }) }

  const doImport = async () => {
    if (!rows?.length || busy) return
    setBusy(true)
    let r: MigrationResult
    if (tipo === 'catalogo') {
      const res = await importCatalog(rows.map((x) => ({
        sku: String(x.sku ?? ''), name: String(x.name ?? ''),
        line: String(x.line ?? '').toLowerCase().startsWith('cosm') ? 'cosm' : 'prof',
        category: String(x.category ?? '') || null,
        price: Number(x.price) || null, cost: Number(x.cost) || null,
      })))
      r = { created: res.created, skipped: res.skipped, errors: res.errors }
    } else if (tipo === 'clientes') {
      r = await importDoctores(rows.map((x) => ({
        name: String(x.name ?? ''), email: String(x.email ?? ''), phone: String(x.phone ?? ''),
        organization: String(x.organization ?? ''), cedula: String(x.cedula ?? ''),
        rfc: String(x.rfc ?? ''), razonSocial: String(x.razonSocial ?? ''),
      })))
    } else if (tipo === 'inventario') {
      r = await importLotes(rows.map((x) => ({
        sku: String(x.sku ?? ''), lote: String(x.lote ?? ''), caducidad: String(x.caducidad ?? ''),
        cantidad: Number(x.cantidad) || 0, ubicacion: String(x.ubicacion ?? ''),
      })))
    } else {
      r = await importCostos(rows.map((x) => ({ sku: String(x.sku ?? ''), costo: Number(x.costo) || 0 })))
    }
    setBusy(false); setResult(r); setRows(null)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Importar / Migración">
        Trae los datos de su sistema actual. Elige qué vas a cargar, exporta ese listado a CSV,
        y pégalo o súbelo. Siempre puedes <b>previsualizar antes de confirmar</b>, y repetir el
        archivo sin miedo: <b>no duplica</b> lo que ya existe.
      </PageHead>

      <div className="fchips">
        {DEFS.map((d) => (
          <button key={d.tipo} type="button" className={'fchip' + (tipo === d.tipo ? ' on' : '')} onClick={() => cambiarTipo(d.tipo)}>
            {d.titulo}
          </button>
        ))}
      </div>

      <div className="card">
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>{def.ayuda}</div>
        <div style={{ fontSize: 12.5, marginBottom: 12 }}>
          <b>Columnas:</b>{' '}
          {def.campos.map((c, i) => (
            <span key={c.key}>{i > 0 && ' · '}<span className="mono">{c.label}</span></span>
          ))}
          <div style={{ color: 'var(--ink-3)', marginTop: 4 }}>
            Reconoce nombres en español o inglés (por ejemplo <span className="mono">precio</span> o <span className="mono">price</span>), en cualquier orden.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
            <FileUp size={14} /> Subir CSV
            <input type="file" accept=".csv,text/csv,text/plain" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>o pega el contenido abajo</span>
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setRows(null); setResult(null) }}
          placeholder={def.ejemplo}
          style={{ width: '100%', minHeight: 150, padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 12, fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 12.5, outline: 'none', resize: 'vertical' }}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="btn ghost" type="button" onClick={preview} disabled={!text.trim()}><Table size={15} /> Previsualizar</button>
          <button className="btn" type="button" onClick={doImport} disabled={!rows?.length || busy}
            style={{ marginLeft: 'auto', ...(!rows?.length || busy ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
            <Upload size={15} /> {busy ? 'Importando…' : `Importar ${rows?.length ?? ''} registro(s)`}
          </button>
        </div>
      </div>

      {result && (
        <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: '#BFE3CC', color: 'var(--green-deep)', display: 'block' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Check size={16} /> {def.titulo}: importación terminada</div>
          <div style={{ marginTop: 6, fontSize: 13.5 }}>
            {result.created} creados · {result.skipped} ya existían (omitidos){result.errors.length ? ` · ${result.errors.length} con problema` : ''}.
          </div>
          {result.errors.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--warn)' }}>
              {result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
              {result.errors.length > 10 && <li>…y {result.errors.length - 10} más.</li>}
            </ul>
          )}
        </div>
      )}

      {rows && rows.length > 0 && !result && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={15} style={{ color: 'var(--warn)' }} />
            <b>{rows.length}</b> registro(s) listos. Revisa que las columnas hayan quedado bien antes de confirmar.
          </div>
          <div className="tbl-scroll">
            <table className="tbl-cards">
              <thead><tr>{def.campos.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 40).map((r, i) => (
                  <tr key={i}>
                    {def.campos.map((c) => (
                      <td key={c.key} data-label={c.label} className={c.num ? 'mono' : undefined}>
                        {c.num ? (Number(r[c.key]) ? money(Number(r[c.key])) : '—') : (String(r[c.key] ?? '') || '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 40 && <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--ink-3)' }}>…y {rows.length - 40} más.</div>}
        </div>
      )}
    </div>
  )
}