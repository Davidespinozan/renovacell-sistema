import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const b = await browser()
try {
  const a = await sesion(b, 'alberto@e2e.mx'); await a.click('[data-testid=puerta-ahora-no]').catch(() => {})
  await ir(a, 'Eventos'); await sleep(2000)
  await clic(a, 'Nuevo evento|Crear evento|Abrir evento'); await sleep(1500)
  await a.type('input[placeholder="Congreso Nacional 2026"]', 'Expo Estética E2E'); await a.type('input[placeholder="Expo Guadalajara"]', 'Culiacán')
  console.log('equipo:', await a.evaluate(() => [...document.querySelectorAll('[data-testid=evento-equipo-editor] label')].map((l) => l.innerText.trim()).join(' · ')))
  await a.evaluate(() => [...document.querySelectorAll('[data-testid=evento-equipo-editor] label')].find((l) => /Roberto/.test(l.innerText))?.querySelector('input')?.click()); await sleep(400)
  await clic(a, '^Crear evento$'); await sleep(3500)
  console.log('alberto:', await a.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | ').slice(0, 300)))
  for (const [u, debe] of [['roberto', true], ['alejandra', false]]) {
    const p = await sesion(b, `${u}@e2e.mx`); await p.click('[data-testid=puerta-ahora-no]').catch(() => {})
    await ir(p, 'Eventos'); await sleep(2500)
    const ve = await p.evaluate(() => document.body.innerText.includes('Expo Estética E2E'))
    console.log(`${u} ve el evento: ${ve} (esperado ${debe})`, ve === debe ? 'OK' : 'FALLA')
    await p.browserContext().close()
  }
  console.log('errores:', a.errores.filter((e) => !/429/.test(e)).slice(0, 4))
} finally { await b.close() }
