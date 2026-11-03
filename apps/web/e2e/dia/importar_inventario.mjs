// IMPORTAR INVENTARIO desde la pantalla (Configuración → Importar → Inventario por lote) con un archivo "sucio" realista
// y comparación lote por lote contra lo esperado. Uso: node e2e/dia/importar_inventario.mjs <archivo.csv> <esperado.json>
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const [csv, esp] = process.argv.slice(2)
const db = (sql) => execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql', ['-X', '-At', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const b = await browser()
try {
  const a = await sesion(b, 'antonio@e2e.mx'); await a.click('[data-testid=puerta-ahora-no]').catch(() => {})
  await a.evaluate(() => [...document.querySelectorAll('nav.nav button.grp-btn')].find((e) => /SISTEMA/.test(e.innerText))?.click()); await sleep(500)
  await ir(a, 'Configuración'); await sleep(1500)
  await a.click('[data-testid=importar-abrir]'); await sleep(1200)
  await clic(a, 'Inventario por lote'); await sleep(600)
  const input = await a.$('input[type=file]'); await input.uploadFile(csv); await sleep(2500)
  const prev = await a.evaluate(() => document.querySelector('main').innerText)
  console.log('vista previa:', (prev.match(/\d+ registros? listos?/) ?? ['?'])[0], '·', (prev.match(/no se entiende/g) ?? []).length, 'fechas marcadas "no se entiende"')
  const t0 = Date.now()
  await clic(a, '^Importar \\d+'); 
  await a.waitForFunction(() => !/Importando…/.test(document.body.innerText), { timeout: 240000 }); await sleep(1500)
  console.log(`importación: ${Math.round((Date.now() - t0) / 1000)} s ·`, (await a.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | '))).match(/\d+ (creados?|lotes?)[^|]*\|[^|]*\|[^|]*/)?.[0] ?? '')
  const rechazos = await a.evaluate(() => [...document.querySelectorAll('main li, main tr')].map((x) => x.innerText.replace(/\s+/g, ' ')).filter((x) => /Lote|SKU|caducidad|existe|caduc/i.test(x)).slice(0, 12))
  console.log('rechazos mostrados:'); rechazos.forEach((r) => console.log('  ·', r.slice(0, 150)))
  // comparación lote por lote
  const esperado = JSON.parse(fs.readFileSync(esp, 'utf8'))
  const real = Object.fromEntries(db(`select p.sku || '|' || l.lot_code || '|' || l.expiry_date || '|' || l.quantity from lots l join products p on p.id = l.product_id where l.lot_code ~ '^L(\\d{3}|MIL)$'`).split('\n').filter(Boolean).map((x) => { const [s, c, d, q] = x.split('|'); return [`${s}|${c}`, [d, Number(q)]] }))
  let bien = 0; const mal = []
  for (const [k, [d, q]] of Object.entries(esperado)) { const r = real[k]; if (r && r[0] === d && r[1] === q) bien++; else mal.push(`${k}: esperado ${d}×${q}, quedó ${r ? r.join('×') : 'NADA'}`) }
  console.log(`\nlotes correctos ${bien}/${Object.keys(esperado).length}`); mal.slice(0, 10).forEach((m) => console.log('  ✗', m))
  console.log('lotes que NO debían entrar:', db(`select count(*) from lots where lot_code in ('X1','LCAD','LVAC','LAMB')`), '· errores consola:', a.errores.filter((e) => !/429/.test(e)).slice(0, 3))
} finally { await b.close() }
