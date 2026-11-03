// Barrido completo (2 nov 2026): el menú es acordeón, así que se recorre SECCIÓN POR SECCIÓN; en cada pantalla, todas sus
// pestañas. Reporta caídas de render, errores de consola y respuestas HTTP ≥ 400 del backend (sin el 429 de pruebas).
import { execFileSync } from 'node:child_process'
import { browser, sesion, sleep } from './lib.mjs'
const reset = () => execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql', ['-X', '-q', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-c', 'delete from rate_limit_buckets'], { env: { ...process.env, PGPASSWORD: 'postgres' } })
const CUENTAS = (process.argv[2] || 'antonio,alberto,blanca,roberto,alejandra,manuel,doctora,doctor2').split(',')
const b = await browser(); const fallas = []; let total = 0
const grupos = (p) => p.$$eval('nav.nav button.grp-btn', (els) => els.map((e) => e.innerText.trim()))
const abrirGrupo = (p, g) => p.evaluate((g) => { const x = [...document.querySelectorAll('nav.nav button.grp-btn')].find((e) => e.innerText.trim() === g); if (x && x.getAttribute('aria-expanded') === 'false') x.click() }, g)
const enlacesDe = (p, g) => p.evaluate((g) => {
  const x = [...document.querySelectorAll('nav.nav button.grp-btn')].find((e) => e.innerText.trim() === g)
  const out = []; let n = x?.nextElementSibling
  const sec = x?.closest('.grp-sec, section, div')
  const links = [...(x?.parentElement?.querySelectorAll('a') ?? [])]
  return links.map((a) => a.querySelector('span')?.textContent?.trim()).filter(Boolean)
}, g)
for (const c of CUENTAS) {
  reset()
  const p = await sesion(b, `${c}@e2e.mx`, { movil: process.env.MOVIL === '1' })
  await p.click('[data-testid=puerta-ahora-no]').catch(() => {})
  const gs = await grupos(p); const vistas = new Set()
  const secciones = gs.length ? gs : ['']
  for (const g of secciones) {
    if (g) { await abrirGrupo(p, g); await sleep(400) }
    const labels = await p.$$eval('nav.nav a', (els) => els.map((e) => e.querySelector('span')?.textContent?.trim()).filter(Boolean))
    for (const l of labels) {
      if (vistas.has(l)) continue
      vistas.add(l)
      if (g) { await abrirGrupo(p, g); await sleep(200) }
      const ok = await p.evaluate((t) => { const a = [...document.querySelectorAll('nav.nav a')].find((e) => e.querySelector('span')?.textContent?.trim() === t); a?.click(); return !!a }, l)
      if (!ok) { fallas.push(`${c} › ${l}: no se pudo abrir`); continue }
      await sleep(1500)
      const tabs = await p.$$eval('[data-testid^=pestana-]', (els) => els.map((e) => e.innerText.trim()).filter(Boolean))
      for (const t of tabs) {
        await p.evaluate((t) => [...document.querySelectorAll('[data-testid^=pestana-]')].find((e) => e.innerText.trim() === t)?.click(), t); await sleep(1100)
        if (await p.evaluate(() => document.body.innerText.includes('Algo salió mal'))) fallas.push(`${c} › ${l} › ${t}: CRASH`)
        p.errores.splice(0).forEach((e) => fallas.push(`${c} › ${l} › ${t}: ${e}`))
      }
      if (await p.evaluate(() => document.body.innerText.includes('Algo salió mal'))) fallas.push(`${c} › ${l}: CRASH`)
      if (process.env.MOVIL === '1') {   // en el celular nada debe salirse de la pantalla (desplazamiento horizontal)
        const ancho = await p.evaluate(() => { const w = window.innerWidth; const sale = [...document.querySelectorAll('main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 2 && getComputedStyle(e).position !== 'fixed' && !e.closest('[style*="overflow"], .table-wrap, .tabla, .scroll-x, table') }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}:${Math.round(e.getBoundingClientRect().right)}px`); return { doc: document.documentElement.scrollWidth - w, sale } })
        if (ancho.doc > 2) fallas.push(`${c} › ${l}: la página se sale ${ancho.doc}px a lo ancho (${ancho.sale.join(', ')})`)
      }
      p.errores.splice(0).forEach((e) => fallas.push(`${c} › ${l}: ${e}`))
      total += 1 + tabs.length
    }
  }
  console.log(`${c}: ${vistas.size} pantallas · [${[...vistas].join(', ')}]`)
  await p.browserContext().close()
}
await b.close()
const reales = [...new Set(fallas)].filter((f) => !/Failed to load resource|429/.test(f))
console.log(`\n${total} vistas (pantallas + pestañas) · ${reales.length} fallas`); for (const f of reales) console.log(' • ' + f)
