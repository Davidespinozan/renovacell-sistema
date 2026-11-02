// IA MEJOR QUE EL HUMANO (2 nov 2026) · Conversaciones → Asesora IA (Dirección). Tres cosas en una pantalla:
// 1) cómo le va a la IA contra el equipo en conversaciones reales; 2) el examen: 60 preguntas reales corridas con el
// orquestador del portal y calificadas por un juez, para elegir modelo y no empeorar con cada cambio; 3) qué modelo usa
// la IA del portal. El examen corre caso por caso desde aquí (la Edge no escribe conversaciones ni carritos).
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { asesoraIa as clientePorDefecto, MODELOS, nombreModelo, type ClienteAsesoraIa, type ConfigIA, type ConfigSeguimiento, type ResumenSeguimiento, type Adopcion as AdopcionDatos, type Corrida, type DoctorExamen, type Esfuerzo, type IaVsHumano, type ResultadoCaso } from '../../data/ops/asesoraIa'

const sutil: React.CSSProperties = { fontSize: 12, color: 'var(--ink-3, #667)' }
const input: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, fontFamily: 'inherit', fontSize: 14, background: 'var(--card, #fff)', color: 'inherit' }
const cifra: React.CSSProperties = { padding: '12px 14px', background: 'var(--cp-surface, #fff)', display: 'grid', gap: 2 }
const CATEGORIA: Record<string, string> = { precio: 'Precios', reglas_pedido: 'Reglas del pedido', promociones: 'Promociones', recomendacion: 'Recomendación', tecnico: 'Técnico', clinico: 'Clínico', objeciones: 'Objeciones y cierre', entrega_pago: 'Entrega y pago', seguridad: 'Límites', multiturno: 'Conversación' }
const ESFUERZO: Record<Esfuerzo, string> = { low: 'Normal', medium: 'Más cuidadoso', high: 'Máximo' }
const seg = (s: number | null | undefined) => (s == null ? '—' : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`)
const usd = (n: number | null | undefined) => (n == null ? '—' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`)
const pesos = (n: number | null | undefined) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-MX'))
const colorPuntaje = (p: number | null | undefined) => (p == null ? 'var(--ink-3)' : p >= 8 ? 'var(--green-deep, #15803d)' : p >= 7 ? '#4d7c0f' : p >= 5 ? '#b45309' : 'var(--danger, #b91c1c)')

function Cifra({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return <div style={cifra}><span style={sutil}>{titulo}</span><b style={{ fontSize: 20 }}>{valor}</b>{detalle && <span style={sutil}>{detalle}</span>}</div>
}

export function AsesoraIA({ cliente = clientePorDefecto }: { cliente?: ClienteAsesoraIa }) {
  const [config, setConfig] = useState<ConfigIA | null>(null)
  const [vs, setVs] = useState<IaVsHumano | null>(null)
  const [corridas, setCorridas] = useState<Corrida[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<{ corrida: Corrida; filas: ResultadoCaso[] } | null>(null)

  const cargar = useCallback(async () => {
    const [c, v, k] = await Promise.all([cliente.config(), cliente.vsHumano(30), cliente.corridas()])
    if (!c.ok) { setError(c.error); return }
    setConfig(c.data); if (v.ok) setVs(v.data); if (k.ok) setCorridas(k.data ?? []); setError(null)
  }, [cliente])
  useEffect(() => { void cargar() }, [cargar])

  return (
    <div style={{ display: 'grid', gap: 16 }} data-testid="asesora-ia">
      {error && <div role="alert" className="sysnote" style={{ color: 'var(--danger)' }}>{error}</div>}
      {aviso && <div role="status" className="sysnote" style={{ background: 'var(--ok-bg)', color: 'var(--green-deep)' }}>{aviso}</div>}
      <VsEquipo vs={vs} />
      <Examen cliente={cliente} corridas={corridas} config={config} onCambio={cargar} onDetalle={async (k) => { const r = await cliente.resultados(k.id); if (r.ok) setDetalle({ corrida: k, filas: r.data ?? [] }) }} onAviso={setAviso} />
      {detalle && <Detalle corrida={detalle.corrida} filas={detalle.filas} onCerrar={() => setDetalle(null)} />}
      <Seguimiento cliente={cliente} />
      <Adopcion cliente={cliente} />
      <ModeloPortal cliente={cliente} config={config} corridas={corridas} onGuardado={(c) => { setConfig(c); setAviso(`La IA del portal ahora usa ${nombreModelo(c.modelo_portal)}.`) }} />
    </div>
  )
}

function VsEquipo({ vs }: { vs: IaVsHumano | null }) {
  const ia = vs?.respuestas.ia; const eq = vs?.respuestas.equipo
  const cIa = vs?.conversaciones.ia; const cEq = vs?.conversaciones.equipo
  return (
    <section className="card" data-testid="ia-vs-equipo">
      <h2 style={{ margin: '0 0 4px' }}>IA vs equipo · últimos 30 días</h2>
      <p style={{ margin: '0 0 10px', ...sutil }}>Conversaciones reales del portal y WhatsApp. "Con pedido": el carrito de la conversación se volvió pedido o el cliente compró en los 7 días siguientes.</p>
      <div className="kpi-strip" style={{ borderRadius: 12, overflow: 'hidden' }}>
        <Cifra titulo="Responde la IA en" valor={seg(ia?.mediana_seg)} detalle={ia ? `${ia.en_5_min ?? 0}% en menos de 5 min · ${ia.n} respuestas` : 'sin datos'} />
        <Cifra titulo="Responde el equipo en" valor={seg(eq?.mediana_seg)} detalle={eq ? `${eq.en_5_min ?? 0}% en menos de 5 min · ${eq.n} respuestas` : 'sin datos'} />
        <Cifra titulo="Con pedido · solo IA" valor={cIa?.conversion != null ? `${cIa.conversion}%` : '—'} detalle={cIa ? `${cIa.con_pedido} de ${cIa.n} · ticket ${pesos(cIa.ticket_promedio)}` : 'sin datos'} />
        <Cifra titulo="Con pedido · con equipo" valor={cEq?.conversion != null ? `${cEq.conversion}%` : '—'} detalle={cEq ? `${cEq.con_pedido} de ${cEq.n} · ticket ${pesos(cEq.ticket_promedio)}` : 'sin datos'} />
      </div>
      {vs && !vs.muestra_suficiente && <div style={sutil}>Todavía hay pocas conversaciones para comparar con confianza (menos de 30 respuestas); mientras tanto, el examen es la referencia.</div>}
      {cIa && <div style={sutil}>{cIa.pidieron_asesor} de {cIa.n} conversaciones atendidas solo por la IA pidieron un asesor.</div>}
    </section>
  )
}

function Examen({ cliente, corridas, config, onCambio, onDetalle, onAviso }: { cliente: ClienteAsesoraIa; corridas: Corrida[]; config: ConfigIA | null; onCambio: () => void; onDetalle: (k: Corrida) => void; onAviso: (t: string | null) => void }) {
  const [modelo, setModelo] = useState('claude-opus-5-5')
  const [esfuerzo, setEsfuerzo] = useState<Esfuerzo>('low')
  const [q, setQ] = useState('')
  const [doctores, setDoctores] = useState<DoctorExamen[]>([])
  const [doctor, setDoctor] = useState<string>('')
  const [creando, setCreando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    const t = setTimeout(() => { void cliente.doctores(q).then((r) => { if (vivo && r.ok) { setDoctores(r.data); if (!doctor && r.data[0]) setDoctor(r.data[0].id) } }) }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [cliente, q, doctor])
  // El servidor corre el examen: mientras haya una corrida en curso, la tabla se refresca sola (se puede cerrar la página).
  const enCurso = corridas.some((k) => k.estado === 'en_curso')
  useEffect(() => {
    if (!enCurso) return
    const t = setInterval(onCambio, 5000)
    return () => clearInterval(t)
  }, [enCurso, onCambio])

  const correr = async () => {
    if (!doctor || creando) return
    setErr(null); onAviso(null); setCreando(true)
    const c = await cliente.crearCorrida(modelo, doctor, esfuerzo, null, null)
    setCreando(false)
    if (!c.ok) { setErr(c.error); return }
    onAviso(`Examen con ${nombreModelo(modelo)} en curso: lo corre el servidor, puedes cerrar esta página y volver luego.`)
    onCambio()
  }
  const continuar = async (k: Corrida) => { const r = await cliente.continuar(k.id); if (r.ok) onCambio(); else setErr(r.error) }
  const detener = async (k: Corrida) => { const r = await cliente.detener(k.id); if (r.ok) onCambio(); else setErr(r.error) }

  return (
    <section className="card" data-testid="examen-ia">
      <h2 style={{ margin: '0 0 4px' }}>Examen de la asesora</h2>
      <p style={{ margin: '0 0 12px', ...sutil }}>60 preguntas como las de los doctores (precios, reglas del pedido, promociones, recomendación, técnico, clínico, objeciones, entrega y límites). La IA responde con el mismo sistema que usa el portal, con los datos reales del doctor que elijas, sin escribir nada; un juez califica de 0 a 10 contra lo que haría el mejor asesor. Lo corre el servidor (unos 10 minutos): puedes cerrar esta página y volver.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={input} value={modelo} onChange={(e) => setModelo(e.target.value)} aria-label="Modelo" data-testid="examen-modelo">{MODELOS.map((m) => <option key={m.id} value={m.id}>{m.nombre} · {m.nota}</option>)}</select>
        <select style={input} value={esfuerzo} onChange={(e) => setEsfuerzo(e.target.value as Esfuerzo)} aria-label="Esfuerzo">{(Object.keys(ESFUERZO) as Esfuerzo[]).map((k) => <option key={k} value={k}>{ESFUERZO[k]}</option>)}</select>
        <input style={{ ...input, minWidth: 160 }} placeholder="Buscar doctor" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar doctor" />
        <select style={{ ...input, maxWidth: 260 }} value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label="Doctor" data-testid="examen-doctor">{doctores.map((d) => <option key={d.id} value={d.id}>{d.full_name || d.email}</option>)}</select>
        <button className="btn" type="button" onClick={() => void correr()} disabled={!doctor || creando} data-testid="examen-correr">{creando ? 'Iniciando…' : 'Correr examen'}</button>
      </div>
      {err && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{err}</div>}

      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table className="tbl-cards" style={{ width: "100%", fontSize: 13 }} data-testid="examen-corridas">
          <thead><tr><th style={{ textAlign: 'left' }}>Modelo</th><th>Calificación</th><th>Aprobadas</th><th>Tiempo típico</th><th>Costo por respuesta</th><th style={{ textAlign: 'left' }}>Más baja</th><th /></tr></thead>
          <tbody>
            {corridas.length === 0 && <tr><td colSpan={7} style={sutil}>Aún no hay exámenes. Corre el primero con el modelo actual y luego con los demás para comparar.</td></tr>}
            {corridas.map((k) => {
              const peor = Object.entries(k.por_categoria ?? {}).sort((a, b) => a[1] - b[1])[0]
              const actual = (config?.modelo_portal ?? 'claude-haiku-4-5-20251001') === k.modelo
              return (
                <tr key={k.id}>
                  <td><b>{nombreModelo(k.modelo)}</b>{actual && <span style={{ ...sutil, marginLeft: 6 }}>· en uso</span>}<div style={sutil}>{ESFUERZO[k.esfuerzo]} · {new Date(k.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</div></td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: colorPuntaje(k.puntaje) }}>{k.puntaje ?? '—'}</td>
                  <td style={{ textAlign: 'center' }}>{k.aprobados}/{k.casos}{k.corridos < k.casos && <div style={sutil} data-testid="examen-avance">{k.estado === 'en_curso' ? `corriendo ${k.corridos}/${k.casos}…` : `${k.corridos} de ${k.casos} corridos`}</div>}</td>
                  <td style={{ textAlign: 'center' }}>{k.latencia_p50 != null ? seg(k.latencia_p50 / 1000) : '—'}</td>
                  <td style={{ textAlign: 'center' }}>{usd(k.costo_promedio_usd)}</td>
                  <td>{peor ? `${CATEGORIA[peor[0]] ?? peor[0]} (${peor[1]})` : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" type="button" onClick={() => onDetalle(k)}>Ver respuestas</button>
                    {k.estado === 'en_curso' && <button className="btn ghost sm" type="button" onClick={() => void detener(k)} data-testid="examen-detener">Detener</button>}
                    {k.estado !== 'en_curso' && k.corridos < k.casos && <button className="btn ghost sm" type="button" onClick={() => void continuar(k)} data-testid="examen-continuar">Continuar</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Detalle({ corrida, filas, onCerrar }: { corrida: Corrida; filas: ResultadoCaso[]; onCerrar: () => void }) {
  const [cat, setCat] = useState<string>('')
  const [soloFallas, setSoloFallas] = useState(false)
  const lista = useMemo(() => filas.filter((f) => (!cat || f.categoria === cat) && (!soloFallas || !f.aprobado)), [filas, cat, soloFallas])
  return (
    <section className="card" data-testid="examen-detalle">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{nombreModelo(corrida.modelo)} · {corrida.puntaje ?? '—'}/10</h3>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select style={input} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría"><option value="">Todas</option>{Object.entries(CATEGORIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label style={{ ...sutil, display: 'flex', gap: 6 }}><input type="checkbox" checked={soloFallas} onChange={(e) => setSoloFallas(e.target.checked)} /> Solo reprobadas</label>
          <button className="btn ghost sm" type="button" onClick={onCerrar}>Cerrar</button>
        </span>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {lista.map((f) => (
          <article key={f.caso_id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={sutil}>{f.caso_id} · {CATEGORIA[f.categoria] ?? f.categoria}{f.latencia_ms != null ? ` · ${seg(f.latencia_ms / 1000)}` : ''}</span>
              <b style={{ color: colorPuntaje(f.puntaje) }}>{f.puntaje ?? '—'}</b>
            </div>
            {f.historial?.length > 0 && <div style={{ ...sutil, marginTop: 4 }}>{f.historial.map((m) => `${m.actor === 'ai' ? 'IA' : 'Doctor'}: ${m.content}`).join(' · ')}</div>}
            <div style={{ marginTop: 6 }}><b>Doctor:</b> {f.pregunta}</div>
            <div style={{ marginTop: 4, whiteSpace: 'pre-line' }}><b>IA:</b> {f.respuesta || <i style={sutil}>{f.error ?? 'sin respuesta'}</i>}</div>
            {f.motivo_validacion && <div style={{ ...sutil, color: '#b45309' }}>El sistema rechazó un primer intento: {f.motivo_validacion}</div>}
            {f.juicio?.comentario && <div style={{ ...sutil, marginTop: 4 }}>Juez: {f.juicio.comentario}{f.juicio.falla?.length ? ` Falla: ${f.juicio.falla.join('; ')}` : ''}</div>}
            {f.ideal && <details style={{ marginTop: 4 }}><summary style={sutil}>Respuesta de referencia</summary><div style={{ fontSize: 13 }}>{f.ideal}</div></details>}
          </article>
        ))}
      </div>
    </section>
  )
}

function ModeloPortal({ cliente, config, corridas, onGuardado }: { cliente: ClienteAsesoraIa; config: ConfigIA | null; corridas: Corrida[]; onGuardado: (c: ConfigIA) => void }) {
  const [modelo, setModelo] = useState<string>('')
  const [esfuerzo, setEsfuerzo] = useState<Esfuerzo>('low')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { if (config) { setModelo(config.modelo_portal ?? ''); setEsfuerzo(config.esfuerzo_portal) } }, [config])
  const mejor = useMemo(() => [...corridas].filter((k) => k.corridos >= Math.min(k.casos, 30) && k.puntaje != null).sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0))[0], [corridas])
  const guardar = async () => {
    setOcupado(true)
    const r = await cliente.guardarConfig(modelo || null, esfuerzo)
    setOcupado(false)
    if (r.ok) onGuardado(r.data)
  }
  return (
    <section className="card" data-testid="modelo-portal">
      <h2 style={{ margin: '0 0 4px' }}>Modelo de la IA del portal</h2>
      <p style={{ margin: '0 0 10px', ...sutil }}>Hoy: <b>{nombreModelo(config?.modelo_portal)}</b>. El cambio aplica al siguiente mensaje de cualquier doctor. WhatsApp usa Claude Opus 5.5.{mejor ? ` Mejor calificado en el examen: ${nombreModelo(mejor.modelo)} (${mejor.puntaje}/10, ${usd(mejor.costo_promedio_usd)} por respuesta).` : ''}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={input} value={modelo} onChange={(e) => setModelo(e.target.value)} aria-label="Modelo del portal" data-testid="portal-modelo">
          <option value="">El de siempre (Haiku 4.5)</option>
          {MODELOS.filter((m) => m.id !== 'claude-haiku-4-5-20251001').map((m) => <option key={m.id} value={m.id}>{m.nombre} · {m.nota}</option>)}
        </select>
        <select style={input} value={esfuerzo} onChange={(e) => setEsfuerzo(e.target.value as Esfuerzo)} aria-label="Esfuerzo del portal" disabled={!modelo}>{(Object.keys(ESFUERZO) as Esfuerzo[]).map((k) => <option key={k} value={k}>{ESFUERZO[k]}</option>)}</select>
        <button className="btn" type="button" onClick={() => void guardar()} disabled={ocupado || (modelo === (config?.modelo_portal ?? '') && esfuerzo === config?.esfuerzo_portal)} data-testid="portal-guardar">Guardar</button>
      </div>
    </section>
  )
}

const TIPOS_SEG: Array<{ key: 'carrito' | 'recompra' | 'promo'; titulo: string; texto: string }> = [
  { key: 'carrito', titulo: 'Carrito sin terminar', texto: 'Dejó productos en su carrito y no lo movió en 20 h: se lo recuerda con su total y cuánto le falta para el siguiente precio.' },
  { key: 'recompra', titulo: 'Le toca volver a pedir', texto: 'Por su ritmo de compra (o el típico de la categoría) ya se le debe estar acabando: le ofrece prepararle lo de siempre con el precio de esa cantidad.' },
  { key: 'promo', titulo: 'Promoción de lo que compra', texto: 'Hay una promoción vigente de algo que ya compró: se la avisa con sus precios. No le llega a quien se dio de baja de difusiones.' },
]

// ADOPCIÓN (2 nov 2026): WhatsApp es la puerta, el portal su casa. Cuántos clientes ya tienen cuenta y la usan, y por dónde compran.
const CANALES: Array<{ key: keyof AdopcionDatos['pedidos']; titulo: string }> = [
  { key: 'whatsapp_ia', titulo: 'WhatsApp con la IA' }, { key: 'portal', titulo: 'Portal' }, { key: 'vendedor', titulo: 'Vendedor' }, { key: 'caja', titulo: 'Caja' },
]
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : '—')
function Adopcion({ cliente }: { cliente: ClienteAsesoraIa }) {
  const [d, setD] = useState<AdopcionDatos | null>(null)
  useEffect(() => { void cliente.adopcion(30).then((r) => { if (r.ok) setD(r.data) }) }, [cliente])
  if (!d) return null
  const c = d.clientes
  return (
    <section className="card" data-testid="adopcion-portal">
      <h2 style={{ margin: '0 0 4px' }}>¿Tus clientes ya usan el portal?</h2>
      <p style={{ margin: '0 0 12px', ...sutil }}>WhatsApp es la puerta y el portal su casa: al verificarlos por WhatsApp reciben su acceso, cada pedido les lleva el enlace y la IA los invita cuando viene al caso. Últimos {d.dias} días.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Cifra titulo="Con cuenta" valor={String(c.con_cuenta)} detalle={`${pct(c.con_cuenta, c.activos)} de ${c.activos} clientes`} />
        <Cifra titulo="Entraron al portal" valor={String(c.entraron)} detalle={`${pct(c.entraron, c.con_cuenta)} de los que tienen cuenta`} />
        <Cifra titulo="Con avisos activos" valor={String(c.con_avisos)} detalle="reciben notificaciones" />
        <Cifra titulo="Verificados por WhatsApp" valor={String(d.verificados_por_whatsapp)} detalle="ya con su acceso" />
        <Cifra titulo="Compraron sin cuenta" valor={String(c.compraron_sin_cuenta)} detalle="a invitar al portal" />
      </div>
      <div style={{ marginTop: 12, fontSize: 13 }} data-testid="adopcion-canales">
        <b>Pedidos por dónde llegaron:</b>{' '}
        {CANALES.map((k, i) => <span key={k.key}>{i > 0 && ' · '}{k.titulo} {d.pedidos[k.key] ?? 0}</span>)}
      </div>
    </section>
  )
}

function Seguimiento({ cliente }: { cliente: ClienteAsesoraIa }) {
  const [cfg, setCfg] = useState<ConfigSeguimiento | null>(null)
  const [res, setRes] = useState<ResumenSeguimiento>({})
  useEffect(() => {
    void cliente.seguimiento().then((r) => { if (r.ok) setCfg(r.data) })
    void cliente.resumenSeguimiento(30).then((r) => { if (r.ok) setRes(r.data ?? {}) })
  }, [cliente])
  if (!cfg) return null
  const cambiar = async (k: 'carrito' | 'recompra' | 'promo', v: boolean) => { const r = await cliente.guardarSeguimiento({ [k]: v }); if (r.ok) setCfg(r.data) }
  return (
    <section className="card" data-testid="seguimiento-ia">
      <h2 style={{ margin: '0 0 4px' }}>La IA le da seguimiento a tus clientes</h2>
      <p style={{ margin: '0 0 12px', ...sutil }}>Como lo haría el mejor asesor, sin que nadie se lo pida. Un mensaje por cliente cada {cfg.horas_entre} h y como mucho {cfg.por_semana} por semana; solo de lunes a sábado de {cfg.hora_desde} a {cfg.hora_hasta} h; nunca si un asesor lo está atendiendo (entonces solo le avisa al vendedor). Al doctor le llega notificación.</p>
      <div style={{ display: 'grid', gap: 10 }}>
        {TIPOS_SEG.map((t) => {
          const x = res[t.key]
          return (
            <label key={t.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12 }}>
              <input type="checkbox" checked={cfg[t.key]} onChange={(e) => void cambiar(t.key, e.target.checked)} data-testid={`seg-${t.key}`} style={{ marginTop: 3 }} />
              <span style={{ flex: 1 }}><b>{t.titulo}</b><span style={{ display: 'block', ...sutil }}>{t.texto}</span></span>
              <span style={{ textAlign: 'right', fontSize: 12, minWidth: 120 }} data-testid={`seg-res-${t.key}`}>
                {x ? <>{x.enviados} enviados · {x.respondieron} respondieron<br /><b>{x.con_pedido} compraron · {pesos(x.vendido)}</b></> : <span style={sutil}>aún sin envíos</span>}
              </span>
            </label>
          )
        })}
      </div>
      <div style={{ ...sutil, marginTop: 8 }}>"Compraron": pedido en los 7 días siguientes al mensaje (últimos 30 días).</div>
    </section>
  )
}
