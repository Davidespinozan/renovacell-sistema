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

// Datos para el recuadro del correo (folio, montos, envío) y la acción principal.
interface Cuerpo { asunto: string; titulo: string; parrafos: string[]; datos: Array<[string, string]>; rastreo?: { paq: string; numero: string; url: string | null } | null }

const URL_SISTEMA = 'https://sistema.renovacell.mx/sistema'
const URL_LOGO = 'https://sistema.renovacell.mx/brand/logo.png'
/** Enlace de rastreo de la paquetería (solo las que conocemos; si no, se muestra el número sin enlace). */
export function urlRastreo(paq: string, numero: string): string | null {
  const n = encodeURIComponent(numero.trim())
  if (!n) return null
  if (/dhl/i.test(paq)) return `https://www.dhl.com/mx-es/home/rastreo.html?tracking-id=${n}&submit=1`
  return null
}

function cuerpo(p: Plantilla, d: Record<string, unknown>): Cuerpo {
  const folio = String(d.folio ?? '').trim()
  const ref = folio ? `pedido ${folio}` : 'pedido'
  const fila = (k: string, v: string): Array<[string, string]> => (v ? [[k, v]] : [])
  switch (p) {
    case 'pedido_recibido': {
      const total = dinero(d.total)
      return { asunto: `Recibimos tu ${ref}`, titulo: 'Recibimos tu pedido', parrafos: [
        'Gracias por tu pedido. En cuanto confirmemos tu pago lo preparamos para envío.',
      ], datos: [...fila('Pedido', folio), ...fila('Total', total)] }
    }
    case 'pago_recibido': {
      const monto = dinero(d.monto); const m = METODO[String(d.metodo ?? '')]
      return { asunto: `Pago recibido · ${ref}`, titulo: 'Recibimos tu pago', parrafos: [
        'Gracias. Ya estamos preparando tu pedido y te avisaremos cuando salga a entrega.',
      ], datos: [...fila('Pedido', folio), ...fila('Monto', monto), ...fila('Forma de pago', m ? m.charAt(0).toUpperCase() + m.slice(1) : '')] }
    }
    case 'pedido_enviado': {
      const paq = String(d.paqueteria ?? '').trim(); const numero = String(d.rastreo ?? '').trim()
      return { asunto: `Tu ${ref} va en camino`, titulo: 'Tu pedido va en camino', parrafos: [
        numero ? 'Tu pedido ya salió de nuestro almacén. Puedes seguirlo con el número de rastreo.' : 'Tu pedido ya salió con nuestro equipo de entregas.',
      ], datos: [...fila('Pedido', folio), ...fila('Paquetería', paq || (numero ? '' : 'Entrega directa Renovacell')), ...fila('Número de rastreo', numero)],
        rastreo: numero ? { paq, numero, url: urlRastreo(paq, numero) } : null }
    }
    case 'pedido_entregado':
      return { asunto: `Tu ${ref} fue entregado`, titulo: 'Tu pedido fue entregado', parrafos: [
        'Esperamos que todo haya llegado bien. Si algo no llegó como esperabas, responde a este correo y lo resolvemos.',
      ], datos: fila('Pedido', folio) }
    case 'pedido_cancelado':
      return { asunto: `Tu ${ref} fue cancelado`, titulo: 'Tu pedido fue cancelado', parrafos: [
        'Si ya habías pagado, nos pondremos en contacto contigo para resolver tu reembolso.',
      ], datos: fila('Pedido', folio) }
    case 'reembolso_realizado': {
      const monto = dinero(d.monto)
      return { asunto: `Reembolso realizado · ${ref}`, titulo: 'Realizamos tu reembolso', parrafos: [
        'Dependiendo de tu banco, puede tardar unos días en verse reflejado.',
      ], datos: [...fila('Pedido', folio), ...fila('Monto', monto)] }
    }
  }
}

export function esPlantilla(p: string): p is Plantilla {
  return (PLANTILLAS as readonly string[]).includes(p)
}

/** "david espinoza" → "David Espinoza" (solo si viene todo en minúsculas o todo en mayúsculas). */
export function nombreBonito(n?: string | null): string {
  const s = String(n ?? '').replace(/\s+/g, ' ').trim()
  if (!s || /@/.test(s)) return ''
  const letras = s.replace(/[^\p{L}]/gu, '')
  if (letras !== letras.toLowerCase() && letras !== letras.toUpperCase()) return s
  const part = new Set(['de', 'del', 'la', 'las', 'los', 'y'])
  return s.toLowerCase().split(' ').map((w, i) => (i > 0 && part.has(w) ? w : w.charAt(0).toLocaleUpperCase('es-MX') + w.slice(1))).join(' ')
}

export function renderizar(plantilla: string, datos: Record<string, unknown>, nombre?: string | null): Render {
  if (!esPlantilla(plantilla)) throw new Error(`PLANTILLA_DESCONOCIDA: ${plantilla}`)
  const c = cuerpo(plantilla, datos ?? {})
  const quien = nombreBonito(nombre)
  const saludo = quien ? `Hola, ${quien}:` : 'Hola:'
  const texto = [saludo, '', c.titulo + '.', ...c.parrafos, '', ...c.datos.map(([k, v]) => `${k}: ${v}`),
    ...(c.rastreo?.url ? ['', `Rastrea tu envío: ${c.rastreo.url}`] : []), '', `Ver mi pedido: ${URL_SISTEMA}`, '', 'Renovacell · Tecnologías Antiedad'].join('\n')
  const html = marcoCorreo({ asunto: c.asunto, titulo: c.titulo, saludo, parrafos: c.parrafos, datos: c.datos,
    botones: c.rastreo?.url ? [{ href: c.rastreo.url, label: 'Rastrear mi envío' }, { href: URL_SISTEMA, label: 'Ver mi pedido' }] : [{ href: URL_SISTEMA, label: 'Ver mi pedido' }],
    pie: 'Recibes este correo por un pedido que hiciste en Renovacell.' })
  return { asunto: c.asunto, texto, html }
}

/**
 * Estructura de TODOS los correos de Renovacell (avisos de pedido, invitaciones): encabezado con logo y marca, título,
 * saludo, párrafos, recuadro de datos, botones (el primero es el principal) y pie. Tablas y estilos en línea: así se ve
 * igual en Gmail, Outlook y Apple Mail. Todo el texto se escapa.
 */
export function marcoCorreo(o: { asunto: string; titulo: string; saludo: string; parrafos: string[]; datos?: Array<[string, string]>; botones: Array<{ href: string; label: string }>; nota?: string; pie: string }): string {
  const filas = (o.datos ?? []).map(([k, v]) => `<tr><td style="padding:8px 0;color:#667085;font-size:13px">${esc(k)}</td><td style="padding:8px 0;text-align:right;font-weight:600;font-size:14px;color:#111b21">${esc(v)}</td></tr>`).join('')
  const boton = (href: string, label: string, primario: boolean) => `<a href="${esc(href)}" style="display:inline-block;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;${primario ? 'background:#007311;color:#ffffff' : 'background:#ffffff;color:#005a0d;border:1px solid #cfd8d1'}">${esc(label)}</a>`
  const p = (x: string) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.55;color:#344054">${esc(x)}</p>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.asunto)}</title></head>`
    + `<body style="margin:0;padding:0;background:#f2f4f2">`
    + `<div style="display:none;max-height:0;overflow:hidden">${esc(o.parrafos[0] ?? '')}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f2;padding:24px 12px"><tr><td align="center">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`
    + `<tr><td style="background:#0a2412;padding:20px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>`
    + `<td><img src="${URL_LOGO}" width="40" height="40" alt="Renovacell" style="display:block;border-radius:50%;background:#ffffff"></td>`
    + `<td style="padding-left:12px"><div style="color:#ffffff;font-size:17px;font-weight:700">Renovacell</div><div style="color:#9fd3ab;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:600">Tecnologías Antiedad</div></td>`
    + `</tr></table></td></tr>`
    + `<tr><td style="padding:28px 28px 8px"><div style="font-size:22px;font-weight:700;color:#111b21;margin-bottom:14px">${esc(o.titulo)}</div>`
    + p(o.saludo) + o.parrafos.map(p).join('') + `</td></tr>`
    + (filas ? `<tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8f6;border-radius:12px;padding:6px 16px">${filas}</table></td></tr>` : '')
    + `<tr><td style="padding:20px 28px ${o.nota ? '8px' : '28px'}">` + o.botones.map((b, i) => boton(b.href, b.label, i === 0)).join('&nbsp;&nbsp;') + `</td></tr>`
    + (o.nota ? `<tr><td style="padding:0 28px 24px;font-size:13px;color:#667085">${esc(o.nota)}</td></tr>` : '')
    + `<tr><td style="padding:16px 28px 24px;border-top:1px solid #eef1ee;font-size:12px;line-height:1.5;color:#98a2b3">Renovacell · Tecnologías Antiedad<br>${esc(o.pie)}</td></tr>`
    + `</table></td></tr></table></body></html>`
}

/** INVITACIÓN · cliente de Odoo: crea su cuenta (queda verificada). Mismo diseño de marca que los avisos. */
export function correoInvitacion(nombre: string, enlace: string): { asunto: string; texto: string; html: string } {
  const quien = nombreBonito(nombre)
  const saludo = quien ? `Hola, ${quien}:` : 'Hola:'
  const parrafos = ['Te invitamos a crear tu cuenta en Renovacell. Como ya eres cliente, tu cuenta queda verificada: podrás ver precios, hacer pedidos y hablar con tu asesora.']
  const texto = `${saludo}\n\n${parrafos[0]}\n\nCrea tu contraseña aquí (el enlace vence en 14 días):\n${enlace}\n\nRenovacell · Tecnologías Antiedad`
  const html = marcoCorreo({ asunto: 'Tu cuenta en Renovacell', titulo: 'Tu cuenta te espera', saludo, parrafos,
    botones: [{ href: enlace, label: 'Crear mi cuenta' }], nota: 'El enlace vence en 14 días.', pie: 'Recibes este correo porque eres cliente de Renovacell.' })
  return { asunto: 'Tu cuenta en Renovacell', texto, html }
}
