// PROSPECCIÓN · «A QUIÉN LLAMAR HOY» (15 nov 2026). La vendedora ve su lista del día (cartera histórica sin cuenta en el
// portal), marca con un toque y anota el resultado; el sistema decide cuándo vuelve cada cliente. Dirección y el jefe de
// ventas ven el avance de cada vendedora y pueden abrir la lista de cualquiera.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, Phone } from 'lucide-react'
import { EscribirWhatsApp } from '../chat/EscribirWhatsApp'
import { useRoleOpcional } from '../../auth/RoleContext'
import { irAConversacion } from '../../data/store/navIntentStore'
import { PageHead } from '../../app/PageHead'
import { Vacio, Cargando, ErrorCarga } from '../../app/EmptyState'
import { Hoja } from '../../app/Hoja'
import { hoyNegocio, sumarDias } from '../../data/periodo'
import { toast } from '../../app/Toast'
import { prospeccion as crear, QUE_PASA, RESULTADOS, telMarcable, type AvanceVendedor, type ListaHoy, type PorLlamar, type ResultadoLlamada } from '../../data/ops/prospeccion'

const hoyLocal = () => hoyNegocio()
const masDias = (n: number) => sumarDias(hoyNegocio(), n)
const ETIQUETA_ULTIMO: Record<ResultadoLlamada, string> = Object.fromEntries(RESULTADOS.map((r) => [r.key, r.label])) as Record<ResultadoLlamada, string>
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

export function LlamarHoy({ cliente: inyectado }: { cliente?: ReturnType<typeof crear> }) {
  const cliente = useRef(inyectado ?? crear()).current
  const [datos, setDatos] = useState<ListaHoy | null>(null)
  const [avance, setAvance] = useState<AvanceVendedor[] | null>(null)
  const [vendedor, setVendedor] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<PorLlamar | null>(null)
  const [resultado, setResultado] = useState<ResultadoLlamada | null>(null)
  const [nota, setNota] = useState('')
  const [proxima, setProxima] = useState(masDias(1))
  const [guardando, setGuardando] = useState(false)
  const [whats, setWhats] = useState<{ id: string; nombre: string } | null>(null)
  const rol = useRoleOpcional()

  const cargar = useCallback(async () => {
    const [r, a] = await Promise.all([cliente.hoy(vendedor || null), cliente.resumen(7)])
    if (!r.ok) { setError(r.error); return }
    setError(null); setDatos(r.data); setAvance(a.ok ? a.data : null)   // el avance solo lo reciben Dirección y el jefe de ventas
  }, [cliente, vendedor])
  useEffect(() => { void cargar() }, [cargar])

  const abrir = (p: PorLlamar) => { setAbierto(p); setResultado(null); setNota(''); setProxima(masDias(1)) }
  const guardar = async () => {
    if (!abierto || !resultado) return
    setGuardando(true)
    const r = await cliente.registrar(abierto.customer_id, resultado, nota.trim() || null, resultado === 'llamar_despues' ? proxima : null)
    setGuardando(false)
    if (!r.ok) { toast(r.error, 'error'); return }
    toast(resultado === 'interesado' ? 'Listo. Ya está en tu embudo de ventas.' : 'Listo.')
    setAbierto(null)
    void cargar()
  }

  const veTodo = !!avance
  const res = datos?.resumen
  return (
    <div className="grid llamar" style={{ gap: 16 }} data-testid="llamar-hoy">
      <PageHead title="A quién llamar hoy">
        Tus clientes de cartera que aún no tienen cuenta en el portal. Llama, toca su nombre y anota cómo te fue: el sistema decide cuándo vuelve cada uno.
        Los que dicen que les interesa entran a tu embudo de ventas.
      </PageHead>

      {veTodo && avance && (
        <section className="llamar-avance" data-testid="llamar-avance" aria-label="Avance del equipo">
          {avance.map((v) => (
            <button key={v.vendedor_id} type="button" className={'llamar-vend' + (vendedor === v.vendedor_id ? ' on' : '')} onClick={() => setVendedor(vendedor === v.vendedor_id ? '' : v.vendedor_id)}>
              <b>{v.vendedor}</b>
              <span>{v.hoy} hoy · {v.periodo} en 7 días · {v.interesados} interesados</span>
              <small>{v.cartera} en cartera sin cuenta</small>
            </button>
          ))}
        </section>
      )}

      {res && (
        <div className="llamar-kpis" data-testid="llamar-kpis">
          <div><b>{res.hechas_hoy}</b><span>llamadas hoy</span></div>
          <div><b>{res.interesados_hoy}</b><span>interesados hoy</span></div>
          <div><b>{res.hechas_semana}</b><span>en 7 días</span></div>
          <div><b>{datos?.por_llamar ?? 0}</b><span>por llamar</span></div>
        </div>
      )}

      {datos === null ? (error ? <ErrorCarga titulo="No se pudo cargar tu lista" detalle={error} onReintentar={() => { setError(null); void cargar() }} /> : <Cargando filas={6} />)
        : datos.lista.length === 0 ? (
          <Vacio icono="usercheck" titulo="Ya no hay a quién llamar hoy." pista="Mañana aparecen los que tocan de nuevo." data-testid="llamar-vacio" />
        ) : (
          <ul className="llamar-lista" data-testid="llamar-lista">
            {datos.lista.map((p) => (
              <li key={p.customer_id} className="llamar-fila">
                <button type="button" className="llamar-info" onClick={() => abrir(p)} data-testid="llamar-fila">
                  <b>{p.nombre}</b>
                  <span>{[p.especialidad, p.ciudad].filter(Boolean).join(' · ') || 'Sin especialidad'}</span>
                  <small className={p.ultimo === 'llamar_despues' ? 'llamar-motivo llamar-motivo--hoy' : 'llamar-motivo'}>
                    {p.motivo}{p.ultimo_at ? ` · ${ETIQUETA_ULTIMO[p.ultimo!] ?? ''} el ${fecha(p.ultimo_at)}` : ''}{p.ultima_nota ? ` · «${p.ultima_nota}»` : ''}
                  </small>
                </button>
                <a className="llamar-tel" href={`tel:${telMarcable(p.telefono)}`} aria-label={`Llamar a ${p.nombre}`} onClick={() => setTimeout(() => abrir(p), 600)} data-testid="llamar-tel">
                  <Phone size={18} aria-hidden /><span>{p.telefono}</span>
                </a>
                <button type="button" className="llamar-wa" onClick={() => setWhats({ id: p.customer_id, nombre: p.nombre })} aria-label={`WhatsApp a ${p.nombre}`} title="Mandarle WhatsApp" data-testid="llamar-wa"><MessageCircle size={18} aria-hidden /></button>
              </li>
            ))}
          </ul>
        )}

      <Hoja abierta={!!abierto} onCerrar={() => setAbierto(null)} titulo={abierto ? `¿Cómo te fue con ${abierto.nombre}?` : ''} testid="llamar-hoja"
        pie={<button type="button" className="btn" disabled={!resultado || guardando || (resultado === 'llamar_despues' && !proxima)} onClick={() => void guardar()} data-testid="llamar-guardar">
          {guardando ? 'Guardando…' : !resultado ? 'Elige cómo te fue' : 'Guardar'}
        </button>}>
        {abierto && (
          <div className="llamar-form">
            <a className="llamar-tel llamar-tel--grande" href={`tel:${telMarcable(abierto.telefono)}`}><Phone size={18} aria-hidden /> {abierto.telefono}</a>
            <div className="llamar-resultados" role="radiogroup" aria-label="Resultado de la llamada">
              {RESULTADOS.map((r) => (
                <button key={r.key} type="button" role="radio" aria-checked={resultado === r.key} className={`llamar-res llamar-res--${r.tono}`} onClick={() => setResultado(r.key)} data-testid={`res-${r.key}`}>{r.label}</button>
              ))}
            </div>
            {resultado && <small className="llamar-que-pasa">{QUE_PASA[resultado]}</small>}
            {resultado === 'no_contesto' && <button type="button" className="btn ghost sm" onClick={() => setWhats({ id: abierto.customer_id, nombre: abierto.nombre })} data-testid="llamar-wa-no-contesto"><MessageCircle size={14} aria-hidden /> Mandarle WhatsApp</button>}
            {resultado === 'llamar_despues' && (
              <label className="llamar-campo">¿Qué día le vuelves a llamar?
                <input type="date" value={proxima} min={hoyLocal()} onChange={(e) => setProxima(e.target.value)} data-testid="llamar-fecha" />
              </label>
            )}
            <label className="llamar-campo">Nota (opcional)
              <textarea value={nota} maxLength={500} rows={3} onChange={(e) => setNota(e.target.value)} placeholder="p. ej. le interesa Golden Placenta; pide precio de mayoreo" data-testid="llamar-nota" />
            </label>
          </div>
        )}
      </Hoja>
      <EscribirWhatsApp cliente={whats} onCerrar={() => setWhats(null)} onListo={(conv, ventana) => {
        setWhats(null)
        toast(ventana ? 'Te escribió hace poco: escríbele normal en su conversación.' : 'Listo: le llegó por WhatsApp. Cuando conteste, te aparece en Conversaciones.')
        if (ventana && rol) irAConversacion(rol.setScreen, conv, { origen: 'inicio' })
      }} />
    </div>
  )
}
