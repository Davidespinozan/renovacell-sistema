// ADMIN · Importar / Migración — carga masiva del catálogo (Odoo → CSV).
// CSV con encabezado: sku,name,line,category,price,cost  (line = prof | cosm).
// Idempotente por SKU: los que ya existen se omiten. El costo va a product_costs.
import React, { useState } from 'react'
import { Upload, FileUp, Check, AlertTriangle, Table } from 'lucide-react'
import { PageHead } from '../../app/PageHead'
import { money } from '../../lib/format'
import { importCatalog, type ImportRow, type ImportResult } from '../../data/store/productsStore'

const normLine = (v: string): 'cosm' | 'prof' => /cosm|home|cosmet/i.test(v) ? 'cosm' : 'prof'
const num = (v: string): number | null => { const n = Number(String(v).replace(/[^0-9.-]/g, '')); return v?.trim() && !Number.isNaN(n) ? n : null }

// Parser CSV tolerante (comas o punto y coma; comillas). Encabezado mapea columnas.
function parseCsv(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const split = (l: string) => l.split(l.includes(';') && !l.includes(',') ? ';' : ',').map((c) => c.replace(/^"|"$/g, '').trim())
  const header = split(lines[0]).map((h) => h.toLowerCase())
  const known = ['sku', 'name', 'nombre', 'line', 'linea', 'línea', 'category', 'categoria', 'categoría', 'price', 'precio', 'cost', 'costo']
  const hasHeader = header.some((h) => known.includes(h))
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h))
  const map = hasHeader
    ? { sku: idx(['sku']), name: idx(['name', 'nombre']), line: idx(['line', 'linea', 'línea']), category: idx(['category', 'categoria', 'categoría']), price: idx(['price', 'precio']), cost: idx(['cost', 'costo']) }
    : { sku: 0, name: 1, line: 2, category: 3, price: 4, cost: 5 }
  const rows = (hasHeader ? lines.slice(1) : lines).map(split)
  return rows.map((c) => ({
    sku: (map.sku >= 0 ? c[map.sku] : '') ?? '',
    name: (map.name >= 0 ? c[map.name] : '') ?? '',
    line: normLine(map.line >= 0 ? c[map.line] ?? '' : ''),
    category: (map.category >= 0 ? c[map.category] : '') || null,
    price: map.price >= 0 ? num(c[map.price] ?? '') : null,
    cost: map.cost >= 0 ? num(c[map.cost] ?? '') : null,
  })).filter((r) => r.name)
}

export function Importar() {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const preview = () => { setResult(null); setRows(parseCsv(text)) }
  const onFile = (f: File | undefined) => { if (!f) return; f.text().then((t) => { setText(t); setRows(parseCsv(t)); setResult(null) }) }
  const doImport = async () => { if (!rows?.length || busy) return; setBusy(true); const r = await importCatalog(rows); setBusy(false); setResult(r); setRows(null) }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Importar / Migración">
        Carga masiva del catálogo desde tu sistema actual (Odoo). Exporta a CSV con columnas
        <b> sku, name, line, category, price, cost</b> (line = <b>prof</b> o <b>cosm</b>) y pégalo o súbelo aquí.
        Es idempotente: los SKU que ya existen se omiten (no duplica).
      </PageHead>

      <div className="card">
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
          placeholder={'sku,name,line,category,price,cost\nMGP-90,Mascarilla GP,prof,Profesional,890,420\nGS-114,Golden Serum,cosm,Home Care,1890,900'}
          style={{ width: '100%', minHeight: 160, padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 12, fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 12.5, outline: 'none', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="btn ghost" type="button" onClick={preview} disabled={!text.trim()}><Table size={15} /> Previsualizar</button>
          <button className="btn" type="button" onClick={doImport} disabled={!rows?.length || busy} style={{ marginLeft: 'auto', ...(!rows?.length || busy ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
            <Upload size={15} /> {busy ? 'Importando…' : `Importar ${rows?.length ?? ''} producto(s)`}
          </button>
        </div>
      </div>

      {result && (
        <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: '#BFE3CC', color: 'var(--green-deep)', display: 'block' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><Check size={16} /> Importación terminada</div>
          <div style={{ marginTop: 6, fontSize: 13.5 }}>{result.created} creados · {result.skipped} ya existían (omitidos){result.errors.length ? ` · ${result.errors.length} con error` : ''}.</div>
          {result.errors.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--warn)' }}>{result.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
        </div>
      )}

      {rows && rows.length > 0 && !result && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={15} style={{ color: 'var(--warn)' }} /> <b>{rows.length}</b> fila(s) listas para importar (revisa antes de confirmar).
          </div>
          <div className="tbl-scroll">
            <table className="tbl-cards">
              <thead><tr><th>SKU</th><th>Nombre</th><th>Línea</th><th>Categoría</th><th>Precio</th><th>Costo</th></tr></thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td data-label="SKU" className="mono">{r.sku || '—'}</td>
                    <td data-label="Nombre">{r.name}</td>
                    <td data-label="Línea"><span className="pill p-neu">{r.line === 'cosm' ? 'Home Care' : 'Professional'}</span></td>
                    <td data-label="Categoría">{r.category ?? '—'}</td>
                    <td data-label="Precio" className="mono">{r.price != null ? money(r.price) : '—'}</td>
                    <td data-label="Costo" className="mono">{r.cost != null ? money(r.cost) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--ink-3)' }}>…y {rows.length - 50} más.</div>}
        </div>
      )}
    </div>
  )
}
