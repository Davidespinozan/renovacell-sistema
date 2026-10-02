// W3-C · C3 — lectura de la hoja de trabajo fiscal.
//
// Carga explícita y recarga explícita: después de cada comando se vuelve a leer al
// servidor en lugar de parchear el estado local. La pantalla nunca "sabe" el
// resultado antes que la base; si un cambio invalidó una validación, eso se ve
// porque el servidor lo dice, no porque el cliente lo supuso.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  cargarRevisionFiscal, cargarEvidencia, cargarDefaults, cargarFichaFiscal, estadoDeFila,
  type FilaRevisionFiscal, type ObservacionEvidencia, type DefaultCategoria, type FichaFiscal,
} from '../ops/fiscalCatalogo'

export interface Avance { total: number; validados: number; pendientes: number; incompletos: number }

export function useRevisionFiscal() {
  const [data, setData] = useState<FilaRevisionFiscal[]>([])
  const [defaults, setDefaults] = useState<DefaultCategoria[]>([])
  const [huerfanas, setHuerfanas] = useState<ObservacionEvidencia[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [filas, defs, sin] = await Promise.all([
      cargarRevisionFiscal(), cargarDefaults(), cargarEvidencia(),
    ])
    setData(filas); setDefaults(defs); setHuerfanas(sin); setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])

  const avance = useMemo<Avance>(() => {
    let validados = 0, pendientes = 0, incompletos = 0
    for (const f of data) {
      const e = estadoDeFila(f)
      if (e === 'validado') validados++
      else if (e === 'pendiente') pendientes++
      else incompletos++
    }
    return { total: data.length, validados, pendientes, incompletos }
  }, [data])

  const categorias = useMemo(
    () => Array.from(new Set(data.map((f) => f.categoria).filter((c): c is string => !!c))).sort(),
    [data],
  )

  return { data, defaults, huerfanas, avance, categorias, loading, reload }
}

/** Evidencia histórica de UN producto. Se pide al abrir el detalle, no antes. */
export function useEvidenciaProducto(productId: string | null) {
  const [data, setData] = useState<ObservacionEvidencia[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!productId) { setData([]); return }
    let vivo = true
    setLoading(true)
    void cargarEvidencia(productId).then((r) => { if (vivo) { setData(r); setLoading(false) } })
    return () => { vivo = false }
  }, [productId])
  return { data, loading }
}

/** `fuente` y `notas` vigentes del producto abierto. */
export function useFichaFiscal(productId: string | null, version: number) {
  const [data, setData] = useState<FichaFiscal | null>(null)
  useEffect(() => {
    if (!productId) { setData(null); return }
    let vivo = true
    void cargarFichaFiscal(productId).then((r) => { if (vivo) setData(r) })
    return () => { vivo = false }
  }, [productId, version])
  return data
}
