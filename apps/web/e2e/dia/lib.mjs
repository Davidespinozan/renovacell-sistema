// Utilidades del recorrido E2E "día de operación" contra el stack LOCAL (nunca producción).
import puppeteer from 'puppeteer-core'
export const BASE = process.env.E2E_BASE || 'http://localhost:4190'
export const PASS = 'E2e-prueba-2026'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BENIGN = [/favicon/i, /React DevTools/i, /Download the React/i, /ERR_CONNECTION_REFUSED/i]
export async function browser() {
  return puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 900 } })
}
// Abre una sesión aislada (contexto propio = otro dispositivo) y entra con la cuenta.
export async function sesion(b, email, { movil = false } = {}) {
  const ctx = await b.createBrowserContext()
  const page = await ctx.newPage()
  if (movil) await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  page.errores = []
  page.on('console', (m) => { if (m.type() === 'error' && !BENIGN.some((r) => r.test(m.text()))) page.errores.push(m.text().slice(0, 220)) })
  page.on('pageerror', (e) => page.errores.push('PAGEERROR ' + String(e).slice(0, 220)))
  page.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && /54321/.test(u)) page.errores.push(`HTTP ${r.status()} ${r.request().method()} ${u.replace(/^.*54321/, '').slice(0, 140)}`) })
  page.on('dialog', (d) => d.accept())
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await page.waitForSelector('input[type=email]', { timeout: 20000 })
  page.errores.length = 0
  await page.type('input[type=email]', email); await page.type('input[type=password]', PASS)
  await page.click('button[type=submit]')
  await page.waitForFunction(() => document.querySelector('nav.nav a') || /Inicio|Catálogo/.test(document.body.innerText), { timeout: 25000 })
  await sleep(1500)
  page.email = email
  return page
}
export async function menu(page) {
  return page.$$eval('nav.nav a', (els) => els.map((e) => e.querySelector('span')?.textContent?.trim()).filter(Boolean))
}
export async function ir(page, label) {
  for (let i = 0; i < 20; i++) { const c = await page.$('nav.nav button.grp-btn[aria-expanded=false]'); if (!c) break; await c.click(); await sleep(200) }
  const ok = await page.evaluate((t) => {
    const a = [...document.querySelectorAll('nav.nav a')].find((e) => e.querySelector('span')?.textContent?.trim() === t)
    if (a) { a.click(); return true } return false }, label)
  if (!ok) throw new Error(`${page.email}: no hay "${label}" en el menú`)
  await sleep(1200)
}
// Clic en el elemento visible (botón/enlace/pestaña) cuyo texto coincide.
export async function clic(page, texto, { sel = 'button, a, [role=tab], [role=button], label', dentro = null, n = 0 } = {}) {
  const h = await page.evaluateHandle((t, sel, dentro, n) => {
    const raiz = dentro ? document.querySelector(dentro) : document
    const re = new RegExp(t, 'i')
    const els = [...raiz.querySelectorAll(sel)].filter((e) => e.offsetParent !== null && !e.disabled && re.test((e.innerText || e.getAttribute('aria-label') || '').trim()))
    return els[n] || null }, texto, sel, dentro, n)
  const el = h.asElement()
  if (!el) throw new Error(`${page.email}: no encontré botón /${texto}/`)
  await el.scrollIntoView().catch(() => {})
  await el.click()   // ratón real: dispara mousedown/pointerdown/click
  await sleep(900)
}
export const texto = (page) => page.evaluate(() => document.body.innerText)
export async function foto(page, nombre) { await page.screenshot({ path: `${process.env.E2E_OUT || '/tmp'}/${nombre}.png`, fullPage: false }) }
