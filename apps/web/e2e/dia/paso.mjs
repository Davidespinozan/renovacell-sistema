// Explorador: ejecuta una lista de acciones JSON y vuelca botones/inputs visibles + captura.
import { browser, sesion, ir, clic, foto, sleep } from './lib.mjs'
process.env.E2E_OUT = '/tmp/claude-501/shots'
const [email, accionesJson, nombre] = process.argv.slice(2)
const b = await browser(); const page = await sesion(b, email)
for (const a of JSON.parse(accionesJson)) {
  if (a.ir) await ir(page, a.ir)
  if (a.clic) await clic(page, a.clic, a.opts || {})
  if (a.sel) { await page.click(a.sel); await sleep(800) }
  if (a.tipo) { await page.$eval(a.tipo[0], (e) => { const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })) }); await page.type(a.tipo[0], a.tipo[1]); await sleep(500) }
  if (a.subir) { const f = await page.$(a.subir[0]); await f.uploadFile(a.subir[1]); await sleep(2500) }
  if (a.espera) await sleep(a.espera)
  if (a.eval) console.log('EVAL', await page.evaluate(a.eval))
}
await foto(page, nombre || 'x')
console.log(await page.evaluate(() => [...document.querySelectorAll('button, [data-testid], input, select, textarea')].filter((e) => e.offsetParent && !e.closest('nav.nav, aside')).map((e) => `${e.tagName}${e.dataset.testid ? '#' + e.dataset.testid : ''}${e.type ? '[' + e.type + ']' : ''}${e.disabled ? '(off)' : ''} "${(e.innerText || e.value || e.placeholder || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50)}"`).slice(0, 90).join('\n')))
console.log('ERR', page.errores)
await b.close()
