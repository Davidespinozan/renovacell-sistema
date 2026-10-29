// STRYV Care: pie del menú (Dirección y Almacén), pantalla del plan y pie de la landing.
import { browser, sesion, sleep, BASE } from './lib.mjs'
const OUT = process.env.E2E_OUT
const b = await browser()
try {
  const p = await sesion(b, 'antonio@e2e.mx'); await sleep(1500)
  await p.click('[data-testid=side-stryv]'); await sleep(2500)
  await p.screenshot({ path: `${OUT}/care-admin.png` })
  const a = await sesion(b, 'alberto@e2e.mx'); await sleep(1500)
  await a.screenshot({ path: `${OUT}/care-alberto.png`, clip: { x: 0, y: 700, width: 260, height: 200 } })
  const l = await b.newPage(); await l.goto(`${BASE}/landing/index.html`, { waitUntil: 'networkidle2' }); await l.evaluate(() => document.querySelector('.foot-bottom')?.scrollIntoView()); await sleep(800)
  const r = await l.evaluate(() => { const e = document.querySelector('.foot-bottom').getBoundingClientRect(); return { y: e.y, h: e.height } })
  await l.screenshot({ path: `${OUT}/care-landing.png`, clip: { x: 0, y: Math.max(0, r.y - 30), width: 1440, height: r.h + 60 } })
} finally { await b.close() }
