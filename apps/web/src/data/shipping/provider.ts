// ============================================================================
// Proveedor de ENVÍOS — frontera intercambiable (UI-first, mock).
//
// HOY: un mock que responde EXACTAMENTE con la forma de un agregador real
// (Skydropx / Envia.com): cotiza tarifas de varias paqueterías y genera la guía
// + etiqueta. Las funciones son async (devuelven Promesas) como la API real.
//
// MAÑANA (fase Supabase): se reemplaza el CUERPO de quoteRates/generateLabel por
// un fetch a una Edge Function que llama al agregador con las llaves PROTEGIDAS
// en el servidor (nunca en el navegador). La firma no cambia → la pantalla de
// Empaque queda igual. Eso es lo único que hay que tocar para volverlo real.
// ============================================================================

export interface ShipAddress {
  name: string
  street: string
  city: string
  state: string
  zip: string
  phone: string
}

export interface Parcel {
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
}

export interface RateQuote {
  id: string
  carrier: string   // 'Estafeta' | 'DHL' | ...
  service: string   // 'Terrestre' | 'Día siguiente' | ...
  amount: number    // MXN
  currency: string
  etaDays: number
}

export interface LabelResult {
  carrier: string
  service: string
  tracking: string
  labelUrl: string  // PDF/etiqueta para imprimir (mock: blob HTML imprimible)
  amount: number
  etaDays: number
  estimatedDeliveryAt: string // ISO
}

export interface ShipmentRequest {
  origin: ShipAddress
  destination: ShipAddress
  parcel: Parcel
  orderRef: string
}

// Dirección ORIGEN de la empresa (bodega). En producción vendrá de la config de
// la organización (Supabase). El destino sale del perfil del doctor / pedido.
export const ORIGIN: ShipAddress = {
  name: 'Renovacell · Bodega Culiacán',
  street: 'Blvd. Pedro Infante 2900, Desarrollo Urbano Tres Ríos',
  city: 'Culiacán',
  state: 'Sinaloa',
  zip: '80020',
  phone: '667 100 2000',
}

// Hash determinista → para tracking/precios estables del mock (sin Math.random,
// que rompe el render y los snapshots).
function seedFrom(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// COTIZAR: devuelve las tarifas disponibles para el paquete (mock realista).
export async function quoteRates(req: ShipmentRequest): Promise<RateQuote[]> {
  await wait(650) // simula latencia de red del agregador
  const w = Math.max(0.5, req.parcel.weightKg)
  const volKg = (req.parcel.lengthCm * req.parcel.widthCm * req.parcel.heightCm) / 5000 // peso volumétrico
  const billable = Math.max(w, volKg)
  const base = 95 + billable * 28
  return [
    { id: 'estafeta-terrestre', carrier: 'Estafeta', service: 'Terrestre', amount: Math.round(base), currency: 'MXN', etaDays: 4 },
    { id: 'estafeta-dia-sig', carrier: 'Estafeta', service: 'Día siguiente', amount: Math.round(base * 1.7), currency: 'MXN', etaDays: 1 },
    { id: 'dhl-express', carrier: 'DHL', service: 'Express', amount: Math.round(base * 1.55), currency: 'MXN', etaDays: 2 },
  ]
}

// GENERAR GUÍA: confirma la tarifa elegida y devuelve número de rastreo + etiqueta.
export async function generateLabel(rate: RateQuote, req: ShipmentRequest): Promise<LabelResult> {
  await wait(900) // simula la generación de guía en el agregador
  const seed = seedFrom(`${req.orderRef}-${rate.id}`)
  const prefix = rate.carrier === 'DHL' ? 'JJD' : 'ESF'
  const tracking = `${prefix}${(seed % 1_000_000_000).toString().padStart(10, '0')}`
  const eta = new Date(Date.now() + rate.etaDays * 86_400_000).toISOString()
  const labelUrl = buildLabelBlob({ rate, req, tracking, eta })
  return {
    carrier: rate.carrier,
    service: rate.service,
    tracking,
    labelUrl,
    amount: rate.amount,
    etaDays: rate.etaDays,
    estimatedDeliveryAt: eta,
  }
}

// Etiqueta imprimible (mock): genera un HTML simple como blob para abrir/imprimir.
// En producción esto será el PDF que devuelve el agregador.
function buildLabelBlob({ rate, req, tracking, eta }: { rate: RateQuote; req: ShipmentRequest; tracking: string; eta: string }): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Guía ${tracking}</title>
<style>body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#111}
.lbl{border:2px solid #111;border-radius:8px;max-width:420px;margin:0 auto}
.hd{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:2px solid #111}
.hd b{font-size:20px}.svc{font-size:12px;font-weight:700;text-transform:uppercase}
.sec{padding:12px 16px;border-bottom:1px dashed #999;font-size:13px;line-height:1.4}
.k{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#666;font-weight:700}
.trk{font-family:monospace;font-size:22px;font-weight:700;text-align:center;padding:14px}
.bars{height:54px;background:repeating-linear-gradient(90deg,#111 0,#111 3px,#fff 3px,#fff 6px);margin:0 16px 14px}
@media print{button{display:none}}</style></head>
<body><div class="lbl">
<div class="hd"><b>${rate.carrier}</b><span class="svc">${rate.service} · ${rate.etaDays} día(s)</span></div>
<div class="sec"><div class="k">Remitente</div>${req.origin.name}<br>${req.origin.street}<br>${req.origin.city}, ${req.origin.state} ${req.origin.zip}</div>
<div class="sec"><div class="k">Destinatario</div><b>${req.destination.name}</b><br>${req.destination.street}<br>${req.destination.city}, ${req.destination.state} ${req.destination.zip}<br>Tel: ${req.destination.phone}</div>
<div class="sec"><div class="k">Pedido</div>${req.orderRef} · ${req.parcel.weightKg} kg · ${req.parcel.lengthCm}×${req.parcel.widthCm}×${req.parcel.heightCm} cm</div>
<div class="trk">${tracking}</div><div class="bars"></div>
<div class="sec" style="text-align:center;border:none"><div class="k">Entrega estimada</div>${new Date(eta).toLocaleDateString('es-MX')}</div>
</div>
<p style="text-align:center;margin-top:16px"><button onclick="window.print()">Imprimir etiqueta</button></p>
<p style="text-align:center;color:#999;font-size:11px">Etiqueta de demostración (mock). En producción será el PDF real de la paquetería.</p>
</body></html>`
  return URL.createObjectURL(new Blob([html], { type: 'text/html' }))
}

// Link público de rastreo de la paquetería (para el doctor / seguimiento).
export function trackingUrl(carrier: string | null, tracking: string | null): string | null {
  if (!tracking) return null
  if (carrier === 'DHL') return `https://www.dhl.com/mx-es/home/rastreo.html?tracking-id=${tracking}`
  if (carrier === 'Estafeta') return `https://www.estafeta.com/Herramientas/Rastreo?guias=${tracking}`
  return null
}
