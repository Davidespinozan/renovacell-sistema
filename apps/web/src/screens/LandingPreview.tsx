// Previsualización de la landing PÚBLICA dentro del sistema (dev). La landing es
// anónima (sin login); aquí solo se muestra en un iframe servido desde
// /landing/index.html (copia espejo en apps/web/public/landing).
import React from 'react'

export function LandingPreview() {
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--hueso)' }}>
      <iframe
        src="/landing/index.html"
        title="Landing pública Renovacell"
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
      />
    </div>
  )
}
