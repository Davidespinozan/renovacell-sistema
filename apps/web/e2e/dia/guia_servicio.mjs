import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const b = await browser()
try {
  const p = await sesion(b, 'alberto@e2e.mx')
  await p.click('[data-testid=puerta-ahora-no]').catch(() => {})
  await ir(p, 'Por enviar'); await sleep(2500)
  await clic(p, '^Asignar envío$'); await sleep(2500)
  const txt = () => p.evaluate(() => document.querySelector('.modal')?.innerText.replace(/\n+/g, ' | ') ?? '')
  console.log('vendido:', await p.evaluate(() => document.querySelector('[data-testid=servicio-vendido]')?.innerText))
  const set = async (label, v) => { await p.evaluate((l, v) => { const i = document.querySelector(`input[aria-label="${l}"]`); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })) }, label, v) }
  await set('Peso en kilogramos', '1.5'); await set('Largo en centímetros', '30'); await set('Ancho en centímetros', '25'); await set('Alto en centímetros', '20'); await sleep(500)
  await clic(p, 'Cotizar envío'); await sleep(5000)
  const t1 = await txt(); console.log('tarifas:', t1.slice(t1.indexOf('Tarifas'), t1.indexOf('Tarifas') + 260))
  console.log('marcada:', await p.evaluate(() => [...document.querySelectorAll('input[name=rate]')].map((r) => (r.checked ? '[x] ' : '[ ] ') + r.closest('label').innerText.replace(/\n+/g, ' ')).join(' || ')))
  // cambiar al servicio normal sin motivo: debe bloquear
  await p.evaluate(() => [...document.querySelectorAll('input[name=rate]')].find((r) => !r.checked)?.click()); await sleep(800)
  console.log('al cambiar:', await p.evaluate(() => ({ pide_motivo: !!document.querySelector('[data-testid=cambio-servicio]'), generar_bloqueado: [...document.querySelectorAll('button')].find((x) => /Generar guía/.test(x.innerText))?.disabled })))
  // regresar al vendido y generar
  await p.evaluate(() => [...document.querySelectorAll('input[name=rate]')].find((r) => r.closest('label').querySelector('[data-testid=tarifa-vendida]'))?.click()); await sleep(800)
  await clic(p, 'Generar guía'); await sleep(6000)
  const t2 = await txt(); console.log('resultado:', t2.slice(0, 500))
  console.log('errores:', p.errores.slice(0, 5))
  await p.screenshot({ path: '/tmp/claude-501/shots/guia.png' })
} finally { await b.close() }
