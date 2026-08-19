// SMOKE E2E (portado de la disciplina de CuboPolar): levanta la app en MODO MOCK
// (vite --mode test, que ignora .env.local), entra con CADA rol y recorre TODAS sus
// pantallas, verificando que ninguna ROMPE (ErrorBoundary) ni tira errores de consola.
// Atrapa roturas de auth/routing/render que los tests unitarios no ven. Read-only: solo
// navega, no escribe. Uso: `npm run e2e` (necesita Chrome; CHROME_PATH para apuntarlo).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const PORT = Number(process.env.E2E_PORT || 4188)
const BASE = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].find((p) => existsSync(p))

// Un rol representativo por cada tipo (mock; contraseña demo).
const ROLES = [
  { role: 'Dirección', email: 'direccion@renovacell.mx' },
  { role: 'Almacén', email: 'almacen@renovacell.mx' },
  { role: 'Ventas', email: 'ventas1@renovacell.mx' },
  { role: 'Chofer', email: 'chofer@renovacell.mx' },
  { role: 'Doctor', email: 'laura.mendez@renova.mx' },
]

// Errores de consola benignos que NO son fallas reales de la app.
const BENIGN = [/favicon/i, /net::ERR/i, /React DevTools/i, /Download the React/i]
const isReal = (t) => !BENIGN.some((re) => re.test(t))

async function waitServer(ms = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(BASE); if (r.ok) return true } catch { /* aún no */ }
    await sleep(500)
  }
  throw new Error('el dev server no respondió en ' + BASE)
}

async function login(page, email) {
  await page.waitForSelector('input[type=email]', { timeout: 15000 })
  await page.$eval('input[type=email]', (e) => (e.value = ''))
  await page.type('input[type=email]', email)
  await page.type('input[type=password]', 'demo')
  await page.click('button[type=submit]')
  await page.waitForSelector('nav.nav a', { timeout: 15000 })
  await sleep(600)
}

async function run() {
  if (!CHROME) { console.error('No encontré Chrome. Define CHROME_PATH.'); process.exit(2) }
  console.log('▶ Levantando app en modo mock (vite --mode test) en :' + PORT)
  const vite = spawn('npx', ['vite', '--mode', 'test', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
  })
  const kill = () => { try { vite.kill('SIGTERM') } catch { /* */ } }
  process.on('exit', kill); process.on('SIGINT', () => { kill(); process.exit(1) })

  const failures = []
  let browser
  try {
    await waitServer()
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 900 } })

    for (const { role, email } of ROLES) {
      const page = await browser.newPage()
      let bucket = []
      page.on('console', (m) => { if (m.type() === 'error' && isReal(m.text())) bucket.push(m.text().slice(0, 160)) })
      page.on('pageerror', (e) => { if (isReal(String(e))) bucket.push('PAGEERROR ' + String(e).slice(0, 160)) })

      await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 })
      await login(page, email)

      const labels = await page.$$eval('nav.nav a', (els) =>
        els.map((e) => e.querySelector('span')?.textContent?.trim()).filter(Boolean))
      let screens = 0
      for (const label of labels) {
        bucket = []
        const clicked = await page.evaluate((t) => {
          const a = [...document.querySelectorAll('nav.nav a')].find((e) => e.querySelector('span')?.textContent?.trim() === t)
          if (a) { a.click(); return true } return false
        }, label)
        if (!clicked) continue
        await sleep(700)
        screens++
        const crashed = await page.evaluate(() => document.body.innerText.includes('Algo salió mal en esta pantalla'))
        if (crashed) failures.push(`${role} › ${label}: ErrorBoundary (crash de render)`)
        for (const e of [...new Set(bucket)]) failures.push(`${role} › ${label}: ${e}`)
      }
      console.log(`  ${role}: ${screens} pantallas recorridas`)
      await page.close()
    }
  } catch (e) {
    failures.push('FATAL ' + String(e))
  } finally {
    if (browser) await browser.close()
    kill()
  }

  console.log('\n' + '─'.repeat(52))
  if (failures.length === 0) {
    console.log('✅ SMOKE OK — todas las pantallas de todos los roles cargan sin crash ni error.')
    process.exit(0)
  } else {
    console.log(`❌ SMOKE: ${failures.length} problema(s):`)
    for (const f of failures) console.log('  • ' + f)
    process.exit(1)
  }
}

run()
