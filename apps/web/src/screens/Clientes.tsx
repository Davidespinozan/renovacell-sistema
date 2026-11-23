// CLIENTES (Ventas) = MISMA población comercial que Admin "Doctores" (customers). El vendedor
// consulta TODO el directorio por defecto ("Todos") y puede filtrar a "Mi cartera" (por seller_name).
// Read-only para pos (sin update/delete/reasignación). La lógica vive en CustomerDirectory (compartida).
// DEUDA TÉCNICA: "Mi cartera" usa seller_name (matching por nombre, frágil). El ownership futuro
// debería basarse en un id estable de vendedor (seller/profile id), no en comparación de nombres.
import { CustomerDirectory } from '../app/CustomerDirectory'
import { PorVerificar } from './PorVerificar'   // AVISO-VERIF · los que mandaron su verificación
import { ClasificarCartera } from './ClasificarCartera'   // HERRAMIENTAS DEL VENDEDOR · doctor/clínica y especialidad
import { useState } from 'react'
import { Prospectar } from './pos/Prospectar'   // NUEVO CLIENTE (alta completa) → y su primer WhatsApp

export function Clientes() {
  const [registrando, setRegistrando] = useState(false)
  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* NUEVO PROSPECTO · registrar a alguien que la vendedora consiguió por su cuenta */}
      {/* PROSPECTAR (23 nov 2026) · mismo flujo que en Inicio: registrar y mandarle su primer WhatsApp en un paso */}
      <div className="card prospecto-card">
        <button type="button" className="btn" onClick={() => setRegistrando(true)} data-testid="clientes-nuevo-prospecto">＋ Nuevo cliente</button>
        <Prospectar abierto={registrando} onCerrar={() => setRegistrando(false)} />
      </div>
      <PorVerificar />
      <CustomerDirectory title="Clientes" scope="all" carteraToggle />
      {/* UX MODERNO · la herramienta de clasificar va después de la lista (antes estorbaba arriba) */}
      <ClasificarCartera />
    </div>
  )
}
