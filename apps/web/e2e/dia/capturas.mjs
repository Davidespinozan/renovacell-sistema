// Auditoría visual: captura cada pantalla (y cada pestaña) de cada cuenta, en escritorio y teléfono, contra el stack LOCAL.
import fs from 'node:fs'
import { browser, sesion, sleep } from './lib.mjs'
const OUT = process.env.E2E_OUT || '/tmp/audit'
const CUENTAS = (process.argv[2] || 'antonio,alberto,blanca,roberto,alejandra,manuel,doctora').split(',')
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
const abrirSecciones = (p) => p.evaluate(() => { document.querySelectorAll('nav.nav button.grp-btn[aria-expanded=false]').forEach((b) => b.click()) })
const etiquetas = (p) => p.$$eval('nav.nav a', (els) => els.map((e) => e.querySelector('span')?.textContent?.trim()).filter(Boolean))
const ir = (p, t) => p.evaluate((t) => { const a = [...document.querySelectorAll('nav.nav a')].find((e) => e.querySelector('span')?.textContent?.trim() === t); a?.click(); return !!a }, t)
const b = await browser()
const indice = []
for (const c of CUENTAS) for (const movil of [false, true]) {
  const dir = `${OUT}/${c}`; fs.mkdirSync(dir, { recursive: true })
  const p = await sesion(b, `${c}@e2e.mx`, { movil })
  for (let i = 0; i < 4; i++) { await abrirSecciones(p); await sleep(200) }
  const labels = [...new Set(await etiquetas(p))]
  let n = 0
  const tiro = async (nombre) => { const f = `${dir}/${movil ? 'm' : 'd'}-${String(n).padStart(2, '0')}-${nombre}.png`; await p.screenshot({ path: f, fullPage: true, captureBeyondViewport: true }).catch(() => p.screenshot({ path: f })); indice.push(f) }
  for (const l of labels) {
    n++
    await abrirSecciones(p); if (!(await ir(p, l))) continue
    await sleep(1600)
    const tabs = await p.$$eval('[data-testid^=pestana-]', (els) => els.map((e) => e.innerText.trim()).filter(Boolean))
    if (tabs.length < 2 || movil) { await tiro(slug(l)); continue }
    for (const t of tabs) {
      await p.evaluate((t) => [...document.querySelectorAll('[data-testid^=pestana-]')].find((e) => e.innerText.trim() === t)?.click(), t); await sleep(1200)
      await tiro(`${slug(l)}--${slug(t)}`)
    }
  }
  console.log(`${c} ${movil ? 'móvil' : 'escritorio'}: ${labels.length} pantallas`)
  await p.browserContext().close()
}
await b.close()
fs.writeFileSync(`${OUT}/indice.txt`, indice.join('\n'))
console.log(indice.length, 'capturas')
