// HERRAMIENTAS DEL VENDEDOR · bloque C · "Pendientes": con qué clientes quedó algo pendiente, en qué estado y cuándo toca
// retomarlos (vencidos, hoy, próximos). Desde aquí se abre la conversación, se marca hecho o se pospone. El jefe de ventas y
// Dirección ven los de todo el equipo con su vendedor.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Clock, MessageCircle } from 'lucide-react'
import { ETIQUETA_ESTADO, cuandoRetomar, enDias, seguimientos as clientePorDefecto, type ClienteSeguimientos, type Seguimiento } from '../data/ops/seguimientos'
import { capitalizarNombre } from '../lib/nombres'
import { useRoleOpcional } from '../auth/RoleContext'
import { irAConversacion } from '../data/store/navIntentStore'
import { Vacio } from '../app/EmptyState'

export function Seguimientos({ cliente = clientePorDefecto }: { cliente?: ClienteSeguimientos }) {
  const rol = useRoleOpcional()
  const [datos, setDatos] = useState<{ hoy: string; seguimientos: Seguimiento[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => { const r = await cliente.mios(); if (r.ok) { setDatos(r.data); setError(null) } else setError(r.mensaje) }, [cliente])
  useEffect(() => { void cargar() }, [cargar])
  const grupos = useMemo(() => {
    const l = datos?.seguimientos ?? []; const hoy = datos?.hoy ?? ''
    return [
      { k: 'vencidos', titulo: 'Vencidos', items: l.filter((s) => s.recordar_el < hoy) },
      { k: 'hoy', titulo: 'Para hoy', items: l.filter((s) => s.recordar_el === hoy) },
      { k: 'proximos', titulo: 'Próximos', items: l.filter((s) => s.recordar_el > hoy) },
    ]
  }, [datos])
  const accion = async (p: Promise<{ ok: boolean; mensaje?: string }>) => { const r = await p; if (!r.ok) setError(r.mensaje ?? 'No se pudo.'); void cargar() }

  return (
    <div className="card sgs" data-testid="seguimientos">
      <div className="sgs-h"><h2>Pendientes</h2><span>{datos ? `${datos.seguimientos.length} ${datos.seguimientos.length === 1 ? 'cliente por retomar' : 'clientes por retomar'}` : ''}</span></div>
      <p className="sgs-sub">Lo que quedó pendiente con cada cliente y cuándo retomarlo. Se deja desde el chat («+» › Dejar seguimiento); el día que toca te llega un aviso.</p>
      {error && <div className="pce-error" role="alert">{error}</div>}
      {datos && datos.seguimientos.length === 0 && <Vacio plano icono="clock" titulo="No tienes pendientes." pista="Cuando dejes un seguimiento en una conversación, aparecerá aquí." />}
      {grupos.filter((g) => g.items.length).map((g) => (
        <section key={g.k} className="sgs-grupo" data-testid={`seguimientos-${g.k}`}>
          <h3>{g.titulo} <small>({g.items.length})</small></h3>
          <ul>
            {g.items.map((s) => {
              const c = cuandoRetomar(s.recordar_el, datos?.hoy)
              return (
                <li key={s.id} className="sgs-item" data-testid="seguimiento">
                  <div className="sgs-tx">
                    <b>{capitalizarNombre(s.nombre ?? 'Cliente')}</b>
                    <span><span className={`pill p-${c.tono}`}>{c.texto}</span> {ETIQUETA_ESTADO[s.estado]}{!s.es_mio && s.vendedor ? ` · ${s.vendedor}` : ''}</span>
                    {s.nota && <small>{s.nota}</small>}
                  </div>
                  <div className="sgs-acc">
                    {s.conversacion && rol && <button type="button" className="btn ghost sm" onClick={() => irAConversacion(rol.setScreen, s.conversacion!, { origen: 'inicio' })} data-testid="seguimiento-abrir"><MessageCircle size={14} /> Abrir chat</button>}
                    {s.es_mio && <>
                      <button type="button" className="btn ghost sm" onClick={() => void accion(cliente.posponer(s.id, enDias(1)))} data-testid="seguimiento-posponer"><Clock size={14} /> Mañana</button>
                      <button type="button" className="btn sm" onClick={() => void accion(cliente.hecho(s.id))} data-testid="seguimiento-hecho"><Check size={14} /> Hecho</button>
                    </>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
