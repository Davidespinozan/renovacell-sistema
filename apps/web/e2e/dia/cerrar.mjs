// Dirección cierra una solicitud de visitante sin vendedor desde la Bandeja de Conversaciones.
import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const b = await browser()
try {
  const p = await sesion(b, 'antonio@e2e.mx')
  const antes = await p.evaluate(() => document.querySelectorAll('[data-testid=intervencion]').length)
  await clic(p, '^Abrir$', { dentro: '[data-testid=rh-sec-atencion]' }); await sleep(2500)
  await p.screenshot({ path: `${process.env.E2E_OUT}/cerrar-antes.png` })
  await clic(p, 'Cerrar solicitud'); await sleep(2500)
  await p.screenshot({ path: `${process.env.E2E_OUT}/cerrar-despues.png` })
  await ir(p, 'Inicio'); await sleep(2500)
  const despues = await p.evaluate(() => document.querySelectorAll('[data-testid=intervencion]').length)
  console.log('tarjetas de intervención:', antes, '→', despues, '| errores:', p.errores)
} finally { await b.close() }
