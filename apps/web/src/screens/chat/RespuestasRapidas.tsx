// CHAT PRO · respuestas rápidas del personal: se abren con el botón del redactor o escribiendo "/" y se insertan
// en el mensaje (editable antes de enviar). "Administrar" deja crear, editar y borrar las propias; Dirección también
// las de la empresa. La autoridad es el RLS de cc_respuestas_rapidas.
import React, { useState } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import { aplicarNombre, type ClienteRespuestas, type RespuestaRapida } from '../../data/ops/respuestasRapidas'

interface Props {
  lista: RespuestaRapida[]           // ya filtrada por lo escrito tras "/"
  activa: number                     // índice resaltado (flechas del teclado)
  onElegir: (r: RespuestaRapida) => void
  onCerrar: () => void
  onCambio: () => void               // tras guardar o borrar: recargar
  cliente: ClienteRespuestas
  puedeEmpresa: boolean              // Dirección: crea y edita las de la empresa
  filtro: string
  nombre?: string | null             // vista previa con el nombre del cliente ya puesto
}

type Edicion = { id?: string; titulo: string; texto: string; empresa: boolean }

export function RespuestasRapidas({ lista, activa, onElegir, onCerrar, onCambio, cliente, puedeEmpresa, filtro, nombre }: Props) {
  const [admin, setAdmin] = useState(false)
  const [ed, setEd] = useState<Edicion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const editable = (r: RespuestaRapida) => !!r.profile_id || puedeEmpresa
  const guardar = async () => {
    if (!ed || ocupado) return
    setOcupado(true); setError(null)
    const r = await cliente.guardar(ed)
    setOcupado(false)
    if (!r.ok) { setError(r.mensaje); return }
    setEd(null); onCambio()
  }
  const borrar = async (id: string) => {
    if (ocupado) return
    setOcupado(true); setError(null)
    const r = await cliente.borrar(id)
    setOcupado(false)
    if (!r.ok) { setError(r.mensaje); return }
    onCambio()
  }
  return (
    <div className="rc-rr" role="dialog" aria-label="Respuestas rápidas" data-testid="respuestas-rapidas">
      <div className="rc-rr-head">
        <b>{admin ? 'Administrar respuestas' : 'Respuestas rápidas'}</b>
        <button type="button" className="rc-ico" onClick={onCerrar} aria-label="Cerrar respuestas rápidas"><X size={16} /></button>
      </div>
      {!admin ? (<>
        <ul className="rc-rr-lista" role="listbox" aria-label="Elige una respuesta">
          {lista.length === 0 && <li className="rc-rr-vacio">{filtro ? `Sin respuestas que digan «${filtro}».` : 'Aún no hay respuestas guardadas.'}</li>}
          {lista.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === activa}>
              <button type="button" className={`rc-rr-item${i === activa ? ' rc-rr-item--on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onElegir(r)} data-testid="rr-item">
                <span className="rc-rr-titulo">{r.titulo}{!r.profile_id && <span className="rc-rr-tag">Empresa</span>}</span>
                <span className="rc-rr-texto">{aplicarNombre(r.texto, nombre)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="rc-rr-pie"><span>Escribe <kbd>/</kbd> para buscar</span><button type="button" className="rc-link" onClick={() => setAdmin(true)} data-testid="rr-administrar">Administrar</button></div>
      </>) : (<>
        {ed ? (
          <div className="rc-rr-form">
            <input value={ed.titulo} onChange={(e) => setEd({ ...ed, titulo: e.target.value })} maxLength={40} placeholder="Título (ej. Horario)" aria-label="Título de la respuesta" data-testid="rr-titulo" />
            <textarea value={ed.texto} onChange={(e) => setEd({ ...ed, texto: e.target.value })} maxLength={1000} rows={4} placeholder="Texto. Usa {nombre} para el nombre del cliente." aria-label="Texto de la respuesta" data-testid="rr-texto" />
            {puedeEmpresa && !ed.id && (
              <label className="rc-rr-check"><input type="checkbox" checked={ed.empresa} onChange={(e) => setEd({ ...ed, empresa: e.target.checked })} /> Para todo el equipo</label>
            )}
            <div className="rc-rr-acciones">
              <button type="button" className="btn sm" disabled={ocupado} onClick={() => void guardar()} data-testid="rr-guardar">Guardar</button>
              <button type="button" className="btn ghost sm" onClick={() => { setEd(null); setError(null) }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <ul className="rc-rr-lista">
            {lista.map((r) => (
              <li key={r.id} className="rc-rr-fila">
                <span className="rc-rr-titulo">{r.titulo}{!r.profile_id && <span className="rc-rr-tag">Empresa</span>}</span>
                {editable(r) && (<span className="rc-rr-btns">
                  <button type="button" className="rc-ico" aria-label={`Editar ${r.titulo}`} onClick={() => setEd({ id: r.id, titulo: r.titulo, texto: r.texto, empresa: !r.profile_id })}><Pencil size={15} /></button>
                  <button type="button" className="rc-ico" aria-label={`Borrar ${r.titulo}`} onClick={() => void borrar(r.id)} data-testid="rr-borrar"><Trash2 size={15} /></button>
                </span>)}
              </li>
            ))}
          </ul>
        )}
        {error && <div role="alert" className="rc-rr-error">{error}</div>}
        {!ed && <div className="rc-rr-pie"><button type="button" className="rc-link" onClick={() => setEd({ titulo: '', texto: '', empresa: false })} data-testid="rr-nueva">Nueva respuesta</button><button type="button" className="rc-link" onClick={() => { setAdmin(false); setError(null) }}>Listo</button></div>}
      </>)}
    </div>
  )
}
