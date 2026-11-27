// MENÚ (dueño, 17 oct 2026): "juntar pestañas innecesarias sin perder nada". Varias pantallas de Dirección se agrupan en
// UNA entrada del menú con pestañas internas; cada pestaña renderiza la pantalla existente tal cual (misma lógica, mismos
// permisos). La pestaña elegida se recuerda por grupo. Las claves originales siguen en el registro para los avisos y
// enlaces profundos (abren la pantalla sola, como antes).
import React, { useEffect, useState } from 'react'
import { registrarUso } from '../data/ops/usoPantallas'   // MEDIDOR DE USO (auditoría de UX)
import { Cargando } from './EmptyState'
import { CONTEOS_POR_GRUPO, pestanaConTrabajo, type Conteos } from './conteosPestanas'   // PESTAÑAS CON SU NÚMERO

export interface PestanaDef { key: string; label: string; render: () => React.ReactNode; conteo?: number }
const CLAVE = (grupo: string) => `rc_pestana_${grupo}`
const leer = (grupo: string): string | null => { try { return localStorage.getItem(CLAVE(grupo)) } catch { return null } }
const guardar = (grupo: string, k: string) => { try { localStorage.setItem(CLAVE(grupo), k) } catch { /* sin almacenamiento */ } }
// Pestaña pedida por un aviso/enlace profundo (resolverDestino): se consume una vez al montar el grupo.
const pedidas: Record<string, string> = {}
export function pedirPestana(grupo: string, pestana: string) { pedidas[grupo] = pestana }
const tomarPedida = (grupo: string): string | null => { const p = pedidas[grupo] ?? null; delete pedidas[grupo]; return p }

type Props = { grupo: string; pestanas: PestanaDef[]; inicial?: string }
// Los grupos con trabajo contable (Pedidos de Almacén) muestran cuántos hay en cada pestaña. El conteo es un hook, así
// que vive en su propio componente: el resto de los grupos no cargan nada extra.
export function Pestanas(props: Props) {
  const usar = CONTEOS_POR_GRUPO[props.grupo]
  return usar ? <ConConteos {...props} usar={usar} /> : <Barra {...props} />
}
function ConConteos({ usar, ...p }: Props & { usar: () => Conteos }) {
  const conteos = usar()
  return <Barra {...p} conteos={conteos} />
}

function Barra({ grupo, pestanas, inicial, conteos }: Props & { conteos?: Conteos }) {
  const [activa, setActiva] = useState<string>(() => {
    const existe = (k: string | null): k is string => !!k && pestanas.some((p) => p.key === k)
    const pedida = tomarPedida(grupo)
    if (existe(pedida)) return pedida                       // un aviso o enlace pidió ESA pestaña: manda
    const guardada = leer(grupo)
    const recordada = existe(guardada) ? guardada : null
    const conTrabajo = conteos ? pestanaConTrabajo(pestanas.map((p) => p.key), recordada, conteos) : null
    return conTrabajo ?? recordada ?? inicial ?? pestanas[0].key
  })
  const actual = pestanas.find((p) => p.key === activa) ?? pestanas[0]
  useEffect(() => { registrarUso(grupo, actual.key) }, [grupo, actual.key])
  return (
    <div className="grid" style={{ gap: 14 }} data-testid={`pestanas-${grupo}`}>
      <div className="seg seg--pestanas" role="tablist" aria-label="Secciones">
        {pestanas.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={p.key === actual.key} className={p.key === actual.key ? 'active' : undefined} data-testid={`pestana-${p.key}`}
            onClick={() => { setActiva(p.key); guardar(grupo, p.key) }}>
            {p.label}{(p.conteo ?? conteos?.[p.key]) ? <span className="seg-conteo" data-testid={`conteo-${p.key}`}>{p.conteo ?? conteos?.[p.key]}</span> : null}
          </button>
        ))}
      </div>
      {/* PERF · las pestañas cargan bajo demanda: mientras llega una, la barra de pestañas se queda. */}
      <div role="tabpanel" key={actual.key}><React.Suspense fallback={<Cargando />}>{actual.render()}</React.Suspense></div>
    </div>
  )
}
