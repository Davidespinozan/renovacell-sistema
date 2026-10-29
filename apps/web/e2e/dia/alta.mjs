// ALTA-DESDE-CONVERSACIÓN · quien atiende abre la conversación de WhatsApp de una persona sin ficha, marca su foto como INE,
// la da de alta verificada y queda lista para "Mandar acceso al portal".
import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const OUT = process.env.E2E_OUT, CUENTA = process.env.CUENTA || 'antonio'
const b = await browser()
try {
  const p = await sesion(b, `${CUENTA}@e2e.mx`)
  await ir(p, 'Conversaciones'); await sleep(1800)
  await clic(p, '^Ana', { sel: '.bq-item' }); await sleep(3500)
  await p.screenshot({ path: `${OUT}/alta-1.png` })
  await clic(p, 'Usar como INE frente'); await sleep(500)
  await clic(p, 'darla de alta'); await sleep(500)
  await p.type('[aria-label="Nombre completo"]', 'Ana Gómez Ruiz'); await p.type('[aria-label="Cédula profesional"]', '12345678')
  await p.type('[aria-label="Correo"]', 'ana@clinica.mx'); await p.type('[aria-label="Ciudad"]', 'Culiacán')
  await p.screenshot({ path: `${OUT}/alta-2.png` })
  await clic(p, 'Dar de alta verificada'); await sleep(2500)
  await p.screenshot({ path: `${OUT}/alta-3.png` })
  console.log('mensaje:', await p.evaluate(() => document.querySelector('[data-testid=pc-msg]')?.textContent), '| errores:', p.errores.filter((e) => !/cart/.test(e)).slice(0, 5))
} finally { await b.close() }
