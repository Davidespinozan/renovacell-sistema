import { browser, sleep, BASE } from './lib.mjs'
const b = await browser()
try { for (const [w, n] of [[1440, 'd'], [390, 'm']]) { const l = await b.newPage(); await l.setViewport({ width: w, height: 900 }); await l.goto(`${BASE}/landing/index.html`, { waitUntil: 'networkidle2' }); await sleep(800); const el = await l.$('.foot-bottom'); await el.screenshot({ path: `${process.env.E2E_OUT}/landing-pie-${n}.png` }) } } finally { await b.close() }
