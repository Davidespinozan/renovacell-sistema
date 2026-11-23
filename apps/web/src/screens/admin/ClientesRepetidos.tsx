// CLIENTES REPETIDOS (23 nov 2026, dueño: «haz lo que consideres más profesional»). Dirección revisa los grupos de fichas
// que comparten teléfono, correo o cédula y decide: FUSIONAR en la que se queda (lo operativo pasa a ella; la otra queda
// archivada, nunca borrada) o marcar que SON DISTINTOS (una clínica comparte teléfono, una pareja comparte correo…).
// Nada es automático. Reglas del servidor: una ficha con pedidos solo puede ser la que se queda (los pedidos no cambian de
// cliente); dos cuentas del portal no se fusionan.
import React, { useCallback, useEffect, useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'
import { confirmar } from '../../app/dialogos'
import { Cargando, Vacio } from '../../app/EmptyState'
import { fmtDate, money } from '../../lib/format'

export interface FichaRepetida { id: string; nombre: string; correo: string | null; telefono: string | null; ciudad: string | null; origen: string | null; portal: boolean; cedula: boolean; vendedor: string | null; pedidos: number; total: number; creado: string }
export interface GrupoRepetido { ids: string[]; por: Array<'telefono' | 'correo' | 'cedula'>; fichas: FichaRepetida[]; obvio?: boolean }   // obvio: un nombre contiene al otro (REPETIDOS OBVIOS)
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
const POR: Record<string, string> = { telefono: 'teléfono', correo: 'correo', cedula: 'cédula' }
const ORIGEN: Record<string, string> = { odoo: 'Odoo', vendedor: 'Vendedora', portal: 'Portal', conversacion: 'Chat' }

const limpiar = (m: string | undefined) => (m ?? '').replace(/^[A-Z_]+:\s*/, '') || 'No se pudo completar. Intenta de nuevo.'
const palabras = (s: string) => new Set(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !['dra', 'doctor', 'doctora'].includes(w)))
/** ¿Los nombres se parecen? (al menos una palabra en común de 3+ letras). Si no, se avisa: pueden ser dos personas. */
export function nombresParecidos(a: string, b: string): boolean { const x = palabras(a); for (const w of palabras(b)) if (x.has(w)) return true; return false }
/** La que se queda por omisión: la que tiene pedidos, luego cuenta del portal, luego la más antigua (el servidor ya ordena así). */
export const quedaPorOmision = (g: GrupoRepetido): string => (g.fichas.find((f) => f.pedidos > 0) ?? g.fichas.find((f) => f.portal) ?? g.fichas[0]).id

export function ClientesRepetidos({ rpc = rpcPorDefecto }: { rpc?: Rpc }) {
  const [grupos, setGrupos] = useState<GrupoRepetido[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    if (!hasSupabase && rpc === rpcPorDefecto) { setGrupos([]); return }
    const { data, error: e } = await rpc('clientes_duplicados', { p_limite: 60 })
    if (e) { setError(limpiar(e.message)); setGrupos([]); return }
    setError(null); setGrupos((data as GrupoRepetido[]) ?? [])
  }, [rpc])
  useEffect(() => { void cargar() }, [cargar])

  // REPETIDOS OBVIOS (23 nov 2026, dueño: «es evidente que Tere Salas y María Teresa Salas son la misma persona»)
  const [fusionandoObvios, setFusionandoObvios] = useState(false)
  const obvios = (grupos ?? []).filter((g) => g.obvio)
  const fusionarObvios = async () => {
    if (!obvios.length || fusionandoObvios) return
    const ej = obvios.slice(0, 4).map((g) => g.fichas.map((f) => `«${f.nombre}»`).join(' y ')).join('; ')
    if (!(await confirmar(`Fusionar los ${obvios.length} grupos obvios (en cada uno, un nombre contiene al otro). Ej.: ${ej}${obvios.length > 4 ? '…' : ''}. En cada grupo se queda la ficha con pedidos (o con portal, o la más antigua) y las demás quedan archivadas.`, { aceptar: `Fusionar ${obvios.length}` }))) return
    setFusionandoObvios(true)
    const { error: e } = await rpc('clientes_fusionar_obvios')
    setFusionandoObvios(false)
    if (e) { setError(limpiar(e.message)); return }
    await cargar()
  }
  if (!grupos) return <Cargando etiqueta="Buscando fichas repetidas…" />
  return (
    <div className="grid" style={{ gap: 14 }} data-testid="clientes-repetidos">
      <div className="card" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
        Fichas que comparten <b>teléfono, correo o cédula</b>. Revisa cada grupo: si es la misma persona, <b>fusiona</b> en la que se queda
        (pasan sus teléfonos, domicilios, facturación, conversaciones, cartera y notas; la otra queda archivada, no se borra). Si son
        personas distintas, márcalas como <b>distintas</b> y no se vuelven a sugerir. Si solo comparten teléfono y los nombres no
        se parecen en nada, no se muestran (son personas distintas que comparten un número).
        Los pedidos nunca cambian de ficha: la que tiene pedidos es la que se queda.
      </div>
      {obvios.length > 0 && (
        <div className="card repetidos-obvios" data-testid="repetidos-obvios">
          <span><b>{obvios.length} {obvios.length === 1 ? 'grupo es obvio' : 'grupos son obvios'}:</b> un nombre contiene al otro (p. ej. «Tere Salas» y «María Teresa Salas Hernández»). No hace falta revisarlos uno por uno.</span>
          <button type="button" className="btn sm" onClick={() => void fusionarObvios()} disabled={fusionandoObvios} data-testid="repetidos-fusionar-obvios">{fusionandoObvios ? 'Fusionando…' : `Fusionar los ${obvios.length} obvios`}</button>
        </div>
      )}
      {error && <div className="sysnote" role="alert">{error}</div>}
      {grupos.length === 0 && !error && <Vacio icono="usercheck" titulo="No hay fichas repetidas por revisar." />}
      {grupos.map((g) => <Grupo key={g.ids.join(',')} g={g} rpc={rpc} onListo={() => setGrupos((xs) => (xs ?? []).filter((x) => x !== g))} />)}
    </div>
  )
}

function Grupo({ g, rpc, onListo }: { g: GrupoRepetido; rpc: Rpc; onListo: () => void }) {
  const [queda, setQueda] = useState(() => quedaPorOmision(g))
  const [fusionar, setFusionar] = useState<Record<string, boolean>>(() => Object.fromEntries(g.fichas.map((f) => [f.id, f.pedidos === 0])))
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const fQueda = g.fichas.find((f) => f.id === queda)!
  const seVan = g.fichas.filter((f) => f.id !== queda && fusionar[f.id] && f.pedidos === 0)
  const distintasDeNombre = seVan.filter((f) => !nombresParecidos(f.nombre, fQueda.nombre))
  const dosPortales = fQueda.portal && seVan.some((f) => f.portal)

  const elegirQueda = (id: string) => { setQueda(id); setMsg(null) }
  const fusionarYa = async () => {
    if (!seVan.length || ocupado) return
    const aviso = distintasDeNombre.length ? `\n\nOJO: ${distintasDeNombre.map((f) => `«${f.nombre}»`).join(', ')} no se parece al nombre de «${fQueda.nombre}». ¿Seguro que es la misma persona?` : ''
    if (!(await confirmar(`Fusionar ${seVan.map((f) => `«${f.nombre}»`).join(', ')} en «${fQueda.nombre}». Sus teléfonos, domicilios, facturación, conversaciones, cartera y notas pasan a «${fQueda.nombre}» y ${seVan.length === 1 ? 'la otra ficha queda archivada' : 'las otras fichas quedan archivadas'}.${aviso}`, { peligro: distintasDeNombre.length > 0, aceptar: 'Fusionar' }))) return
    setOcupado(true); setMsg(null)
    const { error } = await rpc('clientes_fusionar', { p_queda: queda, p_se_van: seVan.map((f) => f.id), p_motivo: `Repetidos por ${g.por.map((p) => POR[p]).join(', ')}` })
    setOcupado(false)
    if (error) { setMsg({ ok: false, texto: limpiar(error.message) }); return }
    onListo()
  }
  const distintas = async () => {
    if (ocupado) return
    setOcupado(true); setMsg(null)
    const { error } = await rpc('clientes_marcar_distintos', { p_ids: g.ids })
    setOcupado(false)
    if (error) { setMsg({ ok: false, texto: limpiar(error.message) }); return }
    onListo()
  }

  return (
    <div className="card repetidos-grupo" data-testid="grupo-repetido">
      <div className="repetidos-cab">Coinciden por <b>{g.por.map((p) => POR[p] ?? p).join(' y ')}</b> · {g.fichas.length} fichas{g.obvio && <span className="pill p-ok" style={{ marginLeft: 6 }}>Obvio</span>}</div>
      <table className="tbl-cards">
        <thead><tr><th>Se queda</th><th>Nombre</th><th>Contacto</th><th>Origen</th><th>Vendedora</th><th>Pedidos</th><th>Fusionar</th></tr></thead>
        <tbody>
          {g.fichas.map((f) => {
            const esQueda = f.id === queda
            return (
              <tr key={f.id} className={esQueda ? 'repetidos-queda' : undefined}>
                <td data-label="Se queda"><input type="radio" name={`queda-${g.ids[0]}`} checked={esQueda} onChange={() => elegirQueda(f.id)} aria-label={`Se queda ${f.nombre}`} /></td>
                <td data-label="Nombre"><b>{f.nombre}</b>{f.portal && <span className="pill p-ok" style={{ marginLeft: 6 }}>Portal</span>}{f.cedula && <span className="pill p-neu" style={{ marginLeft: 6 }}>Cédula</span>}
                  {!esQueda && !nombresParecidos(f.nombre, fQueda.nombre) && <div className="repetidos-aviso">Nombre distinto: ¿es otra persona?</div>}</td>
                <td data-label="Contacto" style={{ fontSize: 12.5 }}>{[f.telefono, f.correo, f.ciudad].filter(Boolean).join(' · ') || '—'}</td>
                <td data-label="Origen" style={{ fontSize: 12.5 }}>{ORIGEN[f.origen ?? ''] ?? f.origen ?? '—'} · {fmtDate(f.creado)}</td>
                <td data-label="Vendedora">{f.vendedor ?? '—'}</td>
                <td data-label="Pedidos" className="mono">{f.pedidos ? `${f.pedidos} · ${money(f.total)}` : '—'}</td>
                <td data-label="Fusionar">{esQueda ? '—' : f.pedidos > 0
                  ? <span className="repetidos-aviso">Tiene pedidos: elígela como la que se queda</span>
                  : <input type="checkbox" checked={!!fusionar[f.id]} onChange={(e) => setFusionar((m) => ({ ...m, [f.id]: e.target.checked }))} aria-label={`Fusionar ${f.nombre}`} />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {dosPortales && <div className="repetidos-aviso">Las dos tienen cuenta del portal: son dos accesos distintos y no se pueden fusionar.</div>}
      {msg && <div className="sysnote" role="alert">{msg.texto}</div>}
      <div className="repetidos-acciones">
        <button type="button" className="btn ghost sm" onClick={() => void distintas()} disabled={ocupado} data-testid="repetidos-distintos">Son distintos</button>
        <button type="button" className="btn sm" onClick={() => void fusionarYa()} disabled={ocupado || !seVan.length || dosPortales} data-testid="repetidos-fusionar">
          {ocupado ? 'Guardando…' : `Fusionar ${seVan.length || ''} en «${fQueda.nombre}»`}
        </button>
      </div>
    </div>
  )
}
