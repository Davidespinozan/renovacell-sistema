// Avatar reutilizable: muestra la FOTO del usuario si existe (URL de Storage), o
// las iniciales con color determinista si no. Se usa en Equipo, Doctores, Chat, etc.
import React from 'react'
import { initials, avatarColor } from '../lib/format'

export function UserAvatar({ name, url, size = 40, className = 'avatar' }: {
  name: string
  url?: string | null
  size?: number
  className?: string
}) {
  if (url) {
    return <img className={className} src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />
  }
  return (
    <div className={className} style={{ width: size, height: size, background: avatarColor(name), fontSize: Math.round(size * 0.36) }}>
      {initials(name)}
    </div>
  )
}
