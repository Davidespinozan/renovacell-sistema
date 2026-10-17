// MENÚ (dueño, 17 oct 2026): "juntar pestañas innecesarias sin perder nada". Varias pantallas de Dirección se agrupan en
// UNA entrada del menú con pestañas internas; cada pestaña renderiza la pantalla existente tal cual (misma lógica, mismos
// permisos). La pestaña elegida se recuerda por grupo. Las claves originales siguen en el registro para los avisos y
// enlaces profundos (abren la pantalla sola, como antes).
import React, { useState } from 'react'

export interface PestanaDef { key: string; label: string; render: () => React.ReactNode; conteo?: number }
const CLAVE = (grupo: string) => `rc_pestana_${grupo}`
const leer = (grupo: string): string | null => { try { return localStorage.getItem(CLAVE(grupo)) } catch { return null } }
const guardar = (grupo: string, k: string) => { try { localStorage.setItem(CLAVE(grupo), k) } catch { /* sin almacenamiento */ } }
// Pestaña pedida por un aviso/enlace profundo (resolverDestino): se consume una vez al montar el grupo.
const pedidas: Record<string, string> = {}
export function pedirPestana(grupo: string, pestana: string) { pedidas[grupo] = pestana }
const tomarPedida = (grupo: string): string | null => { const p = pedidas[grupo] ?? null; delete pedidas[grupo]; return p }

export function Pestanas({ grupo, pestanas, inicial }: { grupo: string; pestanas: PestanaDef[]; inicial?: string }) {
  const [activa, setActiva] = useState<string>(() => { const r = tomarPedida(grupo) ?? leer(grupo); return pestanas.some((p) => p.key === r) ? (r as string) : inicial ?? pestanas[0].key })
  const actual = pestanas.find((p) => p.key === activa) ?? pestanas[0]
  return (
    <div className="grid" style={{ gap: 14 }} data-testid={`pestanas-${grupo}`}>
      <div className="seg" role="tablist" aria-label="Secciones" style={{ flexWrap: 'wrap' }}>
        {pestanas.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={p.key === actual.key} className={p.key === actual.key ? 'active' : undefined} data-testid={`pestana-${p.key}`}
            onClick={() => { setActiva(p.key); guardar(grupo, p.key) }}>
            {p.label}{p.conteo ? <span className="pill p-warn" style={{ marginLeft: 6 }}>{p.conteo}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" key={actual.key}>{actual.render()}</div>
    </div>
  )
}
