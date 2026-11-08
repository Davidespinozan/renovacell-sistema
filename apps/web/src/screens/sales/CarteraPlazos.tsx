// CARTERA-PLAZO · "Por vencer": cada cliente se queda con su vendedor 6 meses desde que lo atendió o desde su última compra
// pagada; si no le compra, pasa al siguiente vendedor en turno. Arriba, la competencia del mes entre vendedores (solo
// números); abajo, mis clientes por vencer con cuántos días me quedan y cómo hablarles.
import React, { useEffect, useMemo, useState } from 'react'
import { Cargando } from '../../app/EmptyState'
import { MessageCircle, Phone, Search, Trophy } from 'lucide-react'
import { carteraPlazos as plazosPorDefecto, carteraRanking as rankingPorDefecto, textoPlazo, textoSinCompra, tonoPlazo, type FilaRanking, type Plazos } from '../../data/ops/carteraPlazos'
import { normalizar, whatsappCon } from '../../data/ops/busqueda'
import { capitalizarNombre, primerNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'
import { Customer360Page } from '../../app/Customer360'

const VENTANAS = [{ dias: 30, label: 'Vencen en 30 días' }, { dias: 60, label: '60 días' }, { dias: 730, label: 'Toda mi cartera' }]
const PILL: Record<string, string> = { dang: 'p-dang', warn: 'p-warn', neu: 'p-neu' }

export function CarteraPlazos({ plazos = plazosPorDefecto, ranking = rankingPorDefecto }: { plazos?: typeof plazosPorDefecto; ranking?: typeof rankingPorDefecto }) {
  const [dias, setDias] = useState(30)
  const [datos, setDatos] = useState<Plazos | null | undefined>(undefined)
  const [tabla, setTabla] = useState<FilaRanking[] | null>(null)
  const [q, setQ] = useState('')
  const [ficha, setFicha] = useState<string | null>(null)
  useEffect(() => { setDatos(undefined); void plazos(dias).then(setDatos) }, [plazos, dias])
  useEffect(() => { void ranking().then(setTabla) }, [ranking])
  const lista = useMemo(() => {
    const b = normalizar(q.trim())
    return (datos?.clientes ?? []).filter((c) => !b || normalizar(`${c.nombre} ${c.vendedor ?? ''}`).includes(b))
  }, [datos, q])
  const meses = Math.round((datos?.plazo_dias ?? 180) / 30)

  if (ficha) return <Customer360Page customerId={ficha} onBack={() => setFicha(null)} />
  return (
    <div className="card pcl" data-testid="cartera-plazos">
      <h2 className="pcl-t">Por vencer</h2>
      <p className="pcl-sub">Cada cliente es tuyo {meses} meses desde que lo atendiste o desde su última compra pagada. Si no te compra en ese tiempo, pasa al siguiente vendedor en turno. Cada compra reinicia el plazo.</p>

      {tabla && tabla.length > 0 && (
        <section className="cp-rank" data-testid="ranking">
          <h3><Trophy size={15} aria-hidden /> Competencia del mes</h3>
          <div className="cp-rank-tabla" role="table" aria-label="Competencia del mes">
            <div className="cp-rank-fila cp-rank-head" role="row">
              <span role="columnheader">Vendedor</span><span role="columnheader">Compraron</span><span role="columnheader">Rescatados</span>
              <span role="columnheader">Nuevos</span><span role="columnheader">Por vencer</span><span role="columnheader">Perdidos</span><span role="columnheader">En cartera</span>
            </div>
            {tabla.map((f, i) => (
              <div key={f.vendedor + i} className={'cp-rank-fila' + (f.soy_yo ? ' yo' : '')} role="row" data-testid="ranking-fila">
                <span role="cell"><b>{i + 1}.</b> {f.soy_yo ? 'Tú' : primerNombre(f.vendedor)}</span>
                <span role="cell">{f.compraron_mes}</span><span role="cell">{f.rescatados_mes}</span><span role="cell">{f.nuevos_mes}</span>
                <span role="cell">{f.por_vencer_30}</span><span role="cell">{f.perdidos_mes}</span><span role="cell">{f.en_cartera}</span>
              </div>
            ))}
          </div>
          <small className="cp-rank-nota">Compraron: clientes con pedido pagado este mes. Rescatados: compraron tras un mes o más sin comprar. Por vencer: en los próximos 30 días.</small>
        </section>
      )}

      <div className="pcl-tabs" role="tablist">
        {VENTANAS.map((v) => (
          <button key={v.dias} type="button" role="tab" aria-selected={dias === v.dias} className={'pcl-tab' + (dias === v.dias ? ' on' : '')} onClick={() => setDias(v.dias)} data-testid={`ventana-${v.dias}`}>{v.label}</button>
        ))}
      </div>
      <span className="searchbox" style={{ minWidth: 200 }}><Search size={15} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" /></span>

      {datos === undefined ? <Cargando plano /> : datos === null ? <div role="alert" className="pcl-vacio">No se pudo cargar tu cartera.</div>
        : lista.length === 0 ? <div className="pcl-vacio" data-testid="plazos-vacio">{dias >= 730 ? 'Tu cartera está vacía.' : `Ningún cliente tuyo vence en los próximos ${dias} días.`}</div> : (
          <ul className="pcl-lista">
            {lista.map((c) => {
              const nombre = capitalizarNombre(c.nombre)
              const texto = `Hola ${nombre}, le escribo de Renovacell. ¿Cómo va con los productos? Tengo novedades y promociones para usted; ¿le preparo su siguiente pedido?`
              return (
                <li key={`${c.tipo}:${c.profile_id ?? c.customer_id ?? c.visitor_id}`} className="pcl-item" data-testid="plazo">
                  {c.customer_id ? <button type="button" className="pcl-nombre" onClick={() => setFicha(c.customer_id)} title="Ver su ficha">{nombre}</button> : <b className="pcl-nombre" style={{ cursor: 'default' }}>{nombre}</b>}
                  <span className="pcl-det" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className={'pill ' + PILL[tonoPlazo(c.dias_restantes)]} data-testid="plazo-dias">{textoPlazo(c.dias_restantes)}</span>
                    <span>{textoSinCompra(c.dias_sin_compra)} · vence el {fmtDate(c.vence)}</span>
                    {c.tipo === 'prospecto' && <span className="pill p-neu">Prospecto</span>}
                    {c.vendedor && <span>· {c.vendedor}</span>}
                  </span>
                  <span className="pcl-acc">
                    {c.telefono && <a className="btn ghost sm" href={`tel:${c.telefono}`}><Phone size={14} /> Llamar</a>}
                    {c.telefono && <a className="btn ghost sm" href={whatsappCon(c.telefono, texto)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
    </div>
  )
}
