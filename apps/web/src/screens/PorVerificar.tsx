// AVISO-VERIF · "Por verificar" de la vendedora: los doctores de su cartera que mandaron su verificación. Cada uno con el
// mismo panel del chat (cédula, fotos del INE, aprobar o rechazar). El aviso de la campana la trae aquí.
import React, { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { PanelVerificacion } from './chat/PanelVerificacion'
import { misPorVerificar as listarPorDefecto, type DoctorPendiente } from '../data/ops/verificacion'

export function PorVerificar({ listar = listarPorDefecto }: { listar?: typeof listarPorDefecto }) {
  const [lista, setLista] = useState<DoctorPendiente[] | null>(null)
  const cargar = useCallback(() => { void listar().then(setLista) }, [listar])
  useEffect(() => { cargar() }, [cargar])
  if (!lista || lista.length === 0) return null
  return (
    <div className="card" data-testid="por-verificar" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={17} style={{ color: 'var(--warn)' }} />
        <b>Doctores por verificar</b><span className="pill p-warn">{lista.length}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>· revisa su cédula y su INE y apruébalos tú</span>
      </div>
      {lista.map((d) => (
        <PanelVerificacion key={d.profile_id} conversationId={d.profile_id} leer={async () => d} onCambio={cargar} />
      ))}
    </div>
  )
}
