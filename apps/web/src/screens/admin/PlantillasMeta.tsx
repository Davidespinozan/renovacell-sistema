// WA-PLANTILLAS (3 nov 2026) · Dirección: las plantillas que los vendedores usan para retomar a un cliente de WhatsApp
// fuera de las 24 h. Se dan de alta en WhatsApp Manager con el MISMO nombre y texto; cuando Meta la aprueba, se activa aquí.
import React, { useCallback, useEffect, useState } from 'react'
import { plantillasWA as plantillasPorDefecto, type PlantillaWA } from '../../data/ops/plantillasWA'

export function PlantillasMeta({ cliente = plantillasPorDefecto() }: { cliente?: ReturnType<typeof plantillasPorDefecto> }) {
  const [lista, setLista] = useState<PlantillaWA[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => { setLista(await cliente.lista()) }, [cliente])
  useEffect(() => { void cargar() }, [cargar])
  const cambiar = async (p: PlantillaWA) => {
    setError(null)
    if (!p.activa && !window.confirm(`¿Meta ya aprobó «${p.nombre}»? Si no está aprobada, los envíos van a fallar.`)) return
    const e = await cliente.activar(p.nombre, !p.activa)
    if (e) setError(e)
    await cargar()
  }
  return (
    <details className="card" style={{ padding: '10px 12px' }} data-testid="plantillas-meta" open>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Plantillas para retomar clientes ({lista?.filter((p) => p.activa).length ?? 0} activas)</summary>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '8px 0' }}>
        Fuera de las 24 horas, WhatsApp solo deja mandar mensajes aprobados. Créalas en <b>WhatsApp Manager → Plantillas de mensajes</b> con el nombre, la categoría, el idioma <b>Español (MEX)</b> y el texto exactos de abajo; cuando Meta la apruebe, actívala aquí.
      </p>
      {error && <div role="alert" className="rc-wa-err">{error}</div>}
      {lista === null ? <small>Cargando…</small> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {lista.map((p) => (
            <li key={p.nombre} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', display: 'grid', gap: 4 }} data-testid="plantilla-meta">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{p.etiqueta}</b><code>{p.nombre}</code><span className="pill p-neu">{p.categoria === 'MARKETING' ? 'Marketing' : 'Utilidad'}</span>
                <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={p.activa} onChange={() => void cambiar(p)} data-testid={`plantilla-activa-${p.nombre}`} /> Aprobada por Meta
                </label>
              </div>
              <div className="rc-wa-vista" style={{ userSelect: 'all' }}>{p.cuerpo}</div>
              {p.botones && p.botones.length > 0 && <small data-testid="plantilla-botones">Botones de respuesta rápida: {p.botones.map((b) => `«${b}»`).join(' · ')}{p.botones.includes('Detener promociones') ? ' (en Meta, el de «Detener promociones» es el botón de baja de marketing)' : ''}</small>}
              <small style={{ color: 'var(--ink-3)' }}>Variables: {p.variables.map((v, i) => `{{${i + 1}}} = ${({ cliente: 'nombre del cliente', vendedor: 'nombre del vendedor', promocion: 'nombre de la promoción', promocion_hasta: 'fecha de fin' } as Record<string, string>)[v] ?? v}`).join(' · ')}</small>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
