// INVITA-1 · INVITAR CLIENTES (Dirección). Envío masivo de la invitación a crear cuenta (ya verificada) a los clientes
// actuales, por correo o por WhatsApp. La base arma la audiencia, deja fuera lo dudoso (con su motivo, para revisar),
// manda solo en horario de atención y hasta el límite diario. Aquí se lanza, se sigue y se pausa.
import React, { useCallback, useEffect, useState } from 'react'
import { Copy, Mail, MessageCircle, Pause, Play, RefreshCw, Send, X } from 'lucide-react'
import { PageHead } from '../../app/PageHead'
import { ConfirmModal } from '../../app/ConfirmModal'
import { atencion, textoEstadoHorario, type Vendedor } from '../../data/ops/atencion'
import {
  invitacionesMasivas as clientePorDefecto, diasEstimados, ESTADO_CAMPANA, MOTIVO_OMITIDO, TEXTO_PLANTILLA_WA,
  type Campana, type CanalInvitacion, type ClienteInvitacionesMasivas, type EstadoMasivas, type Previa, type RenglonRevision,
} from '../../data/ops/invitacionesMasivas'

type Aviso = { ok: boolean; texto: string } | null
const campo: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', font: 'inherit', minHeight: 40 }
const ETIQUETA_CANAL: Record<CanalInvitacion, string> = { correo: 'Correo', whatsapp: 'WhatsApp' }
const TONO: Record<Campana['estado'], string> = { activa: 'p-ok', pausada: 'p-warn', terminada: 'p-neu', cancelada: 'p-neu' }

type VendedoresDe = () => Promise<{ ok: true; data: Vendedor[] } | { ok: false; error: string }>
const vendedoresPorDefecto: VendedoresDe = () => atencion.vendedores()

export function InvitarClientes({ cliente = clientePorDefecto, vendedoresDe = vendedoresPorDefecto }: { cliente?: ClienteInvitacionesMasivas; vendedoresDe?: VendedoresDe }) {
  const [estado, setEstado] = useState<EstadoMasivas | null>(null)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [aviso, setAviso] = useState<Aviso>(null)
  const recargar = useCallback(async () => {
    const r = await cliente.estado()
    if (r.ok) setEstado(r.data); else setAviso({ ok: false, texto: r.error })
  }, [cliente])
  useEffect(() => {
    void recargar()
    void vendedoresDe().then((r) => { if (r.ok) setVendedores(r.data.filter((v) => v.activo)) })
    const t = setInterval(() => void recargar(), 30_000)
    return () => clearInterval(t)
  }, [recargar, vendedoresDe])

  const vivas = (estado?.campanas ?? []).filter((c) => c.estado === 'activa' || c.estado === 'pausada')
  const anteriores = (estado?.campanas ?? []).filter((c) => c.estado === 'terminada' || c.estado === 'cancelada')

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Invitar clientes">
        Manda a tus clientes actuales su invitación para crear su cuenta en el portal. Como ya son clientes, la cuenta
        nace <b>verificada</b> y ligada a su historial, domicilios y vendedor. Se envía sola, poco a poco, <b>solo en horario
        de atención</b> y sin pasar el límite diario, para que el equipo alcance a contestar a quienes respondan.
      </PageHead>
      {estado && <div style={{ fontSize: 13, color: 'var(--ink-3)' }} data-testid="inv-horario">{textoEstadoHorario(estado.horario)} Fuera de horario la cola espera.</div>}
      {aviso && <div role="status" className={'pill ' + (aviso.ok ? 'p-ok' : 'p-dang')} style={{ alignSelf: 'flex-start' }}>{aviso.texto}</div>}

      {vivas.map((c) => <TarjetaCampana key={c.id} c={c} cliente={cliente} onCambio={recargar} onAviso={setAviso} />)}
      <NuevaCampana cliente={cliente} vendedores={vendedores} ocupados={new Set(vivas.map((c) => c.canal))} onCreada={async (t) => { setAviso({ ok: true, texto: t }); await recargar() }} onAviso={setAviso} />
      {anteriores.length > 0 && (
        <div className="grid" style={{ gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Campañas anteriores</h3>
          {anteriores.map((c) => <TarjetaCampana key={c.id} c={c} cliente={cliente} onCambio={recargar} onAviso={setAviso} />)}
        </div>
      )}
    </div>
  )
}

function NuevaCampana({ cliente, vendedores, ocupados, onCreada, onAviso }: {
  cliente: ClienteInvitacionesMasivas; vendedores: Vendedor[]; ocupados: Set<CanalInvitacion>; onCreada: (texto: string) => Promise<void>; onAviso: (a: Aviso) => void
}) {
  const [canal, setCanal] = useState<CanalInvitacion>('correo')
  const [aud, setAud] = useState('todos')   // 'todos' | 'sin' | <id de vendedor>
  const [limite, setLimite] = useState(80)   // correo 80 (cabe en el plan básico del proveedor junto con los avisos de pedido); WhatsApp 200 (cupo de Meta para números nuevos: 250 personas/día)
  const [plantilla, setPlantilla] = useState('invitacion_cuenta')
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const filtro = { seller: aud !== 'todos' && aud !== 'sin' ? aud : null, sinVendedor: aud === 'sin' }

  useEffect(() => {
    let vivo = true; setPrevia(null)
    void cliente.previa(canal, { seller: aud !== 'todos' && aud !== 'sin' ? aud : null, sinVendedor: aud === 'sin' }).then((r) => { if (vivo && r.ok) setPrevia(r.data) })
    return () => { vivo = false }
  }, [cliente, canal, aud])

  const lanzar = async () => {
    setConfirmar(false); setOcupado(true)
    const r = await cliente.crear(canal, filtro, limite, canal === 'whatsapp' ? plantilla.trim() : null)
    setOcupado(false)
    if (!r.ok) { onAviso({ ok: false, texto: r.error }); return }
    await onCreada(`Campaña creada: ${r.data.pendientes} invitaciones en cola. Empiezan a salir en el siguiente minuto de horario de atención.`)
  }

  const omitidos = Object.entries(previa?.omitidos ?? {}).filter(([, n]) => n > 0)
  const bloqueado = ocupados.has(canal)
  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 14 }} data-testid="inv-nueva">
      <h3 style={{ margin: 0, fontSize: 15 }}>Nueva campaña</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <div className="seg">
          {(['correo', 'whatsapp'] as const).map((k) => (
            <button key={k} type="button" className={canal === k ? 'active' : undefined} onClick={() => { setCanal(k); setLimite(k === 'correo' ? 80 : 200) }} data-testid={`inv-canal-${k}`}>
              {k === 'correo' ? <Mail size={13} /> : <MessageCircle size={13} />} {ETIQUETA_CANAL[k]}
            </button>
          ))}
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>A quién
          <select value={aud} onChange={(e) => setAud(e.target.value)} style={campo} aria-label="A quién" data-testid="inv-audiencia">
            <option value="todos">Todos los clientes sin cuenta</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>Cartera de {v.nombre}</option>)}
            <option value="sin">Clientes sin vendedor</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>Por día
          <input type="number" min={1} max={1000} value={limite} onChange={(e) => setLimite(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} style={{ ...campo, width: 100 }} aria-label="Límite diario" />
        </label>
        {canal === 'whatsapp' && (
          <label style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>Plantilla aprobada en Meta
            <input value={plantilla} onChange={(e) => setPlantilla(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} style={{ ...campo, width: 200 }} aria-label="Plantilla" />
          </label>
        )}
      </div>

      {canal === 'whatsapp' && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--surface-2, var(--surface))', border: '1px dashed var(--line)', borderRadius: 8, padding: 10 }}>
          WhatsApp no deja escribir primero a quien no te ha escrito en 24 h: hace falta una <b>plantilla aprobada por Meta</b> (categoría Utilidad, idioma
          Español (MEX), dos variables). Si Meta la rechaza o no está aprobada, la campaña se pone en pausa sola y nadie pierde su lugar. Texto sugerido:
          <div style={{ marginTop: 6, fontStyle: 'italic' }}>{TEXTO_PLANTILLA_WA}</div>
          <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => { void navigator.clipboard?.writeText(TEXTO_PLANTILLA_WA); onAviso({ ok: true, texto: 'Texto de la plantilla copiado.' }) }}><Copy size={13} /> Copiar texto</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }} data-testid="inv-previa">
        {!previa ? <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Calculando a quién le llega…</span> : (
          <>
            <span className="pill p-ok">Le llega a {previa.elegibles.toLocaleString('es-MX')}</span>
            {previa.elegibles > 0 && <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>≈ {diasEstimados(previa.elegibles, limite)} día(s) hábil(es) a {limite} por día</span>}
            {omitidos.map(([m, n]) => <span key={m} className="pill p-neu" title="No se le envía">{MOTIVO_OMITIDO[m] ?? m}: {n.toLocaleString('es-MX')}</span>)}
          </>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Los correos o celulares repetidos y mal escritos no se envían: quedan en una lista para revisarlos. A esos clientes puedes invitarlos uno por uno desde su ficha.</div>
      <div>
        <button className="btn" type="button" disabled={ocupado || bloqueado || !previa || previa.elegibles === 0 || (canal === 'whatsapp' && !plantilla.trim())} onClick={() => setConfirmar(true)} data-testid="inv-lanzar">
          <Send size={14} /> {bloqueado ? `Ya hay una campaña de ${ETIQUETA_CANAL[canal]} en curso` : ocupado ? 'Creando…' : 'Empezar envío'}
        </button>
      </div>
      {confirmar && previa && (
        <ConfirmModal title={`Invitar por ${ETIQUETA_CANAL[canal]}`} confirmLabel="Empezar envío" onClose={() => setConfirmar(false)} onConfirm={() => void lanzar()}
          message={<>Se mandará la invitación a <b>{previa.elegibles.toLocaleString('es-MX')}</b> cliente(s), hasta <b>{limite}</b> por día y solo en horario de atención. Puedes pausarla o cancelarla cuando quieras.</>} />
      )}
    </div>
  )
}

function TarjetaCampana({ c, cliente, onCambio, onAviso }: { c: Campana; cliente: ClienteInvitacionesMasivas; onCambio: () => Promise<void>; onAviso: (a: Aviso) => void }) {
  const [revision, setRevision] = useState<RenglonRevision[] | null>(null)
  const [cancelar, setCancelar] = useState(false)
  const total = c.pendientes + c.enviados + c.inciertos + c.fallidos + c.cancelados
  const pct = total ? Math.round((c.enviados / total) * 100) : 0
  const accion = async (a: 'pausar' | 'reanudar' | 'cancelar') => {
    setCancelar(false)
    const r = await cliente.cambiar(c.id, a)
    if (!r.ok) onAviso({ ok: false, texto: r.error }); else onAviso({ ok: true, texto: a === 'pausar' ? 'Campaña en pausa.' : a === 'reanudar' ? 'Campaña reanudada.' : 'Campaña cancelada: no sale nada más.' })
    await onCambio()
  }
  const verRevision = async () => {
    if (revision) { setRevision(null); return }
    const r = await cliente.revisar(c.id)
    if (r.ok) setRevision(r.data); else onAviso({ ok: false, texto: r.error })
  }
  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 10 }} data-testid="inv-campana">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {c.canal === 'correo' ? <Mail size={16} /> : <MessageCircle size={16} />}
        <b>{ETIQUETA_CANAL[c.canal]} · {c.sin_vendedor ? 'clientes sin vendedor' : c.vendedor ? `cartera de ${c.vendedor}` : 'todos los clientes sin cuenta'}</b>
        <span className={'pill ' + TONO[c.estado]}>{ESTADO_CAMPANA[c.estado]}</span>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>desde {new Date(c.creada_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          {c.estado === 'activa' && <button className="btn ghost sm" type="button" onClick={() => void accion('pausar')}><Pause size={13} /> Pausar</button>}
          {c.estado === 'pausada' && <button className="btn sm" type="button" onClick={() => void accion('reanudar')}><Play size={13} /> Reanudar</button>}
          {(c.estado === 'activa' || c.estado === 'pausada') && <button className="btn ghost sm" type="button" onClick={() => setCancelar(true)}><X size={13} /> Cancelar</button>}
          <button className="btn ghost sm" type="button" onClick={() => void onCambio()} aria-label="Actualizar"><RefreshCw size={13} /></button>
        </span>
      </div>
      {c.nota && <div className="pill p-warn" style={{ whiteSpace: 'normal' }} data-testid="inv-nota">En pausa: {c.nota}</div>}
      <div style={{ height: 8, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }} aria-label={`${pct}% enviado`}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green-deep)' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
        <span className="pill p-ok">{c.enviados.toLocaleString('es-MX')} enviadas</span>
        <span className="pill p-neu">{c.pendientes.toLocaleString('es-MX')} en cola</span>
        <span className="pill p-ok" title="Clientes que ya crearon su cuenta con esta invitación">{c.cuentas.toLocaleString('es-MX')} cuentas creadas</span>
        {c.estado === 'activa' && <span className="pill p-neu">hoy {c.hoy}/{c.limite_diario}</span>}
        {c.inciertos > 0 && <span className="pill p-warn">{c.inciertos} sin confirmar</span>}
        {c.fallidos > 0 && <span className="pill p-dang">{c.fallidos} no enviadas</span>}
        {c.omitidos > 0 && <span className="pill p-neu">{c.omitidos} para revisar</span>}
        {(c.omitidos + c.fallidos + c.inciertos) > 0 && <button className="btn ghost sm" type="button" onClick={() => void verRevision()} data-testid="inv-revisar">{revision ? 'Ocultar lista' : 'Ver lista para revisar'}</button>}
      </div>
      {revision && (
        <div className="tbl-scroll" style={{ maxHeight: 360, overflow: 'auto' }}>
          <table className="tbl-cards">
            <thead><tr><th>Cliente</th><th>{c.canal === 'correo' ? 'Correo' : 'Celular'}</th><th>Motivo</th></tr></thead>
            <tbody>
              {revision.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--ink-3)' }}>Nada que revisar.</td></tr>}
              {revision.map((x) => (
                <tr key={x.customer_id + x.estado}>
                  <td data-label="Cliente">{x.nombre}</td>
                  <td data-label={c.canal === 'correo' ? 'Correo' : 'Celular'} className="mono">{x.destino ?? '—'}</td>
                  <td data-label="Motivo">{x.estado === 'omitido' ? (MOTIVO_OMITIDO[x.motivo ?? ''] ?? x.motivo) : x.estado === 'fallido' ? `No se envió: ${x.motivo ?? ''}` : 'Sin confirmar'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cancelar && <ConfirmModal title="Cancelar campaña" confirmLabel="Cancelar campaña" onClose={() => setCancelar(false)} onConfirm={() => void accion('cancelar')}
        message={<>Las <b>{c.pendientes}</b> invitaciones en cola ya no saldrán. Las ya enviadas siguen sirviendo.</>} />}
    </div>
  )
}
