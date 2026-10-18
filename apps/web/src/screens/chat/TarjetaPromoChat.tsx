// PROMO-6 · Un mensaje del sistema que empieza con [promo:<id>] se pinta como tarjeta con fotos y precios mientras la
// promoción siga vigente para este doctor; si ya terminó (o no aplica), se ve el texto de respaldo.
import React, { useEffect, useState } from 'react'
import { TarjetaPromo } from '../../app/TarjetaPromo'
import { MARCA_PROMO, promoTarjeta, type DatosPromoDifusion } from '../../data/ops/promociones'

const cache = new Map<string, Promise<DatosPromoDifusion | null>>()
export function limpiarCachePromos() { cache.clear() }

export function TarjetaPromoChat({ content, onCatalogo, cargar = promoTarjeta }: { content: string; onCatalogo?: () => void; cargar?: typeof promoTarjeta }) {
  const id = MARCA_PROMO.exec(content)?.[1] ?? null
  const texto = content.replace(MARCA_PROMO, '')
  const [datos, setDatos] = useState<DatosPromoDifusion | null | undefined>(undefined)
  useEffect(() => {
    if (!id) { setDatos(null); return }
    let vivo = true
    if (!cache.has(id)) cache.set(id, cargar(id).catch(() => null))
    cache.get(id)!.then((d) => { if (vivo) setDatos(d) })
    return () => { vivo = false }
  }, [id, cargar])
  if (datos === undefined) return <div className="rc-sys" data-testid="msg-promo-cargando">{texto.split('\n')[0]}</div>
  if (!datos) return <div className="rc-sys" data-testid="msg-system">{texto}</div>
  return <div data-testid="msg-promo" style={{ margin: '6px 0' }}><TarjetaPromo datos={datos} onCatalogo={onCatalogo} compacta /></div>
}
