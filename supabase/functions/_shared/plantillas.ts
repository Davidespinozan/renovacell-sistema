// W4-05 · Plantillas de la comunicación transaccional. Vocabulario CERRADO: son los
// mismos seis hechos que la base sabe encolar. No hay plantillas de mercadotecnia.
//
// El texto se arma con la FOTO del hecho que guardó el buzón (folio, monto, rastreo),
// no con el estado actual del pedido: el correo dice lo que pasó, no lo que pasa ahora.
export const PLANTILLAS = [
  'pedido_recibido', 'pago_recibido', 'pedido_enviado', 'pedido_entregado',
  'pedido_cancelado', 'reembolso_realizado',
  'registro_recibido', 'cuenta_verificada', 'verificacion_rechazada',   // CORREOS-AUTO (165) · su cuenta
  'promocion',   // PROMO-4 (175) · difusión de una promoción a los doctores
  'cotizacion',  // COTIZACIONES (20270209) · cotización que el vendedor le manda a su cliente
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
interface Cuerpo { asunto: string; titulo: string; parrafos: string[]; datos: Array<[string, string]>; rastreo?: { paq: string; numero: string; url: string | null } | null
  boton?: { label: string; href: string }; pie?: string }

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
      // Recoge en sucursal: el mismo hecho (sale del almacén) para el cliente es "ya puedes pasar por él".
      if (String(d.metodo ?? '') === 'recoge') {
        return { asunto: `Tu ${ref} está listo para recoger`, titulo: 'Tu pedido está listo para recoger', parrafos: [
          'Ya puedes pasar por tu pedido a nuestra sucursal. Si alguien más lo recoge por ti, que mencione el número de pedido.',
        ], datos: fila('Pedido', folio), rastreo: null }
      }
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
    case 'registro_recibido':
      return { asunto: 'Recibimos tu registro en Renovacell', titulo: 'Recibimos tu registro', parrafos: [
        'Gracias por registrarte. Estamos revisando tu cédula profesional y tu identificación; normalmente lo resolvemos el mismo día hábil.',
        'Mientras tanto ya puedes entrar, conocer el catálogo y hablar con nuestro equipo comercial. Te avisaremos por este medio en cuanto tu cuenta quede verificada.',
      ], datos: [], boton: { label: 'Entrar a Renovacell', href: URL_SISTEMA }, pie: 'Recibes este correo porque creaste una cuenta en Renovacell.' }
    case 'promocion': {   // PROMO-4 · datos: nombre, vigencia, lineas[] (texto por producto), promocion_id
      const lineas = Array.isArray(d.lineas) ? (d.lineas as unknown[]).map((x) => String(x ?? '')).filter(Boolean) : []
      const nombre = String(d.nombre ?? 'Promoción').trim(); const vig = String(d.vigencia ?? '').trim()
      return { asunto: `${nombre}${vig ? ' · ' + vig : ''}`, titulo: nombre, parrafos: [
        `Tenemos una promoción para ti${vig ? ' ' + vig : ''}. Los precios se aplican solos en tu portal al hacer tu pedido; no necesitas códigos.`,
      ], datos: lineas.map((l): [string, string] => { const i = l.indexOf(': '); return i > 0 ? [l.slice(0, i), l.slice(i + 2)] : [l, ''] }),
        boton: { label: 'Ver el catálogo', href: URL_SISTEMA }, pie: 'Precios para profesionales de la salud verificados. Recibes este correo por tu cuenta en Renovacell.' }
    }
    case 'cotizacion': {   // datos: folio, total, vigente_hasta, notas, vendedor, lineas[{nombre, qty, unit_price, subtotal}]
      const lineas = Array.isArray(d.lineas) ? (d.lineas as Array<Record<string, unknown>>) : []
      const vence = d.vigente_hasta ? new Date(String(d.vigente_hasta)).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'America/Mazatlan' }) : ''
      const vend = String(d.vendedor ?? '').trim(); const notas = String(d.notas ?? '').trim()
      return { asunto: `Tu cotización ${folio || ''} de Renovacell`.replace(/\s+/g, ' ').trim(), titulo: 'Tu cotización', parrafos: [
        `${vend ? vend + ' te preparó' : 'Te preparamos'} esta cotización${vence ? `, vigente hasta el ${vence}` : ''}.`,
        'Para confirmar tu pedido, responde a este correo o escríbele a tu asesor por WhatsApp.',
        ...(notas ? [notas] : []),
      ], datos: [...lineas.map((l): [string, string] => [`${Number(l.qty ?? 0)} × ${String(l.nombre ?? '')}`, dinero(l.subtotal)]), ...fila('Total', dinero(d.total)), ...fila('Cotización', folio)],
        boton: { label: 'Entrar a Renovacell', href: URL_SISTEMA }, pie: 'Precios para profesionales de la salud. El envío se confirma al hacer el pedido.' }
    }
    case 'cuenta_verificada':
      return { asunto: 'Tu cuenta Renovacell está verificada', titulo: 'Tu cuenta está verificada', parrafos: [
        'Listo: revisamos tus datos y tu cuenta quedó verificada.',
        'Ya puedes ver precios, hacer tus pedidos y dar seguimiento a tus envíos desde Renovacell.',
      ], datos: [], boton: { label: 'Ver el catálogo', href: URL_SISTEMA }, pie: 'Recibes este correo por tu cuenta en Renovacell.' }
    case 'verificacion_rechazada': {
      const motivo = String(d.motivo ?? '').trim()
      return { asunto: 'Necesitamos un dato más para verificar tu cuenta', titulo: 'Tu verificación necesita una corrección', parrafos: [
        'Revisamos tus datos pero todavía no pudimos verificar tu cuenta.',
        'Corrígelo en "Mi verificación" y lo revisamos de nuevo. Si tienes dudas, responde a este correo.',
      ], datos: motivo ? [['Motivo', motivo]] : [], boton: { label: 'Corregir mis datos', href: URL_SISTEMA }, pie: 'Recibes este correo por tu cuenta en Renovacell.' }
    }
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
  if (plantilla === 'promocion') return correoPromocion(datos ?? {}, nombre)   // PROMO-6 · diseño propio (fotos y precios)
  const c = cuerpo(plantilla, datos ?? {})
  const quien = nombreBonito(nombre)
  const saludo = quien ? `Hola, ${quien}:` : 'Hola:'
  const texto = [saludo, '', c.titulo + '.', ...c.parrafos, '', ...c.datos.map(([k, v]) => `${k}: ${v}`),
    ...(c.rastreo?.url ? ['', `Rastrea tu envío: ${c.rastreo.url}`] : []), '', c.boton ? `${c.boton.label}: ${c.boton.href}` : `Ver mi pedido: ${URL_SISTEMA}`, '', 'Renovacell · Tecnologías Antiedad'].join('\n')
  const html = marcoCorreo({ asunto: c.asunto, titulo: c.titulo, saludo, parrafos: c.parrafos, datos: c.datos,
    botones: c.boton ? [c.boton] : c.rastreo?.url ? [{ href: c.rastreo.url, label: 'Rastrear mi envío' }, { href: URL_SISTEMA, label: 'Ver mi pedido' }] : [{ href: URL_SISTEMA, label: 'Ver mi pedido' }],
    pie: c.pie ?? 'Recibes este correo por un pedido que hiciste en Renovacell.' })
  return { asunto: c.asunto, texto, html }
}

// ── PROMO-6 · correo de PROMOCIÓN: portada con nombre y vigencia, una tarjeta por producto (foto, precio normal tachado,
//    precio promo grande, escalones por cantidad) y botón al portal. Mismo encabezado y pie de marca que los avisos.
export interface ProductoPromoCorreo { nombre: string; imagen_url?: string | null; presentacion?: string | null; precio_normal?: number | null; escalones: Array<{ desde: number; precio: number }> }
export interface DatosPromoCorreo { nombre?: string; descripcion?: string | null; vigencia?: string; hasta?: string; productos?: ProductoPromoCorreo[]; lineas?: string[]; flyer_url?: string | null }
const dineroEntero = (v: unknown): string => { const n = Number(v); return Number.isFinite(n) ? '$' + Math.round(n).toLocaleString('es-MX') : '' }
export function correoPromocion(datos: Record<string, unknown>, nombre?: string | null): Render {
  const d = datos as DatosPromoCorreo
  const promo = String(d.nombre ?? 'Promoción').trim() || 'Promoción'; const vig = String(d.vigencia ?? '').trim(); const desc = String(d.descripcion ?? '').trim()
  const productos: ProductoPromoCorreo[] = Array.isArray(d.productos) ? d.productos.filter((x) => x && typeof x === 'object' && x.nombre) : []
  const quien = nombreBonito(nombre); const saludo = quien ? `Hola, ${quien}:` : 'Hola:'
  const flyer = typeof d.flyer_url === 'string' && /^https:\/\//.test(d.flyer_url) ? d.flyer_url : null
  const asunto = `${promo}${vig ? ' · ' + vig : ''}`
  const intro = `Tenemos una promoción para ti${vig ? ' ' + vig : ''}. Los precios se aplican solos en tu portal al hacer tu pedido; sin códigos ni cupones.`
  const escalonesTexto = (p: ProductoPromoCorreo) => p.escalones.map((e) => `${e.desde > 1 ? `desde ${e.desde} pzas ` : ''}${dineroEntero(e.precio)}`).join(' · ')
  const lineasTexto = productos.length ? productos.map((p) => `${p.nombre}: ${escalonesTexto(p)}${p.precio_normal != null ? ` (antes ${dineroEntero(p.precio_normal)})` : ''}`)
    : Array.isArray(d.lineas) ? d.lineas.map((x) => String(x)) : []
  const texto = [saludo, '', `${promo}${vig ? ' · ' + vig : ''}`, intro, '', ...lineasTexto, '', `Ver el catálogo: ${URL_SISTEMA}`, '', 'Precios para profesionales de la salud verificados.', 'Renovacell · Tecnologías Antiedad'].join('\n')
  const tarjeta = (p: ProductoPromoCorreo) => {
    const base = p.escalones[0]; const resto = p.escalones.slice(1)
    const img = p.imagen_url ? `<td width="96" valign="top" style="padding-right:14px"><img src="${esc(p.imagen_url)}" width="96" height="96" alt="${esc(p.nombre)}" style="display:block;width:96px;height:96px;object-fit:contain;border-radius:12px;background:#f6f8f6"></td>` : ''
    return `<tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6ebe7;border-radius:14px;padding:14px 16px"><tr>${img}<td valign="top">`
      + `<div style="font-size:16px;font-weight:700;color:#111b21">${esc(p.nombre)}</div>${p.presentacion ? `<div style="font-size:12px;color:#667085;margin-top:2px">${esc(p.presentacion)}</div>` : ''}`
      + `<div style="margin-top:8px">${p.precio_normal != null && base && Number(p.precio_normal) > Number(base.precio) ? `<span style="font-size:13px;color:#98a2b3;text-decoration:line-through;margin-right:8px">${dineroEntero(p.precio_normal)}</span>` : ''}`
      + `<span style="font-size:22px;font-weight:800;color:#007311">${base ? dineroEntero(base.precio) : ''}</span>${base && base.desde > 1 ? `<span style="font-size:12px;color:#667085"> desde ${base.desde} pzas</span>` : ''}</div>`
      + (resto.length ? `<div style="font-size:12.5px;color:#344054;margin-top:6px">${resto.map((e) => `Desde ${e.desde} pzas: <b>${dineroEntero(e.precio)}</b>`).join(' &nbsp;·&nbsp; ')}</div>` : '')
      + `</td></tr></table></td></tr>`
  }
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(asunto)}</title></head>`
    + `<body style="margin:0;padding:0;background:#f2f4f2"><div style="display:none;max-height:0;overflow:hidden">${esc(intro)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f2;padding:24px 12px"><tr><td align="center">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`
    + `<tr><td style="background:#0a2412;padding:20px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>`
    + `<td><img src="${URL_LOGO}" width="40" height="40" alt="Renovacell" style="display:block;border-radius:50%;background:#ffffff"></td>`
    + `<td style="padding-left:12px"><div style="color:#ffffff;font-size:17px;font-weight:700">Renovacell</div><div style="color:#9fd3ab;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:600">Tecnologías Antiedad</div></td>`
    + `</tr></table></td></tr>`
    + `<tr><td style="background:linear-gradient(135deg,#0f3d1d,#007311);padding:26px 28px"><div style="display:inline-block;background:#ffffff;color:#005a0d;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:5px 10px;border-radius:999px">Promoción</div>`
    + `<div style="font-size:26px;font-weight:800;color:#ffffff;margin-top:10px;line-height:1.2">${esc(promo)}</div>${vig ? `<div style="font-size:14px;color:#d7f0dc;margin-top:6px">Válida ${esc(vig)}</div>` : ''}</td></tr>`
    // PROMO-9 · el flyer de la promoción (pieza vertical), completo y centrado; el enlace lleva al portal
    + (flyer ? `<tr><td align="center" style="background:#0a2412;padding:0 0 18px"><a href="${URL_SISTEMA}" style="display:inline-block"><img src="${esc(flyer)}" width="360" alt="${esc(promo)}" style="display:block;width:100%;max-width:360px;height:auto;border-radius:12px"></a></td></tr>` : '')
    + `<tr><td style="padding:22px 28px 6px"><p style="margin:0 0 6px;font-size:15px;line-height:1.55;color:#344054">${esc(saludo)}</p><p style="margin:0;font-size:15px;line-height:1.55;color:#344054">${esc(intro)}</p>${desc ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:#667085">${esc(desc)}</p>` : ''}</td></tr>`
    + productos.map(tarjeta).join('')
    + `<tr><td style="padding:18px 28px 8px"><a href="${URL_SISTEMA}" style="display:inline-block;padding:13px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px;background:#007311;color:#ffffff">Ver el catálogo y pedir</a></td></tr>`
    + `<tr><td style="padding:4px 28px 22px;font-size:12.5px;color:#667085">Los precios se aplican solos al hacer tu pedido${vig ? ' ' + esc(vig) : ''}. Precios para profesionales de la salud verificados.</td></tr>`
    + `<tr><td style="padding:16px 28px 24px;border-top:1px solid #eef1ee;font-size:12px;line-height:1.5;color:#98a2b3">Renovacell · Tecnologías Antiedad<br>Recibes este correo por tu cuenta en Renovacell.</td></tr>`
    + `</table></td></tr></table></body></html>`
  return { asunto, texto, html }
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
  const parrafos = ['Te invitamos a crear tu cuenta en Renovacell. Como ya eres cliente, tu cuenta queda verificada: podrás ver precios, hacer pedidos y hablar con nuestro equipo comercial.']
  const texto = `${saludo}\n\n${parrafos[0]}\n\nCrea tu contraseña aquí (el enlace vence en 14 días):\n${enlace}\n\nRenovacell · Tecnologías Antiedad`
  const html = marcoCorreo({ asunto: 'Tu cuenta en Renovacell', titulo: 'Tu cuenta te espera', saludo, parrafos,
    botones: [{ href: enlace, label: 'Crear mi cuenta' }], nota: 'El enlace vence en 14 días.', pie: 'Recibes este correo porque eres cliente de Renovacell.' })
  return { asunto: 'Tu cuenta en Renovacell', texto, html }
}

/**
 * CORREOS DE SUPABASE AUTH (recuperar contraseña, invitación, cambio de correo) con el MISMO diseño de marca. Supabase
 * los envía con sus plantillas (Authentication → Emails → Templates); estas se pegan ahí. {{ .ConfirmationURL }} lo
 * llena Supabase. Generadas en supabase/templates/auth/ (ver auth-templates.test.ts).
 */
export const PLANTILLAS_AUTH: Record<string, { asunto: string; html: string }> = {
  recovery: { asunto: 'Restablece tu contraseña de Renovacell', html: marcoCorreo({ asunto: 'Restablece tu contraseña de Renovacell', titulo: 'Restablece tu contraseña', saludo: 'Hola:',
    parrafos: ['Recibimos una solicitud para cambiar la contraseña de tu cuenta Renovacell. Toca el botón para elegir una nueva.', 'Si tú no lo pediste, ignora este correo: tu contraseña no cambia.'],
    botones: [{ href: '{{ .ConfirmationURL }}', label: 'Elegir nueva contraseña' }], nota: 'Por seguridad, el enlace vence en una hora.', pie: 'Recibes este correo porque se pidió restablecer la contraseña de tu cuenta.' }) },
  invite: { asunto: 'Te invitamos a Renovacell', html: marcoCorreo({ asunto: 'Te invitamos a Renovacell', titulo: 'Te damos la bienvenida', saludo: 'Hola:',
    parrafos: ['Te crearon una cuenta en Renovacell. Toca el botón para elegir tu contraseña y entrar.'],
    botones: [{ href: '{{ .ConfirmationURL }}', label: 'Activar mi cuenta' }], nota: 'Si no esperabas esta invitación, ignora este correo.', pie: 'Recibes este correo porque te invitaron a Renovacell.' }) },
  email_change: { asunto: 'Confirma tu nuevo correo en Renovacell', html: marcoCorreo({ asunto: 'Confirma tu nuevo correo en Renovacell', titulo: 'Confirma tu nuevo correo', saludo: 'Hola:',
    parrafos: ['Pediste cambiar el correo de tu cuenta Renovacell. Toca el botón para confirmarlo.'],
    botones: [{ href: '{{ .ConfirmationURL }}', label: 'Confirmar correo' }], nota: 'Si tú no lo pediste, ignora este correo y tu cuenta sigue igual.', pie: 'Recibes este correo por un cambio en tu cuenta Renovacell.' }) },
  confirmation: { asunto: 'Confirma tu cuenta de Renovacell', html: marcoCorreo({ asunto: 'Confirma tu cuenta de Renovacell', titulo: 'Confirma tu correo', saludo: 'Hola:',
    parrafos: ['Toca el botón para confirmar tu correo y activar tu cuenta Renovacell.'],
    botones: [{ href: '{{ .ConfirmationURL }}', label: 'Confirmar mi correo' }], pie: 'Recibes este correo porque se creó una cuenta con esta dirección.' }) },
}
