// ¿Dónde ve cada quien el enlace de contacto dentro de Conversaciones?
import { browser, sesion, ir, foto, sleep } from './lib.mjs'
const b = await browser()
try {
  for (const [email, menu] of [['roberto@e2e.mx', 'Conversaciones'], ['alejandra@e2e.mx', 'Conversaciones'], ['antonio@e2e.mx', 'Conversaciones'], ['roberto@e2e.mx|movil', 'Conversaciones'], ['antonio@e2e.mx|movil', 'Conversaciones']]) {
    const [mail, modo] = email.split('|')
    const p = await sesion(b, mail, { movil: modo === 'movil' })
    await ir(p, menu).catch((e) => console.log(String(e)))
    await sleep(1500)
    const t = await p.evaluate(() => ({ boton: !!document.querySelector('[data-testid=copiar-enlace], [data-testid=enlace-contacto]'), visible: [...document.querySelectorAll('[data-testid=copiar-enlace], [data-testid=enlace-contacto]')].some((e) => e.offsetParent !== null) }))
    console.log(email, t)
    await foto(p, `enlace-${mail.split('@')[0]}${modo ? '-' + modo : ''}`)
  }
} finally { await b.close() }
