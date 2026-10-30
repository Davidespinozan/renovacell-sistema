// HERRAMIENTAS DEL VENDEDOR · bloque B · clasificar a un cliente: Doctor o Clínica y su especialidad (lista fija + "Otra").
// Se guarda en cuanto se elige. Lo usan la ficha del cliente, el chat y "Clasifica tu cartera".
import React, { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { ETIQUETA_TIPO, perfilComercial as clientePorDefecto, type ClientePerfilComercial, type Especialidad, type TipoCliente } from '../data/ops/perfilComercial'

let cacheEsp: Promise<Especialidad[]> | null = null
export function useEspecialidades(cliente: ClientePerfilComercial = clientePorDefecto): Especialidad[] {
  const [l, setL] = useState<Especialidad[]>([])
  useEffect(() => { let vivo = true; if (!cacheEsp || cliente !== clientePorDefecto) cacheEsp = cliente.especialidades(); void cacheEsp.then((x) => { if (vivo) setL(x) }); return () => { vivo = false } }, [cliente])
  return l
}
export const olvidarEspecialidades = () => { cacheEsp = null }

/** Controles de clasificación sin carga propia (los datos y el guardado los da quien monta). */
export function ControlesPerfil({ tipo, especialidad, otra, especialidades, ocupado, onCambio, compacto = false }: {
  tipo: TipoCliente | null; especialidad: string | null; otra: string | null; especialidades: Especialidad[]; ocupado?: boolean; compacto?: boolean
  onCambio: (t: TipoCliente | null, esp: string | null, otra: string | null) => void
}) {
  const [txt, setTxt] = useState(otra ?? '')
  useEffect(() => { setTxt(otra ?? '') }, [otra])
  return (
    <span className={'pce' + (compacto ? ' pce--compacto' : '')}>
      <span className="pce-tipos" role="group" aria-label="Tipo de cliente">
        {(['doctor', 'clinica'] as const).map((t) => (
          <button key={t} type="button" className={'pce-tipo' + (tipo === t ? ' on' : '')} aria-pressed={tipo === t} disabled={ocupado}
            onClick={() => onCambio(tipo === t ? null : t, especialidad, otra)} data-testid={`tipo-${t}`}>{ETIQUETA_TIPO[t]}</button>
        ))}
      </span>
      <select className="pce-esp" value={especialidad ?? ''} disabled={ocupado} aria-label="Especialidad" data-testid="especialidad"
        onChange={(e) => { const v = e.target.value || null; if (v !== 'otra') onCambio(tipo, v, null); else onCambio(tipo, v, txt || null) }}>
        <option value="">Especialidad…</option>
        {especialidades.map((e) => <option key={e.clave} value={e.clave}>{e.nombre}</option>)}
      </select>
      {especialidad === 'otra' && (
        <input className="pce-otra" value={txt} maxLength={60} placeholder="¿Cuál?" aria-label="Otra especialidad" disabled={ocupado} data-testid="especialidad-otra"
          onChange={(e) => setTxt(e.target.value)} onBlur={() => { if (txt.trim().length >= 2 && txt.trim() !== (otra ?? '')) onCambio(tipo, 'otra', txt.trim()) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      )}
    </span>
  )
}

/** Editor con carga y guardado propios, para la ficha del cliente y el chat. No se muestra si quien mira no puede editarlo. */
export function PerfilComercialEditor({ customerId, cliente = clientePorDefecto, compacto = false }: { customerId: string; cliente?: ClientePerfilComercial; compacto?: boolean }) {
  const especialidades = useEspecialidades(cliente)
  const [p, setP] = useState<{ tipo: TipoCliente | null; especialidad: string | null; otra: string | null } | null>(null)
  const [estado, setEstado] = useState<null | 'guardando' | 'guardado' | string>(null)
  useEffect(() => {
    setP(null); let vivo = true
    void cliente.perfil(customerId).then((r) => { if (vivo && r.ok) setP({ tipo: r.data.tipo, especialidad: r.data.especialidad, otra: r.data.especialidad_otra }) })
    return () => { vivo = false }
  }, [customerId, cliente])
  if (!p) return null
  const cambiar = async (t: TipoCliente | null, esp: string | null, otra: string | null) => {
    const antes = p; setP({ tipo: t, especialidad: esp, otra })
    if (esp === 'otra' && !otra) return   // espera a que escriba cuál
    setEstado('guardando')
    const r = await cliente.guardar(customerId, t, esp, otra)
    if (!r.ok) { setP(antes); setEstado(r.mensaje); return }
    setEstado('guardado'); window.setTimeout(() => setEstado((e) => (e === 'guardado' ? null : e)), 1800)
  }
  return (
    <div className="pce-caja" data-testid="perfil-comercial">
      <ControlesPerfil tipo={p.tipo} especialidad={p.especialidad} otra={p.otra} especialidades={especialidades} ocupado={estado === 'guardando'} onCambio={(t, e, o) => void cambiar(t, e, o)} compacto={compacto} />
      {estado === 'guardado' ? <span className="pce-ok" role="status"><Check size={13} /> Guardado</span>
        : estado && estado !== 'guardando' ? <span className="pce-error" role="alert">{estado}</span> : null}
    </div>
  )
}
