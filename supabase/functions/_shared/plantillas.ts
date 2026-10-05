// W4-05 · Plantillas de la comunicación transaccional. Vocabulario CERRADO: son los
// mismos seis hechos que la base sabe encolar. No hay plantillas de mercadotecnia.
//
// El texto se arma con la FOTO del hecho que guardó el buzón (folio, monto, rastreo),
// no con el estado actual del pedido: el correo dice lo que pasó, no lo que pasa ahora.
export const PLANTILLAS = [
  'pedido_recibido', 'pago_recibido', 'pedido_enviado', 'pedido_entregado',
  'pedido_cancelado', 'reembolso_realizado',
] as const
export type Plantilla = (typeof PLANTILLAS)[number]

export interface Render { asunto: string; texto: string; html: string }

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const dinero = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : ''
}

const METODO: Record<string, string> = {
  transferencia: 'transferencia', efectivo: 'efectivo', tarjeta: 'tarjeta', stripe: 'tarjeta',
}

function cuerpo(p: Plantilla, d: Record<string, unknown>): { asunto: string; parrafos: string[] } {
  const folio = String(d.folio ?? '').trim()
  const ref = folio ? `pedido ${folio}` : 'pedido'
  switch (p) {
    case 'pedido_recibido': {
      const total = dinero(d.total)
      return { asunto: `Recibimos tu ${ref}`, parrafos: [
        `Recibimos tu ${ref}${total ? ` por ${total}` : ''}.`,
        'En cuanto confirmemos tu pago lo preparamos para envío.',
      ] }
    }
    case 'pago_recibido': {
      const monto = dinero(d.monto); const m = METODO[String(d.metodo ?? '')]
      return { asunto: `Pago recibido · ${ref}`, parrafos: [
        `Registramos tu pago${monto ? ` de ${monto}` : ''}${m ? ` por ${m}` : ''} para tu ${ref}.`,
        'Gracias. Te avisaremos cuando tu pedido salga a entrega.',
      ] }
    }
    case 'pedido_enviado': {
      const paq = String(d.paqueteria ?? '').trim(); const rastreo = String(d.rastreo ?? '').trim()
      const linea = paq && rastreo ? `Viaja por ${paq}, con número de rastreo ${rastreo}.`
        : rastreo ? `Su número de rastreo es ${rastreo}.` : 'Lo lleva nuestro equipo de entregas.'
      return { asunto: `Tu ${ref} va en camino`, parrafos: [`Tu ${ref} ya salió.`, linea] }
    }
    case 'pedido_entregado':
      return { asunto: `Tu ${ref} fue entregado`, parrafos: [
        `Tu ${ref} fue entregado.`, 'Si algo no llegó como esperabas, responde a este correo.',
      ] }
    case 'pedido_cancelado':
      return { asunto: `Tu ${ref} fue cancelado`, parrafos: [
        `Tu ${ref} fue cancelado.`,
        'Si ya habías pagado, nos pondremos en contacto contigo para resolver tu reembolso.',
      ] }
    case 'reembolso_realizado': {
      const monto = dinero(d.monto)
      return { asunto: `Reembolso realizado · ${ref}`, parrafos: [
        `Realizamos un reembolso${monto ? ` de ${monto}` : ''} correspondiente a tu ${ref}.`,
        'Dependiendo de tu banco puede tardar unos días en verse reflejado.',
      ] }
    }
  }
}

export function esPlantilla(p: string): p is Plantilla {
  return (PLANTILLAS as readonly string[]).includes(p)
}

export function renderizar(plantilla: string, datos: Record<string, unknown>, nombre?: string | null): Render {
  if (!esPlantilla(plantilla)) throw new Error(`PLANTILLA_DESCONOCIDA: ${plantilla}`)
  const { asunto, parrafos } = cuerpo(plantilla, datos ?? {})
  const saludo = nombre && String(nombre).trim() ? `Hola, ${String(nombre).trim()}:` : 'Hola:'
  const firma = 'Renovacell'
  const texto = [saludo, '', ...parrafos, '', firma].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#1c2118">`
    + `<p>${esc(saludo)}</p>${parrafos.map((x) => `<p>${esc(x)}</p>`).join('')}<p>${esc(firma)}</p></div>`
  return { asunto, texto, html }
}
