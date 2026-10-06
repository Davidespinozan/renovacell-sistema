// CC-7 · DIRECCIÓN · Atención comercial: quién atiende a cada cliente y qué está pendiente de ruteo.
//   · Pendientes: conversaciones con atención humana pedida (por carrito o manual), su motivo, edad,
//     si llegó fuera de horario y si el vendedor ya inició; asignar vendedor desde aquí.
//   · Cartera: clientes con/sin vendedor y reasignaciones requeridas (historial auditado en el servidor).
//   · Vendedores: quién es elegible (los permisos se cambian en Equipo).
// La autoridad es la base: valida Dirección, elegibilidad y motivo; nada se asigna al azar.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { atencion as clientePorDefecto, MOTIVO_RUTEO, textoEstadoHorario, type ClienteAtencion, type ClienteCartera, type Pendientes, type Vendedor } from '../../data/ops/atencion'
import { chat as chatPorDefecto, ETIQUETA_MODO, type ClienteChat, type ModoConversacion } from '../../data/ops/chat'
import { formatoEdad } from '../chat/Asesorias'
import { useRole } from '../../auth/RoleContext'

type Pestana = 'pendientes' | 'cartera' | 'vendedores'

export function AtencionComercial({ cliente = clientePorDefecto, chat = chatPorDefecto, onEquipo, onHorario }: { cliente?: ClienteAtencion; chat?: ClienteChat; onEquipo?: () => void; onHorario?: () => void }) {
  const [pestana, setPestana] = useState<Pestana>('pendientes')
  const [pend, setPend] = useState<Pendientes | null>(null)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [p, v] = await Promise.all([cliente.pendientes(), cliente.vendedores()])
    if (!p.ok) { setError(p.error); return }
    setError(null); setPend(p.data); if (v.ok) setVendedores(v.data)
  }, [cliente])
  useEffect(() => { void cargar() }, [cargar])

  const r = pend?.resumen
  return (
    <div className="grid" style={{ gap: 14, maxWidth: 980 }} data-testid="atencion-comercial">
      <div className="eyebrow" style={{ margin: 0 }}>Dirección · Atención comercial</div>
      <div className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 600 }} data-testid="estado-horario">{textoEstadoHorario(r?.horario)}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>El servidor decide con este horario qué se le dice al cliente cuando activa un carrito.</div>
        </div>
        {onHorario && <button type="button" className="btn" onClick={onHorario}>{r?.horario.configurado ? 'Editar horario' : 'Configurar horario'}</button>}
        {r && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className={'pill ' + (r.handoffs_sin_asignar ? 'p-warn' : 'p-neu')} data-testid="n-sin-asignar">{r.handoffs_sin_asignar} sin vendedor</span>
            <span className={'pill ' + (r.reasignacion ? 'p-warn' : 'p-neu')}>{r.reasignacion} por reasignar</span>
            <span className={'pill ' + (r.handoffs_pendientes ? 'p-dang' : 'p-neu')}>{r.handoffs_pendientes} sin rutear</span>
            <span className="pill p-neu">{r.vendedores_elegibles} vendedor(es) elegible(s)</span>
          </div>
        )}
      </div>
      {error && <div role="alert" className="card" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {([['pendientes', 'Pendientes'], ['cartera', 'Cartera'], ['vendedores', 'Vendedores']] as const).map(([k, l]) => (
          <button key={k} type="button" className={pestana === k ? 'active' : undefined} onClick={() => setPestana(k)}>{l}</button>
        ))}
      </div>
      {pestana === 'pendientes' && pend && <PestanaPendientes pend={pend} vendedores={vendedores} cliente={cliente} chat={chat} onCambio={cargar} />}
      {pestana === 'cartera' && <PestanaCartera vendedores={vendedores} cliente={cliente} onCambio={cargar} />}
      {pestana === 'vendedores' && <PestanaVendedores vendedores={vendedores} onEquipo={onEquipo} />}
    </div>
  )
}

function SelectorVendedor({ vendedores, nuevos, valor, onCambio }: { vendedores: Vendedor[]; nuevos: boolean; valor: string; onCambio: (v: string) => void }) {
  const opciones = vendedores.filter((v) => (nuevos ? v.elegible_nuevos : v.elegible))
  return (
    <select value={valor} onChange={(e) => onCambio(e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)' }} aria-label="Vendedor">
      <option value="">{opciones.length ? 'Elige vendedor…' : 'Sin vendedores elegibles'}</option>
      {opciones.map((v) => <option key={v.id} value={v.id}>{v.nombre}{v.clientes ? ` · ${v.clientes} cliente(s)` : ''}</option>)}
    </select>
  )
}

function PestanaPendientes({ pend, vendedores, cliente, chat, onCambio }: { pend: Pendientes; vendedores: Vendedor[]; cliente: ClienteAtencion; chat: ClienteChat; onCambio: () => void }) {
  const [sel, setSel] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const asignar = async (p: Pendientes['conversaciones'][number]) => {
    const v = sel[p.conversation_id]; if (!v) return
    setMsg(null)
    const r = p.profile_id
      ? await cliente.asignar(p.profile_id, v, motivo[p.conversation_id] || null)   // doctor: queda en su CARTERA (compras futuras)
      : await chat.asignar(p.conversation_id, v).then((x) => (x.ok ? { ok: true as const, data: x.data } : { ok: false as const, error: x.error.mensaje }))   // visitante: solo esta conversación
    if (!r.ok) setMsg(r.error); else onCambio()
  }
  const items = pend.conversaciones
  return (
    <div className="card">
      {msg && <div role="alert" style={{ marginBottom: 10, color: 'var(--danger)' }}>{msg}</div>}
      {items.length === 0 && <div style={{ color: 'var(--ink-3)' }}>No hay conversaciones con atención humana pedida.</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {items.map((p) => {
          const necesita = !p.seller_id
          return (
            <li key={p.conversation_id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }} data-testid="pendiente">
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 600 }}>{p.nombre}{p.dueno === 'visitante' ? ' (visitante)' : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>{p.iniciada ? 'Asesoría iniciada' : ETIQUETA_MODO[p.modo as ModoConversacion] ?? p.modo}</span>
                  {p.seller_nombre && <span>· {p.seller_nombre}</span>}
                  {p.origen === 'carrito' && <span className="pill p-neu">Carrito{p.n_items ? ` · ${p.n_items}` : ''}</span>}
                  {p.fuera_horario && <span className="pill p-warn">Fuera de horario</span>}
                  {p.ruteo_motivo && <span className="pill p-warn">{MOTIVO_RUTEO[p.ruteo_motivo] ?? p.ruteo_motivo}</span>}
                  {p.edad_min != null && <span>hace {formatoEdad(p.edad_min)}</span>}
                </div>
              </div>
              {necesita && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <SelectorVendedor vendedores={vendedores} nuevos={!!p.profile_id} valor={sel[p.conversation_id] ?? ''} onCambio={(v) => setSel((s) => ({ ...s, [p.conversation_id]: v }))} />
                  {p.ruteo_motivo === 'vendedor_no_elegible' && (
                    <input placeholder="Motivo de la reasignación" value={motivo[p.conversation_id] ?? ''} onChange={(e) => setMotivo((m) => ({ ...m, [p.conversation_id]: e.target.value }))} maxLength={200} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)' }} />
                  )}
                  <button type="button" className="btn btn-primary" disabled={!sel[p.conversation_id]} onClick={() => asignar(p)} data-testid="btn-asignar-pendiente">{p.profile_id ? 'Asignar a su cartera' : 'Asignar conversación'}</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {pend.carritos_pendientes.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--warn)' }} data-testid="carritos-pendientes">
          {pend.carritos_pendientes.length} carrito(s) activaron atención humana pero el ruteo no se completó; se reintenta solo cuando el cliente vuelve al chat. Su compra no se vio afectada.
        </div>
      )}
    </div>
  )
}

function PestanaCartera({ vendedores, cliente, onCambio }: { vendedores: Vendedor[]; cliente: ClienteAtencion; onCambio: () => void }) {
  const [filtro, setFiltro] = useState<'todos' | 'sin_vendedor' | 'reasignacion'>('sin_vendedor')
  const [filas, setFilas] = useState<ClienteCartera[]>([])
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const cargar = useCallback(async () => { const r = await cliente.cartera(filtro); if (r.ok) setFilas(r.data); else setMsg(r.error) }, [cliente, filtro])
  useEffect(() => { void cargar() }, [cargar])
  const visibles = useMemo(() => filas.filter((f) => !busca.trim() || f.nombre.toLowerCase().includes(busca.trim().toLowerCase())), [filas, busca])
  const guardar = async (f: ClienteCartera) => {
    const v = sel[f.profile_id] ?? ''; setMsg(null)
    const r = await cliente.asignar(f.profile_id, v || null, motivo[f.profile_id] || null)
    if (!r.ok) { setMsg(r.error); return }
    await cargar(); onCambio()
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)' }} aria-label="Filtro">
          <option value="sin_vendedor">Sin vendedor</option><option value="reasignacion">Requieren reasignación</option><option value="todos">Todos</option>
        </select>
        <input placeholder="Buscar cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, minWidth: 180, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)' }} />
      </div>
      {msg && <div role="alert" style={{ marginBottom: 10, color: 'var(--danger)' }}>{msg}</div>}
      {visibles.length === 0 && <div style={{ color: 'var(--ink-3)' }}>Sin clientes en este filtro.</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {visibles.map((f) => (
          <li key={f.profile_id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }} data-testid="cartera-fila">
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600 }}>{f.nombre}{!f.verificado ? ' · sin verificar' : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {f.vendedor_nombre ? `Vendedor: ${f.vendedor_nombre}` : 'Sin vendedor'}
                {f.requiere_reasignacion && <span className="pill p-warn" style={{ marginLeft: 6 }}>Su vendedor ya no puede atender</span>}
                {f.vendedor_historico && <span style={{ marginLeft: 6 }}>· histórico: {f.vendedor_historico}</span>}
              </div>
            </div>
            <SelectorVendedor vendedores={vendedores} nuevos valor={sel[f.profile_id] ?? ''} onCambio={(v) => setSel((s) => ({ ...s, [f.profile_id]: v }))} />
            {f.vendedor_id && <input placeholder="Motivo del cambio" value={motivo[f.profile_id] ?? ''} onChange={(e) => setMotivo((m) => ({ ...m, [f.profile_id]: e.target.value }))} maxLength={200} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)' }} />}
            <button type="button" className="btn" disabled={!sel[f.profile_id]} onClick={() => guardar(f)} data-testid="btn-guardar-cartera">{f.vendedor_id ? 'Reasignar' : 'Asignar'}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PestanaVendedores({ vendedores, onEquipo }: { vendedores: Vendedor[]; onEquipo?: () => void }) {
  return (
    <div className="card">
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>
        Un vendedor recibe conversaciones si está activo, es de Ventas y tiene <b>Atender conversaciones</b>. Para recibir clientes nuevos además necesita <b>Recibir clientes nuevos</b>. Quitar este último no le quita su cartera actual.
        {onEquipo && <> <button type="button" className="btn ghost sm" onClick={onEquipo}>Cambiar permisos en Equipo</button></>}
      </div>
      {vendedores.length === 0 && <div style={{ color: 'var(--ink-3)' }}>No hay usuarios de Ventas.</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {vendedores.map((v) => (
          <li key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} data-testid="vendedor">
            <b style={{ flex: 1 }}>{v.nombre}</b>
            <span className={'pill ' + (v.activo ? 'p-neu' : 'p-dang')}>{v.activo ? 'Activo' : 'Inactivo'}</span>
            <span className={'pill ' + (v.conversaciones ? 'p-neu' : 'p-warn')}>{v.conversaciones ? 'Atiende conversaciones' : 'No atiende conversaciones'}</span>
            <span className={'pill ' + (v.nuevos_clientes ? 'p-neu' : 'p-warn')}>{v.nuevos_clientes ? 'Recibe clientes nuevos' : 'No recibe nuevos'}</span>
            <span className="pill p-neu">{v.clientes} cliente(s)</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Montaje en el registro: navegación a Equipo (permisos) y Configuración (horario). */
export function AtencionComercialPantalla() {
  const { setScreen } = useRole()
  return <AtencionComercial onEquipo={() => setScreen('av_equipo')} onHorario={() => setScreen('av_config')} />
}
