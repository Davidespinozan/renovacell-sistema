// ALMACÉN CONTROL TOTAL (19 nov 2026) · corregir la CADUCIDAD o el CÓDIGO de un lote mal capturado (p. ej. «2207» por
// «2027»). Lo hace Almacén o Dirección, siempre con motivo; queda en la bitácora (corregir_lote / lote_correcciones).
import React, { useState } from 'react'
import { Hoja } from '../../app/Hoja'
import { hasSupabase, supabase } from '../../lib/supabase'
import { recargarInventario } from '../../data/store/lotsStore'
import { hoyNegocio } from '../../data/periodo'

export interface LoteACorregir { id: string; lot_code: string; expiry_date: string | null; producto?: string }
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ error: { message?: string } | null }>
const legible = (m?: string) => { const t = (m ?? '').replace(/^[A-Z_]+:\s*/, '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'No se pudo corregir el lote.' }

export function CorregirLoteModal({ lote, onClose, onListo, rpc = rpcPorDefecto }: { lote: LoteACorregir | null; onClose: () => void; onListo: (texto: string) => void; rpc?: Rpc }) {
  const [cad, setCad] = useState(lote?.expiry_date ?? '')
  const [codigo, setCodigo] = useState(lote?.lot_code ?? '')
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!lote) return null
  const cambioCad = cad && cad !== lote.expiry_date ? cad : null
  const cambioCod = codigo.trim() && codigo.trim() !== lote.lot_code ? codigo.trim() : null
  const anio = cad ? Number(cad.slice(0, 4)) : 0
  const raro = cambioCad && (anio > Number(hoyNegocio().slice(0, 4)) + 6)
  const guardar = async () => {
    if (!hasSupabase && rpc === rpcPorDefecto) { setError('Requiere conexión con el servidor.'); return }
    setOcupado(true); setError(null)
    const { error: e } = await rpc('corregir_lote', { p_lot: lote.id, p_caducidad: cambioCad, p_lote: cambioCod, p_motivo: motivo.trim() })
    setOcupado(false)
    if (e) { setError(legible(e.message)); return }
    void recargarInventario().catch(() => {})
    onListo(`Lote corregido: ${cambioCod ?? lote.lot_code}${cambioCad ? ` · caduca ${cambioCad}` : ''}`)
  }
  return (
    <Hoja abierta onCerrar={onClose} titulo={`Corregir lote ${lote.lot_code}${lote.producto ? ` · ${lote.producto}` : ''}`} testid="corregir-lote"
      pie={<button type="button" className="btn" disabled={ocupado || (!cambioCad && !cambioCod) || motivo.trim().length < 3} onClick={() => void guardar()} data-testid="corregir-lote-guardar">{ocupado ? 'Guardando…' : 'Guardar corrección'}</button>}>
      <div className="corregir-lote">
        <label>Caducidad<input type="date" value={cad} onChange={(e) => setCad(e.target.value)} data-testid="corregir-lote-cad" /></label>
        {raro && <small className="corregir-lote-aviso">Revisa el año: caduca hasta {anio}.</small>}
        <label>Código de lote<input value={codigo} maxLength={60} onChange={(e) => setCodigo(e.target.value)} data-testid="corregir-lote-codigo" /></label>
        <label>¿Por qué se corrige?<input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. la caja dice 2027 y se capturó 2207" data-testid="corregir-lote-motivo" /></label>
        <small>Queda registrado quién lo corrigió, qué decía antes y por qué.</small>
        {error && <div className="pc-msg" role="alert" data-testid="corregir-lote-error">{error}</div>}
      </div>
    </Hoja>
  )
}
