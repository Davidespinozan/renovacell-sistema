// CHOFERES EN RUTA (21 nov 2026, dueño: «ver en tiempo real al chofer cuando entrega»). Mapa OpenStreetMap (sin Google):
// última ubicación de cada chofer, su recorrido de hoy y sus entregas (las entregadas, en el punto donde se marcaron).
// Se actualiza cada minuto. La ubicación llega solo mientras el chofer está en ruta con la app abierta.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PageHead } from '../../app/PageHead'
import { Vacio } from '../../app/EmptyState'
import { ubicacionChofer, enlaceMapa, type ChoferMapa } from '../../data/ops/ubicacionChofer'

const api = ubicacionChofer()
const CULIACAN: [number, number] = [24.8091, -107.394]
const COLORES = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2']   // líneas del recorrido (datos del mapa, no tema)
const ESTADO: Record<string, string> = { despachado: 'Por salir', out_for_delivery: 'En camino', incident: 'Con incidencia', delivered: 'Entregado' }

function hace(iso?: string): string {
  if (!iso) return ''
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  return `hace ${h} h ${min % 60} min`
}

function icono(texto: string, color: string, clase = ''): L.DivIcon {
  return L.divIcon({ className: 'mapa-pin-wrap', html: `<div class="mapa-pin ${clase}" style="background:${color}">${texto}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] })
}

export function MapaChoferes() {
  const [lista, setLista] = useState<ChoferMapa[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const div = useRef<HTMLDivElement | null>(null)
  const mapa = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    let vivo = true
    const cargar = async () => { const r = await api.mapa(); if (!vivo) return; if (r.ok) { setLista(r.data); setError(null) } else setError(r.error) }
    void cargar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, 60_000)
    return () => { vivo = false; clearInterval(t) }
  }, [])

  useEffect(() => {
    if (!div.current || mapa.current) return
    const m = L.map(div.current, { zoomControl: true }).setView(CULIACAN, 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m)
    capa.current = L.layerGroup().addTo(m)
    mapa.current = m
    return () => { m.remove(); mapa.current = null }
  }, [])

  const color = useMemo(() => { const c: Record<string, string> = {}; (lista ?? []).forEach((x, i) => { c[x.driver_id] = COLORES[i % COLORES.length] }); return c }, [lista])

  useEffect(() => {
    const m = mapa.current, g = capa.current
    if (!m || !g || !lista) return
    g.clearLayers()
    const puntos: L.LatLngExpression[] = []
    for (const c of lista) {
      if (sel && sel !== c.driver_id) continue
      const col = color[c.driver_id]
      if (c.recorrido.length > 1) L.polyline(c.recorrido, { color: col, weight: 4, opacity: 0.6 }).addTo(g)
      for (const e of c.entregas) if (e.lat != null && e.lng != null) {
        L.marker([e.lat, e.lng], { icon: icono('✓', col, 'mapa-pin-entrega') }).bindPopup(`<b>${e.folio ?? ''}</b><br>${e.cliente}<br>Entregado ${e.entregado_at ? new Date(e.entregado_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}`).addTo(g)
        puntos.push([e.lat, e.lng])
      }
      if (c.ultima) {
        const ini = c.nombre.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
        L.marker([c.ultima.lat, c.ultima.lng], { icon: icono(ini, col, 'mapa-pin-chofer') }).bindPopup(`<b>${c.nombre}</b><br>${hace(c.ultima.at)}`).addTo(g)
        puntos.push([c.ultima.lat, c.ultima.lng])
      }
    }
    if (puntos.length === 1) m.setView(puntos[0], 15)
    else if (puntos.length > 1) m.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 16 })
  }, [lista, sel, color])

  return (
    <div className="grid" style={{ gap: 12 }}>
      <PageHead title="Choferes en ruta">
        Dónde va cada chofer y por dónde ha pasado hoy. Se actualiza cada minuto mientras el chofer tiene su app abierta en ruta;
        las palomitas marcan dónde se entregó cada pedido.
      </PageHead>
      {error && <div className="card">{error}</div>}
      <div className="mapa-choferes-wrap">
        <div ref={div} className="mapa-choferes" data-testid="mapa-choferes" />
        <div className="mapa-lista card">
          {lista && lista.length === 0 && <Vacio plano icono="truck" titulo="No hay choferes activos" />}
          {(lista ?? []).map((c) => {
            const pendientes = c.entregas.filter((e) => e.estado !== 'delivered').length
            const hechas = c.entregas.length - pendientes
            const viejo = c.ultima?.at ? Date.now() - new Date(c.ultima.at).getTime() > 10 * 60_000 : true
            return (
              <div key={c.driver_id} className={'mapa-chofer' + (sel === c.driver_id ? ' activo' : '')}>
                <button type="button" className="mapa-chofer-cab" onClick={() => setSel(sel === c.driver_id ? null : c.driver_id)}>
                  <span className="mapa-punto" style={{ background: color[c.driver_id] }} />
                  <span className="nm">{c.nombre}</span>
                  <span className={'pill ' + (!c.ultima ? 'p-neu' : viejo ? 'p-warn' : 'p-ok')}>{!c.ultima ? 'Sin ubicación hoy' : hace(c.ultima.at)}</span>
                </button>
                <div className="lt">{pendientes} por entregar · {hechas} entregadas hoy</div>
                {sel === c.driver_id && c.entregas.map((e) => (
                  <div key={e.shipment_id} className="mapa-entrega">
                    <span className="mono">{e.folio}</span> · {e.cliente} · <b>{ESTADO[e.estado] ?? e.estado}</b>
                    {e.lat != null && e.lng != null && <> · <a href={enlaceMapa(e.lat, e.lng)} target="_blank" rel="noreferrer">dónde se entregó</a></>}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
