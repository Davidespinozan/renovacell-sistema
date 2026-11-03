import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const b = await browser()
try {
  const d = await sesion(b, 'doctora@e2e.mx')
  await ir(d, 'Habla con Renovacell'); await sleep(2500); await d.click('[data-testid=puerta-ahora-no]').catch(() => {})
  await d.type('textarea', '¿Me pueden confirmar si mi pedido llega mañana temprano?'); await d.click('[data-testid=btn-enviar]'); await sleep(4000)
  const r = await sesion(b, 'roberto@e2e.mx')
  await r.click('[data-testid=puerta-ahora-no]').catch(() => {})
  await ir(r, 'Conversaciones'); await sleep(2500)
  console.log('bandeja roberto:', await r.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | ').slice(0, 300)))
  await clic(r, '^Atender ahora$|^Abrir$|^Continuar$|^Tomar'); await sleep(3500)
  console.log('ve el mensaje:', await r.evaluate(() => document.body.innerText.includes('llega mañana temprano')))
  await r.type('textarea', 'Hola Dra., sí: llega mañana entre 10:30 y 11:00.'); await r.keyboard.press('Enter'); await sleep(1000)
  await r.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^Enviar$/.test(x.innerText.trim()) || x.dataset.testid === 'btn-enviar')?.click()); await sleep(4000)
  await d.bringToFront(); await sleep(3000)
  console.log('doctora recibe (tiempo real):', await d.evaluate(() => document.body.innerText.includes('entre 10:30 y 11:00')))
  console.log('errores:', [...d.errores, ...r.errores].filter((e) => !/429/.test(e)).slice(0, 6))
  await r.screenshot({ path: '/tmp/claude-501/shots/chat-r.png' }); await d.screenshot({ path: '/tmp/claude-501/shots/chat-d.png' })
} finally { await b.close() }
