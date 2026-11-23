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
const PRECISION: Record<string, string> = { calle: 'por calle', colonia: 'solo la colonia', cp: 'solo el código postal' }
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
    // DESTINO EN EL MAPA · si hay entregas vivas sin pin, se piden a OpenStreetMap (a lo más cada 2 min) y se recarga.
    let ultimaBusqueda = 0
    const cargarYUbicar = async () => {
      await cargar()
      if (!vivo || Date.now() - ultimaBusqueda < 120_000) return
      const r = await api.mapa(); if (!vivo || !r.ok) return
      if (!r.data.some((c) => c.entregas.some((e) => e.estado !== 'delivered' && !e.destino))) return
      ultimaBusqueda = Date.now()
      if (await api.geocodificar() > 0 && vivo) void cargar()
    }
    void cargarYUbicar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargarYUbicar() }, 60_000)
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
      // DESTINO EN EL MAPA · a dónde va: pin exacto (aprendido de entregas) o aproximado (OpenStreetMap), en orden de ruta.
      c.entregas.filter((e) => e.estado !== 'delivered' && e.destino).forEach((e, i) => {
        const d = e.destino!
        const aprox = d.fuente === 'osm'
        L.marker([d.lat, d.lng], { icon: icono(String(i + 1), col, 'mapa-pin-destino' + (aprox ? ' aprox' : '')) })
          .bindPopup(`<b>${e.folio ?? ''}</b> · ${ESTADO[e.estado] ?? e.estado}<br>${e.cliente}${e.direccion ? `<br>${e.direccion}` : ''}<br><i>${aprox ? `Ubicación aproximada (${PRECISION[d.precision] ?? d.precision})` : 'Ubicación exacta (de entregas anteriores)'}</i>`).addTo(g)
        puntos.push([d.lat, d.lng])
      })
      for (const e of c.entregas) if (e.lat != null && e.lng != null) {
        L.marker([e.lat, e.lng], { icon: icono(e.lejos ? '!' : '✓', e.lejos ? 'var(--danger)' : col, 'mapa-pin-entrega') }).bindPopup(`<b>${e.folio ?? ''}</b><br>${e.cliente}<br>Entregado ${e.entregado_at ? new Date(e.entregado_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}`).addTo(g)
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
        Dónde va cada chofer, por dónde ha pasado hoy y a dónde va: los números son sus entregas pendientes (pin lleno = ubicación
        exacta aprendida de entregas anteriores; punteado = aproximada). Las palomitas marcan dónde se entregó; un «!» rojo, que se
        marcó entregado lejos del destino. Se actualiza cada minuto mientras el chofer tiene su app abierta en ruta.
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
                    {e.estado !== 'delivered' && e.destino?.fuente === 'osm' && <> · <span className="mapa-aprox">destino aproximado</span></>}
                    {e.estado !== 'delivered' && !e.destino && <> · <span className="mapa-aprox">sin ubicar</span></>}
                    {e.lat != null && e.lng != null && <> · <a href={enlaceMapa(e.lat, e.lng)} target="_blank" rel="noreferrer">dónde se entregó</a></>}
                    {e.lejos && <div className="mapa-lejos" data-testid="mapa-lejos">⚠ Se marcó entregado a {e.distancia_m != null && e.distancia_m >= 1000 ? `${(e.distancia_m / 1000).toFixed(1)} km` : `${e.distancia_m ?? '?'} m`} del destino</div>}
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
