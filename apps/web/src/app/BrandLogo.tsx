// LOGO DE LA MARCA, en un solo lugar.
//
// Estaba escrito a mano en siete pantallas apuntando a /brand/logo.png, y
// además incrustado dos veces en base64 dentro de la landing. Eran copias
// distintas del mismo logo, y ninguna cambiaba al subir uno nuevo desde
// Administración. Ahora todas pasan por aquí: si Dirección sube un logo, manda
// ese; si no, el archivo del repositorio.
import React from 'react'
import { useLanding } from '../data/hooks/useLanding'

export const LOGO_FALLBACK = '/brand/logo.png'

export function useBrandLogo(): string {
  const { data } = useLanding()
  return data?.brand?.logoUrl?.trim() || LOGO_FALLBACK
}

export function BrandLogo({ alt = 'Renovacell', style, className }: {
  alt?: string
  style?: React.CSSProperties
  className?: string
}) {
  return <img src={useBrandLogo()} alt={alt} style={style} className={className} />
}
