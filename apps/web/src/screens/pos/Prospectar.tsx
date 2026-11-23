// PROSPECTAR (23 nov 2026, dueño: «los vendedores deben tener los medios para prospectar por su cuenta… lo más profesional
// y completo posible»). UN flujo: registrar al prospecto (nombre y celular; la base evita duplicados y avisa si ya es de
// otra vendedora) → mandarle su primer WhatsApp con el mensaje de presentación aprobado por Meta → su conversación.
// Si no quiere escribirle aún, puede llamarle o dejarlo: ya quedó en su cartera y en su Embudo («Primer contacto»).
import React, { useState } from 'react'
import { Phone, MessageCircle } from 'lucide-react'
import { Hoja } from '../../app/Hoja'
import { NuevoProspectoForm, avisoProspecto, type ProspectoCreado } from './NuevoProspecto'
import { EscribirWhatsApp } from '../chat/EscribirWhatsApp'
import { useRoleOpcional } from '../../auth/RoleContext'
import { irAConversacion } from '../../data/store/navIntentStore'

/** Mensaje de presentación para un prospecto nuevo (aprobado por Meta): «le saluda {vendedor} de Renovacell…». */
export const PLANTILLA_PRESENTACION = 'seguimiento_vendedor'

type Paso = 'datos' | 'mensaje' | 'listo'

export function Prospectar({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const rol = useRoleOpcional()
  const [paso, setPaso] = useState<Paso>('datos')
  const [p, setP] = useState<ProspectoCreado | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const cerrar = () => { setPaso('datos'); setP(null); setAviso(null); onCerrar() }
  if (!abierto) return null
  return (
    <>
      <Hoja abierta={paso === 'datos'} onCerrar={cerrar} titulo="Nuevo prospecto" testid="prospectar">
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--ink-3)' }}>
          Registra a un doctor o clínica que conseguiste tú. Queda en tu cartera y en tu Embudo; enseguida le puedes mandar su primer WhatsApp.
        </p>
        <NuevoProspectoForm onCancelar={cerrar} onListo={(x) => { setP(x); setAviso(avisoProspecto(x)); setPaso('mensaje') }} />
      </Hoja>
      <EscribirWhatsApp cliente={paso === 'mensaje' && p ? { id: p.customer_id, nombre: p.nombre } : null} sugerida={PLANTILLA_PRESENTACION}
        onCerrar={() => setPaso('listo')}
        onListo={(conv, ventana) => { cerrar(); if (rol && conv) irAConversacion(rol.setScreen, conv, { origen: 'inicio' }); void ventana }} />
      <Hoja abierta={paso === 'listo' && !!p} onCerrar={cerrar} titulo={p?.nombre ?? ''} testid="prospectar-listo"
        pie={<button type="button" className="btn" onClick={cerrar} data-testid="prospectar-terminar">Listo</button>}>
        {aviso && <p style={{ margin: '0 0 12px' }} data-testid="prospectar-aviso">{aviso} Está en tu Embudo como «Primer contacto».</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => setPaso('mensaje')} data-testid="prospectar-whatsapp"><MessageCircle size={15} aria-hidden /> Mandarle WhatsApp</button>
          {p?.celular && <a className="btn ghost" href={`tel:+52${p.celular}`} data-testid="prospectar-llamar"><Phone size={15} aria-hidden /> Llamarle</a>}
        </div>
      </Hoja>
    </>
  )
}
