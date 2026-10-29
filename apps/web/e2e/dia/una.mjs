// Captura una pantalla concreta (espera a que termine la animación de entrada).
import { browser, sesion, ir, sleep } from './lib.mjs'
const [cuenta, pantalla, nombre, modo] = process.argv.slice(2)
const b = await browser()
try { const p = await sesion(b, `${cuenta}@e2e.mx`, { movil: modo === 'm' }); await p.evaluate(() => document.querySelectorAll('nav.nav button.grp-btn[aria-expanded=false]').forEach((x) => x.click())); await p.evaluate((t) => [...document.querySelectorAll('nav.nav a')].find((e) => e.querySelector('span')?.textContent?.trim() === t)?.click(), pantalla); await sleep(3000); await p.screenshot({ path: `${process.env.E2E_OUT}/${nombre}.png` }) } finally { await b.close() }
