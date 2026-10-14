// CUENTA ≠ VERIFICACIÓN (decisión del dueño, 14 oct 2026): el doctor con cuenta entra al sistema aunque su
// verificación esté pendiente. Puede conocer el catálogo, ver sus pedidos y hablar con su asesor; los PRECIOS y
// las COMPRAS se habilitan cuando Dirección (o su vendedor) aprueba la verificación. El servidor ya lo exige:
// sin verificar, `puede_ver_precio` es falso y `crear_pedido` rechaza. Esta franja solo lo explica.
import React from 'react'
import { ShieldCheck } from 'lucide-react'

export function AvisoVerificacion() {
  return (
    <div className="sysnote" role="status" data-testid="aviso-verificacion" style={{ background: 'var(--warn-bg)', borderColor: 'transparent', color: 'var(--ink)', marginBottom: 14, alignItems: 'flex-start' }}>
      <ShieldCheck size={18} style={{ color: 'var(--warn)', flex: 'none', marginTop: 1 }} />
      <span><b>Tu verificación está en revisión.</b> Ya puedes conocer el catálogo y hablar con tu asesor. Los precios y las compras se habilitan en cuanto aprobemos tu cédula; te avisaremos por aquí.</span>
    </div>
  )
}
