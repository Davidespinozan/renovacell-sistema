// Captura del hub (Chat del equipo / Avisos del equipo) con dos personas reales: Blanca escribe a Alberto.
import { browser, sesion, ir, clic, foto, sleep } from './lib.mjs'
const tag = process.argv[2] || 'antes'
const b = await browser()
try {
  const blanca = await sesion(b, 'blanca@e2e.mx')
  await ir(blanca, 'Chat del equipo')
  const hay = await blanca.evaluate(() => /Alberto/.test(document.querySelector('.chat-wrap, .tc')?.innerText || ''))
  if (!hay) { await clic(blanca, 'Nuevo'); await blanca.type('input[placeholder^="Buscar"]', 'Alberto'); await clic(blanca, 'Alberto', { sel: '.lrow, .tc-pick' }) }
  else await clic(blanca, 'Alberto', { sel: '.conv, .tc-row' })
  for (const t of ['Hola Alberto', '¿Ya llegó la guía del pedido S100004?']) { const i = await blanca.$('.composer-bar input, .tc textarea'); await i.type(t); await blanca.keyboard.press('Enter'); await sleep(600) }
  await foto(blanca, `${tag}-blanca-hilo`)
  const alberto = await sesion(b, 'alberto@e2e.mx')
  await ir(alberto, 'Chat del equipo'); await sleep(1500)
  await foto(alberto, `${tag}-alberto-lista`)
  await clic(alberto, 'Hola Alberto|guía', { sel: '.conv, .tc-row' })
  const i = await alberto.$('.composer-bar input, .tc textarea'); await i.type('Sí, ya está impresa'); await alberto.keyboard.press('Enter'); await sleep(1200)
  await foto(alberto, `${tag}-alberto-hilo`)
  console.log('alberto ve:', await alberto.evaluate(() => document.querySelector('.thread-head, .rc-head')?.innerText))
  const movil = await sesion(b, 'blanca@e2e.mx', { movil: true })
  await movil.evaluate(() => document.querySelector('.bnav a, nav a')); await ir(movil, 'Chat del equipo').catch(() => {})
  await foto(movil, `${tag}-movil-lista`)
  await clic(movil, 'Alberto', { sel: '.tc-row' }).catch(() => {}); await sleep(800); await foto(movil, `${tag}-movil-hilo`)
  const ant = await sesion(b, 'antonio@e2e.mx')
  await ir(ant, 'Avisos del equipo'); await foto(ant, `${tag}-avisos-admin`)
  await clic(ant, 'Publica un aviso').catch(() => {}); await foto(ant, `${tag}-avisos-composer`)
  await ir(alberto, 'Avisos del equipo'); await foto(alberto, `${tag}-avisos-alberto`)
  await clic(alberto, '^Enterado$').catch(() => {}); await foto(alberto, `${tag}-avisos-alberto-leido`)
  await ir(movil, 'Avisos del equipo').catch(() => {}); await foto(movil, `${tag}-avisos-movil`)
  for (const p of [blanca, alberto, ant]) if (p.errores.length) console.log(p.email, p.errores)
} finally { await b.close() }
