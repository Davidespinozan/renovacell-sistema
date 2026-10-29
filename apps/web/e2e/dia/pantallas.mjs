// Pasada 1: cada cuenta abre TODAS sus pantallas (y pestañas) con backend real local.
import { browser, sesion, menu, ir, sleep } from './lib.mjs'
const CUENTAS = ['antonio', 'alberto', 'blanca', 'roberto', 'alejandra', 'manuel', 'doctora', 'doctor2']
const b = await browser(); const fallas = []
for (const c of CUENTAS) {
  const page = await sesion(b, `${c}@e2e.mx`)
  // Abre TODAS las secciones del menú (Dirección tiene varias cerradas por omisión).
  for (let i = 0; i < 20; i++) {
    const cerrada = await page.$('nav.nav button.grp-btn[aria-expanded=false]')
    if (!cerrada) break
    await cerrada.click(); await sleep(250)
  }
  const labels = await menu(page); let n = 0
  page.errores.splice(0).forEach((e) => fallas.push(`${c} › login: ${e}`))
  for (const l of labels) {
    await ir(page, l); n++
    const tabs = await page.$$eval('[role=tab], [data-testid^=pestana-]', (els) => els.map((e) => e.innerText.trim()).filter(Boolean))
    for (const t of tabs) {
      await page.evaluate((t) => [...document.querySelectorAll('[role=tab], [data-testid^=pestana-]')].find((e) => e.innerText.trim() === t)?.click(), t); await sleep(900)
      if (await page.evaluate(() => document.body.innerText.includes('Algo salió mal'))) fallas.push(`${c} › ${l} › ${t}: CRASH`)
      page.errores.splice(0).forEach((e) => fallas.push(`${c} › ${l} › ${t}: ${e}`))
    }
    if (await page.evaluate(() => document.body.innerText.includes('Algo salió mal'))) fallas.push(`${c} › ${l}: CRASH`)
    page.errores.splice(0).forEach((e) => fallas.push(`${c} › ${l}: ${e}`))
  }
  console.log(`${c}: ${n} pantallas · [${labels.join(', ')}]`)
  await page.browserContext().close()
}
await b.close()
console.log(`\n${fallas.length} fallas`); for (const f of [...new Set(fallas)]) console.log(' • ' + f)
