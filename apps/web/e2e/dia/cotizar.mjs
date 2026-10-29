// COTIZACIONES · Roberto, en la conversación de su clienta, arma una cotización, se la manda por el chat y la convierte en pedido.
import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const OUT = process.env.E2E_OUT
const b = await browser()
try {
  const r = await sesion(b, 'roberto@e2e.mx')
  await ir(r, 'Conversaciones'); await sleep(1500)
  await clic(r, '^Atender ahora$|^Abrir$|^Continuar$'); await sleep(3500)
  await clic(r, 'Cotizar'); await sleep(800)
  await r.type('[data-testid=cot-buscar]', 'dysport'); await sleep(500)
  for (let i = 0; i < 5; i++) await clic(r, 'Agregar', { sel: '.cot-prod button' })
  await r.screenshot({ path: `${OUT}/cot-1.png` })
  await clic(r, 'Crear cotización'); await sleep(2000)
  await r.screenshot({ path: `${OUT}/cot-2.png` })
  await clic(r, 'Mandar por este chat'); await sleep(2000)
  console.log('msg:', await r.evaluate(() => document.querySelector('[data-testid=cot-msg]')?.textContent))
  await clic(r, 'Cerrar', { sel: '.mclose, button[aria-label=Cerrar]' }); await sleep(1500)
  await r.screenshot({ path: `${OUT}/cot-3.png` })
  await clic(r, 'Convertir en pedido'); await sleep(1500)
  await r.screenshot({ path: `${OUT}/cot-4.png` })
  console.log('errores:', r.errores.filter((e) => !/cart|ERR_NAME/.test(e)).slice(0, 5))
} finally { await b.close() }
