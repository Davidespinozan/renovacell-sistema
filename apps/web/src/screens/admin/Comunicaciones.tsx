// ADMIN · MENSAJES AL CLIENTE (W4-05)
//
// El buzón de la comunicación transaccional: qué se le dijo —o se le debe decir— a cada
// cliente sobre su pedido. Tres cosas que esta pantalla nunca hace:
//   · decir "enviado" si el proveedor de correo no lo confirmó;
//   · presentar un corte como un fracaso (o como un éxito): "sin confirmar" es su estado;
//   · reenviar algo que quizá ya llegó sin que una persona acepte el riesgo.
import React, { useMemo, useState } from 'react'
import { Mail, RefreshCw, Send } from 'lucide-react'
import { PageHead } from '../../app/PageHead'
import { ConfirmModal } from '../../app/ConfirmModal'
import { useComunicaciones } from '../../data/hooks/useComunicaciones'
import {
  despacharMensajes, reintentarMensaje, requiereAccion, ESTADO_MENSAJE, PLANTILLA_TEXTO,
  MENSAJES_VISIBLES, type EstadoMensaje, type MensajeCliente,
} from '../../data/ops/comunicaciones'

type Filtro = 'accion' | 'cola' | 'enviados' | 'todos'
type Aviso = { ok: boolean; text: string } | null

export function Comunicaciones() {
  const { data, error, loading, reload, cuentas } = useComunicaciones()
  const [filtro, setFiltro] = useState<Filtro>('accion')
  const [aviso, setAviso] = useState<Aviso>(null)
  const [ocupado, setOcupado] = useState(false)
  const [confirmar, setConfirmar] = useState<MensajeCliente | null>(null)

  const lista = useMemo(() => data.filter((m) =>
    filtro === 'todos' ? true
      : filtro === 'accion' ? requiereAccion(m)
        : filtro === 'cola' ? (m.status === 'pendiente' || m.status === 'enviando')
          : m.status === 'enviado'), [data, filtro])

  const enviar = async () => {
    setOcupado(true); setAviso(null)
    const r = await despacharMensajes()
    setOcupado(false)
    if (!r.ok) { setAviso({ ok: false, text: r.error }); await reload(); return }
    // Se reporta lo que el SERVIDOR asentó, desglosado: enviados no es lo mismo que procesados.
    setAviso({ ok: r.fallido === 0 && r.incierto === 0, text: r.procesados === 0
      ? 'No había mensajes por enviar.'
      : `Se procesaron ${r.procesados}: ${r.enviado} enviado(s), ${r.incierto} sin confirmar, ${r.fallido} no enviado(s).` })
    await reload()
  }

  const reintentar = async (m: MensajeCliente, acepto = false) => {
    setOcupado(true); setAviso(null); setConfirmar(null)
    const r = await reintentarMensaje(m.id, acepto)
    setOcupado(false)
    if (!r.ok) {
      if (r.pideConfirmarDuplicado) { setConfirmar(m); return }
      setAviso({ ok: false, text: r.error }); return
    }
    setAviso({ ok: true, text: 'El mensaje volvió a la cola. Todavía NO se ha enviado: usa "Enviar pendientes".' })
    await reload()
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Mensajes al cliente">
        Los avisos que el sistema le debe a cada cliente sobre su pedido: recibido, pagado, en camino,
        entregado, cancelado o reembolsado. Un mensaje aparece como <b>enviado</b> solo cuando el servicio
        de correo confirmó que lo recibió.
      </PageHead>

      <div className="card" style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="pill p-neu">{cuentas.porEnviar} por enviar</span>
        <span className="pill p-ok">{cuentas.enviados} enviados</span>
        <span className={'pill ' + (cuentas.conProblema ? 'p-dang' : 'p-neu')}>{cuentas.conProblema} requieren atención</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          <button className="btn ghost sm" type="button" disabled={ocupado} onClick={() => void reload()}><RefreshCw size={13} /> Actualizar</button>
          <button className="btn sm" type="button" disabled={ocupado || cuentas.porEnviar === 0} onClick={() => void enviar()}>
            <Send size={13} /> {ocupado ? 'Trabajando…' : 'Enviar pendientes'}
          </button>
        </span>
      </div>

      {aviso && (
        <p role="status" style={{ margin: 0, padding: '10px 12px', borderRadius: 10, fontSize: 13,
          background: aviso.ok ? 'var(--ok-bg)' : 'var(--warn-bg)' }}>{aviso.text}</p>
      )}
      {error && <p role="alert" style={{ margin: 0, padding: '10px 12px', borderRadius: 10, fontSize: 13, background: 'var(--danger-bg)' }}>{error}</p>}

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {([['accion', 'Requieren atención'], ['cola', 'Por enviar'], ['enviados', 'Enviados'], ['todos', 'Todos']] as const).map(([k, l]) => (
          <button key={k} type="button" className={filtro === k ? 'active' : undefined} onClick={() => setFiltro(k)}>{l}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, minWidth: 0 }}>
        <div className="tbl-scroll">
          <table className="tbl-cards">
            <thead><tr><th>Fecha</th><th>Aviso</th><th>Pedido</th><th>Cliente</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ color: 'var(--ink-3)' }}>Cargando el buzón…</td></tr>}
              {!loading && lista.length === 0 && (
                <tr><td colSpan={6} style={{ color: 'var(--ink-3)' }}>
                  {data.length === 0 ? 'Todavía no hay mensajes: aparecerán con el primer pedido.'
                    : filtro === 'accion' ? 'Ningún mensaje requiere atención.' : 'Nada en esta vista.'}
                </td></tr>
              )}
              {lista.map((m) => {
                const e = ESTADO_MENSAJE[m.status as EstadoMensaje]
                return (
                  <tr key={m.id}>
                    <td data-label="Fecha" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{new Date(m.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td data-label="Aviso"><Mail size={12} /> {PLANTILLA_TEXTO[m.plantilla] ?? m.plantilla}</td>
                    <td data-label="Pedido" className="mono" style={{ fontSize: 12 }}>{String(m.payload?.folio ?? '—')}</td>
                    <td data-label="Cliente">
                      {m.to_name ?? '—'}
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{m.to_address ?? 'sin correo registrado'}</div>
                    </td>
                    <td data-label="Estado">
                      <span className={'pill ' + (e?.tono ?? 'p-neu')} title={e?.explica}>{e?.etiqueta ?? m.status}</span>
                      {requiereAccion(m) && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3, maxWidth: 260 }}>{e?.explica}</div>}
                    </td>
                    <td data-label="" style={{ textAlign: 'right' }}>
                      {requiereAccion(m) && (
                        <button className="btn ghost sm" type="button" disabled={ocupado} onClick={() => void reintentar(m)}>
                          {m.status === 'sin_destinatario' ? 'Ya tiene correo' : 'Reintentar'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {data.length >= MENSAJES_VISIBLES && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)' }}>Se muestran los {MENSAJES_VISIBLES} mensajes más recientes.</p>
      )}

      {confirmar && (
        <ConfirmModal
          title="Este mensaje pudo haber llegado"
          message={<span>
            El envío de <b>{PLANTILLA_TEXTO[confirmar.plantilla] ?? confirmar.plantilla}</b> a {confirmar.to_address} se cortó
            antes de recibir respuesta y ya pasó el tiempo en que el servicio de correo evita duplicados.
            Si lo reenvías, <b>el cliente podría recibirlo dos veces</b>.
          </span>}
          confirmLabel="Reenviar de todos modos"
          onClose={() => setConfirmar(null)}
          onConfirm={() => void reintentar(confirmar, true)}
        />
      )}
    </div>
  )
}
