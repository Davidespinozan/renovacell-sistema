// EXPEDIENTE EN EL CHAT · Roberto trabaja a su clienta sin salir de la conversación: franja, menú «+» y hoja.
import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const OUT = process.env.E2E_OUT
const movil = process.env.MOVIL === '1'
const b = await browser()
try {
  const r = await sesion(b, 'roberto@e2e.mx', { movil })
  await ir(r, 'Conversaciones'); await sleep(1500)
  await clic(r, '^Atender ahora$|^Abrir$|^Continuar$'); await sleep(3500)
  const pre = movil ? 'm-' : ''
  await r.screenshot({ path: `${OUT}/${pre}acc-1.png` })
  await r.click('[data-testid=btn-acciones]'); await sleep(500)
  console.log('menú:', await r.$$eval('[data-testid^=accion-]', (els) => els.map((e) => e.querySelector('b')?.textContent)))
  await r.screenshot({ path: `${OUT}/${pre}acc-2.png` })
  await r.click(process.env.ACC ? `[data-testid=accion-${process.env.ACC}]` : '[data-testid=accion-ficha]'); await sleep(800)
  await r.screenshot({ path: `${OUT}/${pre}acc-3.png` })
  console.log('errores:', r.errores.filter((e) => !/cart|ERR_NAME/.test(e)).slice(0, 5))
} finally { await b.close() }
